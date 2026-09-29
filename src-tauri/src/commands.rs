// Tauri command handlers

// Command parameters are the frontend's invoke() argument names, so they stay flat
#![allow(clippy::too_many_arguments)]

use crate::auth::{self, CallbackServer, GmailAuth};
use crate::ai::GeminiClient;
use crate::cache::CacheDb;
use crate::gmail::{GmailClient, GmailDraft, GmailLabel, OutgoingMessage, SearchResult};
use crate::icloud::ICloudKVStore;
use crate::models::{Account, Card, SendAttachment, ThreadGroup, ALL_ACCOUNTS};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Manager, State};

use tokio::sync::Mutex;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<std::sync::Mutex<Option<CacheDb>>>,
    pub auth: Arc<Mutex<Option<GmailAuth>>>,
    /// Serializes each iCloud read-merge-write so concurrent syncs can't
    /// overwrite each other's changes
    pub icloud: Arc<std::sync::Mutex<ICloudSync>>,
    /// Cancel flag for the in-flight OAuth flow, so a retry can release port 8420
    pub oauth_cancel: Arc<std::sync::Mutex<Option<Arc<AtomicBool>>>>,
    /// Google's sign-in page for the flow waiting on the browser, so the user
    /// can open it again after closing the tab
    pub oauth_url: Arc<std::sync::Mutex<Option<String>>>,
    /// Cached access tokens per account_id; never hold this lock across an await
    pub token_cache: Arc<TokenCache>,
    /// OAuth credentials known to be in secure storage, so configuring auth
    /// with them again doesn't rewrite the keychain
    pub stored_credentials: Arc<std::sync::Mutex<Option<AuthConfig>>>,
}

type TokenCache = std::sync::Mutex<HashMap<String, (String, Instant)>>;

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(std::sync::Mutex::new(None)),
            auth: Arc::new(Mutex::new(None)),
            icloud: Arc::new(std::sync::Mutex::new(ICloudSync::new())),
            oauth_cancel: Arc::new(std::sync::Mutex::new(None)),
            oauth_url: Arc::new(std::sync::Mutex::new(None)),
            token_cache: Arc::new(std::sync::Mutex::new(HashMap::new())),
            stored_credentials: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Long enough for a password plus a second factor; the wait screen can be
/// cancelled sooner
const OAUTH_CALLBACK_TIMEOUT_SECS: u64 = 300;

// --- Helper functions to reduce boilerplate ---

/// Get app data directory from handle. Debug builds keep their own
/// subdirectory so development never shares accounts, cache or secret files
/// with the installed app.
fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    if let Some(parent) = dir.parent() {
        adopt_legacy_data_dir(&dir, &parent.join(LEGACY_BUNDLE_IDENTIFIER));
    }
    Ok(if cfg!(debug_assertions) { dir.join("dev") } else { dir })
}

/// The bundle identifier Posta shipped with, which is registered to another
/// developer; older installs keep their data in a directory named after it
const LEGACY_BUNDLE_IDENTIFIER: &str = "com.posta.app";

/// Moves the old data directory into place the first time the app runs under
/// its current identifier; never touches an existing current directory
fn adopt_legacy_data_dir(current: &std::path::Path, legacy: &std::path::Path) {
    if current.exists() || !legacy.is_dir() {
        return;
    }
    match std::fs::rename(legacy, current) {
        Ok(()) => tracing::info!("Moved app data from {:?} to {:?}", legacy, current),
        // Another caller may have just moved it
        Err(_) if current.exists() => {}
        Err(e) => tracing::warn!("Couldn't move app data from {:?}: {}", legacy, e),
    }
}

/// Run database, keychain, iCloud or file work on the blocking thread pool
async fn blocking<T: Send + 'static>(
    state: &AppState,
    f: impl FnOnce(&AppState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = state.clone();
    tokio::task::spawn_blocking(move || f(&state))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Execute a closure with database access
fn with_db<T, F>(state: &AppState, f: F) -> Result<T, String>
where
    F: FnOnce(&CacheDb) -> Result<T, String>,
{
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    f(db)
}

/// A local account, or "Account not found"
async fn find_account(state: &AppState, account_id: &str) -> Result<Account, String> {
    let account_id = account_id.to_string();
    blocking(state, move |state| {
        with_db(state, |db| {
            db.get_accounts()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|a| a.id == account_id)
                .ok_or_else(|| "Account not found".to_string())
        })
    })
    .await
}

async fn get_account_email(state: &AppState, account_id: &str) -> Result<String, String> {
    Ok(find_account(state, account_id).await?.email)
}

/// Deleted cards travel in the iCloud account-mapping map, next to the
/// account id -> email entries, as `deleted:<card id>` -> deletion time in
/// Unix ms. A card is only ever deleted on another device by such an entry:
/// the backup is one last-writer-wins value, so a card can be missing from it
/// merely because a device that had not received it yet wrote last.
const TOMBSTONE_PREFIX: &str = "deleted:";

/// A device offline for longer than this can bring a deleted card back
const TOMBSTONE_TTL_MS: i64 = 180 * 24 * 60 * 60 * 1000;

/// The iCloud card backup
#[derive(Debug, Default, Clone, PartialEq)]
struct Backup {
    cards: Vec<Card>,
    /// Account id -> email on the device that pushed each card
    emails: HashMap<String, String>,
    /// Card id -> deletion time (Unix ms)
    tombstones: HashMap<String, i64>,
}

impl Backup {
    /// None when the store holds nothing at all
    fn from_store(cards: Option<Vec<Card>>, mappings: Option<HashMap<String, String>>) -> Option<Self> {
        if cards.is_none() && mappings.is_none() {
            return None;
        }
        let mut emails = HashMap::new();
        let mut tombstones = HashMap::new();
        for (key, value) in mappings.unwrap_or_default() {
            match key.strip_prefix(TOMBSTONE_PREFIX) {
                Some(card_id) => {
                    if let Ok(deleted_at) = value.parse() {
                        tombstones.insert(card_id.to_string(), deleted_at);
                    }
                }
                None => {
                    emails.insert(key, value);
                }
            }
        }
        Some(Self { cards: cards.unwrap_or_default(), emails, tombstones })
    }

    fn mappings(&self) -> HashMap<String, String> {
        let mut mappings = self.emails.clone();
        for (card_id, deleted_at) in &self.tombstones {
            mappings.insert(format!("{}{}", TOMBSTONE_PREFIX, card_id), deleted_at.to_string());
        }
        mappings
    }
}

/// This device's side of card sync, kept next to the database
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
struct SyncRecord {
    /// Each card as it last was on both this device and iCloud, under the
    /// local account id. A side that differs from it changed the card.
    #[serde(default)]
    base: HashMap<String, Card>,
    /// Card id -> deletion time (Unix ms) for cards deleted on any device,
    /// including deletions made here that have not reached iCloud yet
    #[serde(default)]
    tombstones: HashMap<String, i64>,
    /// Whether this device has ever read a backup. After that, an empty
    /// store means iCloud is not available (not downloaded yet, or signed
    /// out), not that there is nothing to keep.
    #[serde(default)]
    seen_backup: bool,
}

/// Where the card backup is kept
trait CardBackupStore: Send {
    fn load_cards(&self) -> Result<Option<Vec<Card>>, String>;
    fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String>;
    fn sync_cards(&self, cards: &[Card]) -> Result<(), String>;
    fn sync_account_mappings(&self, mappings: &HashMap<String, String>) -> Result<(), String>;
    /// Whether this device's first download of the backup from iCloud has
    /// finished; until then an empty or partial store says nothing about it
    fn initial_sync_done(&self) -> bool {
        true
    }
}

impl CardBackupStore for ICloudKVStore {
    fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
        ICloudKVStore::load_cards(self)
    }

    fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String> {
        ICloudKVStore::load_account_mappings(self)
    }

    fn sync_cards(&self, cards: &[Card]) -> Result<(), String> {
        ICloudKVStore::sync_cards(self, cards)
    }

    fn sync_account_mappings(&self, mappings: &HashMap<String, String>) -> Result<(), String> {
        ICloudKVStore::sync_account_mappings(self, mappings)
    }
}

/// The iCloud card backup plus this device's `SyncRecord`
pub struct ICloudSync {
    /// None in debug builds: a signed debug bundle would otherwise read the
    /// installed app's backup, whose card ids it shares, and its deletions
    /// would reach the user's real layout on every Mac
    store: Option<Box<dyn CardBackupStore>>,
    /// Where the `SyncRecord` lives; set once the app data dir is known
    record_path: Option<std::path::PathBuf>,
    last_synced_at: Option<i64>,
    last_error: Option<String>,
}

/// How card sync with iCloud last went, for Settings: a failed write or read
/// otherwise only reaches the log, and the layout on this Mac may be its
/// only copy
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ICloudSyncStatus {
    /// False in builds without an iCloud store (debug builds)
    pub available: bool,
    /// Unix ms of the last push or pull that reached iCloud
    pub last_synced_at: Option<i64>,
    /// Why the last push or pull didn't reach iCloud; cleared by one that does
    pub last_error: Option<String>,
}

impl ICloudSync {
    fn new() -> Self {
        let store: Option<Box<dyn CardBackupStore>> =
            if cfg!(debug_assertions) { None } else { Some(Box::new(ICloudKVStore::new())) };
        Self { store, record_path: None, last_synced_at: None, last_error: None }
    }

    fn note_synced(&mut self) {
        self.last_synced_at = Some(now_ms());
        self.last_error = None;
    }

    fn note_failure(&mut self, error: String) {
        tracing::warn!("{}", error);
        self.last_error = Some(error);
    }

    fn status(&self) -> ICloudSyncStatus {
        ICloudSyncStatus {
            available: self.store.is_some(),
            last_synced_at: self.last_synced_at,
            last_error: self.last_error.clone(),
        }
    }

    /// A missing or unreadable record only loses the change tracking, so
    /// conflicts go to iCloud on a pull and to this device on a push. An
    /// unreadable one may belong to a device that has pushed before, so an
    /// empty store is still not taken as nobody having pushed yet.
    fn load_record(&self) -> SyncRecord {
        let Some(path) = &self.record_path else { return SyncRecord::default() };
        let unreadable = |e: String| {
            tracing::warn!("iCloud card sync state is unreadable, starting over: {}", e);
            SyncRecord { seen_backup: true, ..Default::default() }
        };
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| unreadable(e.to_string())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => SyncRecord::default(),
            Err(e) => unreadable(e.to_string()),
        }
    }

    /// Written to a temporary file and renamed over the record, so a crash
    /// mid-write can't leave a torn record that drops unpushed deletions
    fn save_record(&self, record: &SyncRecord) {
        let Some(path) = &self.record_path else { return };
        let temp = path.with_extension("json.tmp");
        let result = serde_json::to_vec(record).map_err(|e| e.to_string()).and_then(|json| {
            use std::io::Write;
            let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
            file.write_all(&json).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
            std::fs::rename(&temp, path).map_err(|e| e.to_string())
        });
        if let Err(e) = result {
            let _ = std::fs::remove_file(&temp);
            tracing::warn!("Failed to save iCloud card sync state: {}", e);
        }
    }

    /// Ok(None) when the store holds nothing, or there is no store
    fn load_backup(&self) -> Result<Option<Backup>, String> {
        let Some(store) = &self.store else { return Ok(None) };
        let cards = store.load_cards()?;
        let mappings = store.load_account_mappings()?;
        Ok(Backup::from_store(cards, mappings))
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Tombstones from both sides, without those old enough to forget
fn merged_tombstones(
    a: &HashMap<String, i64>,
    b: &HashMap<String, i64>,
    now_ms: i64,
) -> HashMap<String, i64> {
    let mut merged = a.clone();
    for (id, &deleted_at) in b {
        let entry = merged.entry(id.clone()).or_insert(deleted_at);
        *entry = (*entry).max(deleted_at);
    }
    merged.retain(|_, deleted_at| now_ms - *deleted_at <= TOMBSTONE_TTL_MS);
    merged
}

/// A card both sides have, merged field by field against the base: each side
/// keeps the fields only it changed, so a reorder on one device and a rename
/// on another both survive. A field changed on both sides, or any field when
/// there is no base, goes to iCloud when `remote_wins`, else to this device.
fn merged_card(local: &Card, remote: &Card, base: Option<&Card>, remote_wins: bool) -> Card {
    let Some(base) = base else {
        return if remote_wins { remote.clone() } else { local.clone() };
    };
    // Destructured so a new Card field can't be left out of the merge
    let Card { id: _, account_id: _, name: _, query: _, position: _, collapsed: _, color: _, group_by: _, card_type: _ } =
        local;
    let mut merged = local.clone();
    macro_rules! take_remote_changes {
        ($($field:ident),*) => {$(
            if remote.$field != base.$field && (local.$field == base.$field || remote_wins) {
                merged.$field = remote.$field.clone();
            }
        )*};
    }
    take_remote_changes!(account_id, name, query, position, collapsed, color, group_by, card_type);
    merged
}

/// Backup cards not tombstoned, split into those owned by a local account
/// (re-keyed to its local id) and those of accounts this device lacks. A card
/// id the backup holds more than once, which a torn read of the cards and
/// mappings can produce, is kept once: the first copy a local account owns,
/// else the first copy.
fn split_backup_cards(
    backup_cards: Vec<Card>,
    emails: &HashMap<String, String>,
    tombstones: &HashMap<String, i64>,
    accounts: &[Account],
) -> (Vec<Card>, Vec<Card>) {
    let mut own: Vec<Card> = Vec::new();
    let mut foreign: Vec<Card> = Vec::new();
    for mut card in backup_cards {
        if tombstones.contains_key(&card.id) || own.iter().any(|c| c.id == card.id) {
            continue;
        }
        match icloud_card_account(&card.account_id, emails, accounts) {
            Some(account_id) => {
                card.account_id = account_id;
                foreign.retain(|c| c.id != card.id);
                own.push(card);
            }
            None if foreign.iter().any(|c| c.id == card.id) => {}
            None => foreign.push(card),
        }
    }
    (own, foreign)
}

fn take_card(cards: &mut Vec<Card>, id: &str) -> Option<Card> {
    let index = cards.iter().position(|c| c.id == id)?;
    Some(cards.remove(index))
}

/// The backup to write after a local card change, and the record to keep once
/// it is written. Every local card is kept unless another device deleted it;
/// a card only the other side changed keeps that change; backup cards this
/// device has not pulled yet, and cards of accounts it doesn't have, are
/// carried over. None without local accounts, since nothing on this device
/// can then speak for the backup.
fn plan_push(
    accounts: &[Account],
    local_cards: Vec<Card>,
    backup: Backup,
    record: &SyncRecord,
    now_ms: i64,
) -> Option<(Backup, SyncRecord)> {
    if accounts.is_empty() {
        return None;
    }

    let tombstones = merged_tombstones(&record.tombstones, &backup.tombstones, now_ms);
    let (mut remote, mut foreign) = split_backup_cards(backup.cards, &backup.emails, &tombstones, accounts);
    // Moved to such an account elsewhere while unchanged in scope here: the
    // move stands, and the next pull takes the card away here
    let moved_away: std::collections::HashSet<String> = local_cards
        .iter()
        .filter(|c| {
            moved_to_foreign_account(&foreign, &backup.emails, &c.id)
                && record.base.get(&c.id).is_some_and(|base| base.account_id == c.account_id)
        })
        .map(|c| c.id.clone())
        .collect();
    // Otherwise the backup copy is of a local card whose owner mapping is
    // missing, or one this device moved since
    foreign.retain(|f| moved_away.contains(&f.id) || !local_cards.iter().any(|c| c.id == f.id));
    let mut new_record = SyncRecord { base: HashMap::new(), tombstones: tombstones.clone(), seen_backup: record.seen_backup };

    let mut cards = Vec::new();
    for local in local_cards {
        // Deleted on another device; the next pull removes it here
        if tombstones.contains_key(&local.id) {
            continue;
        }
        if moved_away.contains(&local.id) {
            new_record.base.insert(local.id.clone(), local);
            continue;
        }
        let card = match take_card(&mut remote, &local.id) {
            Some(remote) => merged_card(&local, &remote, record.base.get(&local.id), false),
            None => local.clone(),
        };
        // The base stays at the local copy, so the next pull still sees
        // fields taken from iCloud as changed elsewhere and applies them here
        new_record.base.insert(local.id.clone(), local);
        cards.push(card);
    }
    cards.extend(remote);
    cards.extend(foreign);

    let mut emails = backup.emails;
    emails.extend(accounts.iter().map(|a| (a.id.clone(), a.email.clone())));
    // A Mac that knows no all-inboxes cards finds no account with this email,
    // so it carries the cards over instead of adopting them
    emails.insert(ALL_ACCOUNTS.to_string(), NO_EMAIL.to_string());
    let owners: std::collections::HashSet<&str> = cards.iter().map(|c| c.account_id.as_str()).collect();
    emails.retain(|id, _| owners.contains(id.as_str()));

    Some((Backup { cards, emails, tombstones }, new_record))
}

/// Whether the backup holds card `id` under an account this device lacks,
/// named in the mappings. A card of an owner with no mapping may be a torn
/// read of this device's own.
fn moved_to_foreign_account(foreign: &[Card], emails: &HashMap<String, String>, id: &str) -> bool {
    foreign.iter().any(|f| f.id == id && emails.contains_key(&f.account_id))
}

/// The email the all-inboxes owner maps to in the backup; never an address
const NO_EMAIL: &str = "*";

/// Push every card to iCloud after a local card change. The caller holds the
/// iCloud lock from before its database write, so a pull can't merge in
/// between.
fn push_cards_to_icloud(icloud: &mut ICloudSync, state: &AppState, deleted_card: Option<&str>) {
    match write_cards_to_icloud(icloud, state, deleted_card) {
        Ok(true) => icloud.note_synced(),
        Ok(false) => {}
        Err(e) => icloud.note_failure(e),
    }
}

/// True once the backup is written; false when there was nothing to push
/// or no store to push to
fn write_cards_to_icloud(icloud: &ICloudSync, state: &AppState, deleted_card: Option<&str>) -> Result<bool, String> {
    let mut record = icloud.load_record();
    if let Some(id) = deleted_card {
        record.tombstones.insert(id.to_string(), now_ms());
        record.base.remove(id);
        // Saved even if nothing is pushed below, so the deletion goes out
        // with a later push and a pull can't bring the card back meanwhile
        icloud.save_record(&record);
    }

    let (accounts, local_cards) = {
        let Ok(db_guard) = state.db.lock() else { return Ok(false) };
        let Some(db) = db_guard.as_ref() else { return Ok(false) };
        let Ok(accounts) = db.get_accounts() else { return Ok(false) };
        // A partial list would drop the missing cards from iCloud
        let Ok(cards) = db.get_board_cards() else { return Ok(false) };
        (accounts, cards)
    };

    let Some(store) = &icloud.store else { return Ok(false) };
    let backup = backup_to_push_onto(icloud.load_backup(), &mut record, store.initial_sync_done())?;
    let Some((backup, new_record)) = plan_push(&accounts, local_cards, backup, &record, now_ms()) else {
        return Ok(false);
    };
    store
        .sync_account_mappings(&backup.mappings())
        .map_err(|e| format!("iCloud account mapping sync failed: {}", e))?;
    store.sync_cards(&backup.cards).map_err(|e| format!("iCloud card sync failed: {}", e))?;
    icloud.save_record(&new_record);
    Ok(true)
}

/// The backup a push merges into, or why the backup must not be overwritten.
/// Marks the record as having seen a backup, which only sticks once the push
/// is written.
fn backup_to_push_onto(
    loaded: Result<Option<Backup>, String>,
    record: &mut SyncRecord,
    initial_sync_done: bool,
) -> Result<Backup, String> {
    // A new Mac's store is empty, or holds only some keys, until iCloud has
    // downloaded it; a write then would replace the backup other Macs made
    if !record.seen_backup && !initial_sync_done {
        return Err("iCloud has not downloaded the card backup yet; card changes stay on this Mac for now".into());
    }
    match loaded {
        Ok(Some(backup)) => {
            record.seen_backup = true;
            Ok(backup)
        }
        // No device has pushed yet, as far as this one knows
        Ok(None) if !record.seen_backup => {
            record.seen_backup = true;
            Ok(Backup::default())
        }
        Ok(None) => Err(BACKUP_UNAVAILABLE.into()),
        Err(e) => Err(format!("iCloud card backup is unreadable, so it was not overwritten: {}", e)),
    }
}

const BACKUP_UNAVAILABLE: &str = "iCloud card backup is unavailable; card changes stay on this Mac for now";

/// Run a card database write, then push the cards to iCloud
fn change_cards<T>(
    state: &AppState,
    deleted_card: Option<&str>,
    write: impl FnOnce(&CacheDb) -> Result<T, String>,
) -> Result<T, String> {
    let mut icloud = state.icloud.lock().map_err(|_| "Lock error")?;
    let result = with_db(state, write)?;
    push_cards_to_icloud(&mut icloud, state, deleted_card);
    Ok(result)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[tauri::command]
pub async fn init_app(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_dir = get_app_data_dir(&app_handle)?;
    blocking(&state, move |state| init_app_blocking(&app_dir, state)).await
}

fn init_app_blocking(app_dir: &std::path::Path, state: &AppState) -> Result<(), String> {
    tracing::info!("App data dir: {:?}", app_dir);

    std::fs::create_dir_all(app_dir).map_err(|e| format!("Failed to create app dir: {}", e))?;

    let db_path = app_dir.join("posta.db");
    tracing::info!("DB path: {:?}", db_path);

    let db = open_database(&db_path)?;

    state.icloud.lock().map_err(|_| "Lock error")?.record_path = Some(app_dir.join("icloud-card-sync.json"));

    let mut db_guard = state.db.lock().map_err(|_| "Lock error".to_string())?;
    *db_guard = Some(db);

    tracing::info!("App initialized successfully");
    Ok(())
}

/// Card caches are not pruned by age: each is the only offline copy of its
/// card, is overwritten on every refresh, and goes when the card or its
/// account is deleted
fn open_database(db_path: &std::path::Path) -> Result<CacheDb, String> {
    let db = CacheDb::new(db_path).map_err(|e| format!("Failed to open database: {}", e))?;
    match db.clear_orphaned_card_cache() {
        Ok(0) => {}
        Ok(n) => tracing::info!("Removed {} cached card results of deleted cards", n),
        Err(e) => tracing::warn!("Failed to remove caches of deleted cards: {}", e),
    }
    Ok(db)
}

#[tauri::command]
pub async fn configure_auth(config: AuthConfig, app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let stored = config.clone();
    blocking(&state, move |state| {
        remember_credentials(&state.stored_credentials, &stored, |c| {
            auth::store_oauth_credentials(&c.client_id, &c.client_secret, &app_data_dir).map_err(|e| e.to_string())
        })
    })
    .await?;

    let auth = GmailAuth::new(config.client_id, config.client_secret);
    *state.auth.lock().await = Some(auth);
    Ok(())
}

/// Store the OAuth credentials unless secure storage is known to hold them
fn remember_credentials(
    known: &std::sync::Mutex<Option<AuthConfig>>,
    config: &AuthConfig,
    store: impl FnOnce(&AuthConfig) -> Result<(), String>,
) -> Result<(), String> {
    let mut known = known.lock().map_err(|_| "Lock error")?;
    if known.as_ref() == Some(config) {
        return Ok(());
    }
    store(config)?;
    *known = Some(config.clone());
    Ok(())
}

#[tauri::command]
pub async fn get_stored_credentials(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<AuthConfig>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    blocking(&state, move |state| match auth::load_oauth_credentials(&app_data_dir) {
        Ok(creds) => {
            let config = AuthConfig { client_id: creds.client_id, client_secret: creds.client_secret };
            *state.stored_credentials.lock().map_err(|_| "Lock error")? = Some(config.clone());
            Ok(Some(config))
        }
        Err(auth::AuthError::NoCredentials) => Ok(None),
        Err(e) => Err(e.to_string()),
    })
    .await
}

/// Full OAuth flow: opens browser, waits for callback, exchanges code
#[tauri::command]
pub async fn run_oauth_flow(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Account, String> {
    let pending = PendingOAuth::begin(&state.oauth_cancel)?;

    // Bind the callback listener BEFORE opening the browser so the redirect
    // can't race the bind. Retry briefly: a just-cancelled flow may still be
    // releasing the port (its wait loop polls every ~100ms).
    let server = tokio::task::spawn_blocking(|| {
        let mut last_err = String::new();
        for _ in 0..20 {
            match CallbackServer::bind() {
                Ok(server) => return Ok(server),
                Err(e) => {
                    last_err = e;
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
        Err(last_err)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("OAuth callback error: {}", e))?;

    // Start OAuth flow and get authorization URL
    let (auth_url, expected_state) = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard
            .as_ref()
            .ok_or("Auth not configured. Call configure_auth first.")?;

        auth.start_auth_flow()
            .await
            .map_err(|e| e.to_string())?
    };

    use tauri_plugin_opener::open_url;
    open_url(&auth_url, None::<String>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;
    let waiting_url = WaitingOAuthUrl::publish(&state.oauth_url, auth_url)?;

    // Wait for callback in a blocking thread
    let wait_cancel = pending.flag.clone();
    let callback_result = tokio::task::spawn_blocking(move || server.wait_for_callback(OAUTH_CALLBACK_TIMEOUT_SECS, wait_cancel, &expected_state))
        .await
        .map_err(|e| format!("Task error: {}", e))?;
    drop(waiting_url);
    drop(pending);

    let callback_result = callback_result.map_err(|e| format!("OAuth callback error: {}", e))?;

    // Exchange code for tokens
    let (access_token, refresh_token, expires_in) = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard.as_ref().ok_or("Auth not configured")?;
        auth.exchange_code(callback_result.code, callback_result.state.as_deref())
            .await
            .map_err(|e| e.to_string())?
    };

    // Finalize the OAuth flow and return account
    finalize_oauth(&access_token, &refresh_token, expires_in, &app_handle, &state).await
}

/// The cancel flag of the sign-in in flight, held in the app's slot until
/// the flow stops waiting on the browser or returns early
struct PendingOAuth<'a> {
    slot: &'a std::sync::Mutex<Option<Arc<AtomicBool>>>,
    flag: Arc<AtomicBool>,
}

impl<'a> PendingOAuth<'a> {
    /// Cancels any previous flow, so it releases port 8420 promptly
    fn begin(slot: &'a std::sync::Mutex<Option<Arc<AtomicBool>>>) -> Result<Self, String> {
        let mut current = slot.lock().map_err(|_| "Lock error")?;
        if let Some(prev) = current.take() {
            prev.store(true, Ordering::SeqCst);
        }
        let flag = Arc::new(AtomicBool::new(false));
        *current = Some(flag.clone());
        Ok(Self { slot, flag })
    }
}

impl Drop for PendingOAuth<'_> {
    fn drop(&mut self) {
        let mut current = self.slot.lock().unwrap_or_else(|e| e.into_inner());
        if current.as_ref().is_some_and(|f| Arc::ptr_eq(f, &self.flag)) {
            *current = None;
        }
    }
}

/// Stop the sign-in waiting on the browser; it then fails with "OAuth flow
/// cancelled" and releases the callback port
#[tauri::command]
pub async fn cancel_oauth_flow(state: State<'_, AppState>) -> Result<(), String> {
    cancel_pending_oauth(&state.oauth_cancel)
}

fn cancel_pending_oauth(slot: &std::sync::Mutex<Option<Arc<AtomicBool>>>) -> Result<(), String> {
    if let Some(flag) = slot.lock().map_err(|_| "Lock error")?.take() {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Open Google's sign-in page again for the flow waiting on the browser
#[tauri::command]
pub async fn reopen_oauth_page(state: State<'_, AppState>) -> Result<(), String> {
    let url = pending_oauth_url(&state.oauth_url)?;
    tauri_plugin_opener::open_url(&url, None::<String>).map_err(|e| format!("Failed to open browser: {}", e))
}

fn pending_oauth_url(slot: &std::sync::Mutex<Option<String>>) -> Result<String, String> {
    slot.lock()
        .map_err(|_| "Lock error")?
        .clone()
        .ok_or_else(|| "No sign-in is waiting on the browser".to_string())
}

/// The sign-in page of the flow waiting on the browser, published in the
/// app's slot until that flow stops waiting
struct WaitingOAuthUrl<'a> {
    slot: &'a std::sync::Mutex<Option<String>>,
    url: String,
}

impl<'a> WaitingOAuthUrl<'a> {
    fn publish(slot: &'a std::sync::Mutex<Option<String>>, url: String) -> Result<Self, String> {
        *slot.lock().map_err(|_| "Lock error")? = Some(url.clone());
        Ok(Self { slot, url })
    }
}

impl Drop for WaitingOAuthUrl<'_> {
    fn drop(&mut self) {
        let mut current = self.slot.lock().unwrap_or_else(|e| e.into_inner());
        if current.as_deref() == Some(self.url.as_str()) {
            *current = None;
        }
    }
}

struct UserInfo {
    email: String,
    picture: Option<String>,
}

/// Finalize OAuth by creating account and storing tokens
async fn finalize_oauth(
    access_token: &str,
    refresh_token: &str,
    expires_in: Option<u64>,
    app_handle: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<Account, String> {
    let user_info = get_user_info(access_token).await?;
    let app_data_dir = get_app_data_dir(app_handle)?;
    let refresh_token = refresh_token.to_string();
    let account = blocking(state, move |state| save_signed_in_account(state, user_info, &refresh_token, &app_data_dir)).await?;

    // Cache the fresh access token, replacing any stale entry for this account
    let expiry = Instant::now() + Duration::from_secs(expires_in.unwrap_or(3600));
    state
        .token_cache
        .lock()
        .map_err(|_| "Lock error")?
        .insert(account.id.clone(), (access_token.to_string(), expiry));

    Ok(account)
}

/// Store the refresh token and the account of a completed sign-in. Signing in
/// again keeps the account's id, so its cards keep pointing at it.
fn save_signed_in_account(
    state: &AppState,
    user_info: UserInfo,
    refresh_token: &str,
    app_data_dir: &std::path::Path,
) -> Result<Account, String> {
    let existing = with_db(state, |db| db.get_account_by_email(&user_info.email).map_err(|e| e.to_string()))?;
    let account = match existing {
        Some(mut account) => {
            account.picture = user_info.picture;
            account
        }
        None => Account::new(user_info.email, user_info.picture),
    };

    auth::store_refresh_token(&account.id, refresh_token, app_data_dir).map_err(|e| e.to_string())?;
    with_db(state, |db| db.insert_account(&account).map_err(|e| e.to_string()))?;
    Ok(account)
}

const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

/// A sign-in waits on this request; without a timeout a connection that
/// never answers leaves it spinning forever
fn userinfo_http_client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder().timeout(timeout).build().unwrap_or_else(|_| reqwest::Client::new())
}

async fn get_user_info(access_token: &str) -> Result<UserInfo, String> {
    fetch_user_info(&userinfo_http_client(Duration::from_secs(30)), USERINFO_URL, access_token).await
}

async fn fetch_user_info(client: &reqwest::Client, url: &str, access_token: &str) -> Result<UserInfo, String> {
    let resp = client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Couldn't read your Google account: {}", e.without_url()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(match google_error_message(&body) {
            Some(message) => format!("Couldn't read your Google account ({}): {}", status, message),
            None => format!("Couldn't read your Google account ({})", status),
        });
    }

    #[derive(Deserialize)]
    struct GoogleUserInfo {
        email: String,
        picture: Option<String>,
    }

    let info: GoogleUserInfo = resp
        .json()
        .await
        .map_err(|e| format!("Couldn't read your Google account: unexpected response ({})", e.without_url()))?;
    Ok(UserInfo {
        email: info.email,
        picture: info.picture,
    })
}

/// The readable message in a Google error body: `error.message` from the
/// APIs, or `error_description` from the OAuth endpoints
fn google_error_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let message = [&value["error"]["message"], &value["error_description"]]
        .into_iter()
        .find_map(|v| v.as_str().filter(|s| !s.trim().is_empty()))
        .map(str::to_string);
    message
}

#[tauri::command]
pub async fn get_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, String> {
    blocking(&state, |state| with_db(state, |db| db.get_accounts().map_err(|e| e.to_string()))).await
}

#[tauri::command]
pub async fn delete_account(account_id: String, app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    blocking(&state, move |state| delete_account_blocking(&account_id, &app_data_dir, state)).await
}

fn delete_account_blocking(account_id: &str, app_data_dir: &std::path::Path, state: &AppState) -> Result<(), String> {
    // Delete from database
    with_db(state, |db| db.delete_account(account_id).map_err(|e| e.to_string()))?;

    // Delete stored refresh token
    auth::delete_refresh_token(account_id, app_data_dir).map_err(|e| e.to_string())?;

    // Drop any cached access token for this account
    if let Ok(mut cache) = state.token_cache.lock() {
        cache.remove(account_id);
    }
    crate::gmail::forget_cached_mail();

    Ok(())
}

#[tauri::command]
pub async fn update_account_signature(account_id: String, signature: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| {
        with_db(state, |db| db.update_account_signature(&account_id, signature.as_deref()).map_err(|e| e.to_string()))
    })
    .await
}

/// The board: every signed-in account's cards and the all-inboxes cards
#[tauri::command]
pub async fn get_cards(state: State<'_, AppState>) -> Result<Vec<Card>, String> {
    blocking(&state, |state| with_db(state, |db| db.get_board_cards().map_err(|e| e.to_string()))).await
}

#[tauri::command]
pub async fn create_card(
    account_id: String,
    name: String,
    query: String,
    color: Option<String>,
    group_by: Option<String>,
    card_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<Card, String> {
    blocking(&state, move |state| {
        change_cards(state, None, |db| insert_new_card(db, account_id, name, query, color, group_by, card_type))
    })
    .await
}

/// A new card of `account_id` (a signed-in account, or `ALL_ACCOUNTS`) at the
/// end of the board
fn insert_new_card(
    db: &CacheDb,
    account_id: String,
    name: String,
    query: String,
    color: Option<String>,
    group_by: Option<String>,
    card_type: Option<String>,
) -> Result<Card, String> {
    check_card_scope(db, &account_id)?;
    let position = next_card_position(&db.get_board_cards().map_err(|e| e.to_string())?);
    let mut card = if card_type.as_deref() == Some("calendar") {
        Card::new_calendar(account_id, name, query, position)
    } else {
        Card::new(account_id, name, query, position)
    };
    card.color = color;
    card.group_by = group_by.unwrap_or_else(|| "date".to_string());
    db.insert_card(&card).map_err(|e| e.to_string())?;
    Ok(card)
}

/// Ok for a signed-in account's id or `ALL_ACCOUNTS`
fn check_card_scope(db: &CacheDb, account_id: &str) -> Result<(), String> {
    if account_id == ALL_ACCOUNTS || db.get_accounts().map_err(|e| e.to_string())?.iter().any(|a| a.id == account_id) {
        Ok(())
    } else {
        Err("Account not found".to_string())
    }
}

#[tauri::command]
pub async fn update_card(card: Card, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| {
        change_cards(state, None, |db| {
            check_card_scope(db, &card.account_id)?;
            db.update_card(&card).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
pub async fn delete_card(id: String, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| {
        change_cards(state, Some(id.as_str()), |db| db.delete_card(&id).map_err(|e| e.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn reorder_cards(orders: Vec<(String, i32)>, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| change_cards(state, None, |db| db.reorder_cards(&orders).map_err(|e| e.to_string()))).await
}

/// Positions keep gaps after a delete, so count-based numbering can collide
fn next_card_position(cards: &[Card]) -> i32 {
    cards.iter().map(|c| c.position + 1).max().unwrap_or(0)
}

/// A card on the board, or "Card not found"
async fn find_card(state: &AppState, card_id: &str) -> Result<Card, String> {
    let card_id = card_id.to_string();
    blocking(state, move |state| with_db(state, |db| board_card(db, &card_id))).await
}

fn board_card(db: &CacheDb, card_id: &str) -> Result<Card, String> {
    db.get_card(card_id)
        .map_err(|e| e.to_string())?
        .filter(|card| check_card_scope(db, &card.account_id).is_ok())
        .ok_or_else(|| "Card not found".to_string())
}

/// Search results don't say whose mailbox they came from
fn tag_thread_groups(groups: &mut [ThreadGroup], account_id: &str) {
    for thread in groups.iter_mut().flat_map(|g| g.threads.iter_mut()) {
        thread.account_id = account_id.to_string();
    }
}

/// The cached token, if it is good for at least another minute
fn cached_access_token(token_cache: &TokenCache, account_id: &str) -> Result<Option<String>, String> {
    let cache = token_cache.lock().map_err(|_| "Lock error")?;
    Ok(cache
        .get(account_id)
        .filter(|(_, expiry)| expiry.saturating_duration_since(Instant::now()) > Duration::from_secs(60))
        .map(|(token, _)| token.clone()))
}

/// Helper to get a valid access token for an account (refreshing if needed)
async fn get_access_token(
    state: &AppState,
    app_handle: &tauri::AppHandle,
    account_id: &str,
) -> Result<String, String> {
    let app_data_dir = get_app_data_dir(app_handle)?;
    let account = account_id.to_string();
    refreshed_access_token(&state.auth, &state.token_cache, account_id, move || {
        auth::get_refresh_token(&account, &app_data_dir).map_err(|e| e.to_string())
    })
    .await
}

/// Exchanges a refresh token for an access token
trait TokenRefresher {
    async fn refresh(&self, refresh_token: &str) -> Result<(String, Option<u64>), String>;
}

impl TokenRefresher for GmailAuth {
    async fn refresh(&self, refresh_token: &str) -> Result<(String, Option<u64>), String> {
        self.refresh_access_token(refresh_token).await.map_err(|e| e.to_string())
    }
}

/// The cached access token, or a fresh one refreshed with the refresh token
/// `load_refresh_token` reads from secure storage
async fn refreshed_access_token<R: TokenRefresher>(
    auth: &Mutex<Option<R>>,
    token_cache: &TokenCache,
    account_id: &str,
    load_refresh_token: impl FnOnce() -> Result<String, String> + Send + 'static,
) -> Result<String, String> {
    if let Some(token) = cached_access_token(token_cache, account_id)? {
        return Ok(token);
    }

    let (access_token, expires_in) = {
        let auth_guard = auth.lock().await;
        // Parallel calls queue on the auth lock; the first one reads secure
        // storage and refreshes, and the rest reuse its token
        if let Some(token) = cached_access_token(token_cache, account_id)? {
            return Ok(token);
        }
        let auth = auth_guard
            .as_ref()
            .ok_or("Auth not configured. Please configure auth first.")?;

        // A keychain read can wait on a user prompt; keep it off the async workers
        let refresh_token = tokio::task::spawn_blocking(load_refresh_token)
            .await
            .map_err(|e| format!("Task error: {}", e))??;
        auth.refresh(&refresh_token).await?
    };

    let expiry = Instant::now() + Duration::from_secs(expires_in.unwrap_or(3600));
    token_cache
        .lock()
        .map_err(|_| "Lock error")?
        .insert(account_id.to_string(), (access_token.clone(), expiry));

    Ok(access_token)
}

/// Access token for an account that must exist locally
async fn account_access_token(
    state: &AppState,
    app_handle: &tauri::AppHandle,
    account_id: &str,
) -> Result<String, String> {
    find_account(state, account_id).await?;
    get_access_token(state, app_handle, account_id).await
}

/// Gmail and People errors embed the HTTP status ("401 Unauthorized"), most
/// calendar errors are rewritten into friendly messages, and the RSVP calls
/// carry only Google's JSON error body, whose status is "UNAUTHENTICATED"
fn is_auth_error(e: &str) -> bool {
    e.contains("401 Unauthorized")
        || e.contains("Calendar access expired")
        || e.contains("\"UNAUTHENTICATED\"")
}

/// Evict the account's cached access token when an API call failed with an
/// auth error (revoked/expired token), so the next call refreshes the token
/// instead of reusing the stale one for its remaining cached lifetime.
/// Matches raw 401 errors (Gmail/People) and the friendly calendar message.
fn evict_token_on_auth_error<T>(
    state: &AppState,
    account_id: &str,
    result: Result<T, String>,
) -> Result<T, String> {
    if let Err(e) = &result {
        if is_auth_error(e) {
            if let Ok(mut cache) = state.token_cache.lock() {
                if cache.remove(account_id).is_some() {
                    tracing::info!(
                        "Evicted cached access token for account {} after auth error",
                        account_id
                    );
                }
            }
        }
    }
    result
}

/// A page of a card's threads. The card's account is read from the card, so
/// a fetch in flight while the card is moved still lists one mailbox.
#[tauri::command]
pub async fn fetch_threads_paginated(
    card_id: String,
    page_token: Option<String>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    tracing::info!("fetch_threads_paginated for card: {}, page_token: {:?}", card_id, page_token);

    let card = find_card(&state, &card_id).await?;
    if card.account_id == ALL_ACCOUNTS {
        let accounts = blocking(&state, |state| with_db(state, |db| db.get_accounts().map_err(|e| e.to_string()))).await?;
        let open = |account: &Account| {
            let (state, app_handle, account_id) = (state.inner().clone(), app_handle.clone(), account.id.clone());
            async move { get_access_token(&state, &app_handle, &account_id).await.map(GmailClient::new) }
        };
        return all_inboxes_page(&accounts, &card.query, page_token.as_deref(), open)
            .await
            .map_err(|(account_id, e)| evict_token_on_auth_error::<()>(&state, &account_id, Err(e)).unwrap_err());
    }
    let account_id = card.account_id.clone();
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;

    let gmail = GmailClient::new(access_token);
    let mut result = evict_token_on_auth_error(
        &state,
        &account_id,
        gmail
            .search_threads_paginated(&card.query, page_token.as_deref())
            .await,
    )
    .map_err(|e| format!("Search failed: {}", e))?;
    tag_thread_groups(&mut result.groups, &account_id);

    tracing::info!("Found {} groups, has_more: {}", result.groups.len(), result.has_more);

    Ok(result)
}

/// Lists one account's threads for an all-inboxes card
trait MailboxLister {
    async fn list_ids(&self, query: &str, page: Option<&str>) -> Result<(Vec<String>, Option<String>), String>;
    async fn details(&self, ids: &[String]) -> Result<Vec<crate::models::Thread>, String>;
}

impl MailboxLister for GmailClient {
    async fn list_ids(&self, query: &str, page: Option<&str>) -> Result<(Vec<String>, Option<String>), String> {
        self.list_thread_ids(query, page, crate::gmail::PAGE_SIZE).await
    }

    async fn details(&self, ids: &[String]) -> Result<Vec<crate::models::Thread>, String> {
        self.batch_get_thread_details(ids).await
    }
}

/// A page of an all-inboxes card: every account's next threads merged (see
/// `unified::merge_account_pages`). `page_token` is the cursor the previous
/// page returned. Fails whole when any account fails, with that account's
/// id and the error named after its email.
async fn all_inboxes_page<M, F, Fut>(
    accounts: &[Account],
    query: &str,
    page_token: Option<&str>,
    open: F,
) -> Result<SearchResult, (String, String)>
where
    M: MailboxLister,
    F: Fn(&Account) -> Fut,
    Fut: std::future::Future<Output = Result<M, String>>,
{
    use crate::unified::{account_error, listed_accounts, merge_account_pages, AccountPage, Cursor};
    let cursor = match page_token {
        Some(token) => Cursor::parse(token).map_err(|e| (String::new(), e))?,
        None => Cursor::start(accounts.iter().map(|a| a.id.as_str())),
    };
    let signed_in: std::collections::HashSet<&str> = accounts.iter().map(|a| a.id.as_str()).collect();
    let requests = listed_accounts(&cursor, &signed_in).into_iter().map(|(account_id, at)| {
        let account = accounts.iter().find(|a| &a.id == account_id).expect("signed in");
        let open = &open;
        async move {
            let fail = |e: String| (account.id.clone(), account_error(&account.email, &e));
            let mailbox = open(account).await.map_err(fail)?;
            let search_failed = |e: String| fail(format!("Search failed: {}", e));
            let (ids, next_page_token) = mailbox.list_ids(query, at.page.as_deref()).await.map_err(search_failed)?;
            let skip = at.skip.min(ids.len());
            let mut threads =
                if skip < ids.len() { mailbox.details(&ids[skip..]).await.map_err(search_failed)? } else { Vec::new() };
            for thread in &mut threads {
                thread.account_id = account.id.clone();
            }
            Ok::<_, (String, String)>(AccountPage { account_id: account.id.clone(), ids, skip, threads, page: at.page.clone(), next_page_token })
        }
    });
    let pages = futures::future::try_join_all(requests).await?;
    let (threads, cursor) = merge_account_pages(pages);
    let next_page_token = cursor.token();
    Ok(SearchResult {
        groups: crate::gmail::group_threads_by_date(threads, &chrono::Local::now()),
        has_more: next_page_token.is_some(),
        next_page_token,
    })
}

/// Result of incremental sync
#[derive(Debug, serde::Serialize)]
pub struct IncrementalSyncResult {
    pub modified_threads: Vec<crate::models::Thread>,
    pub deleted_thread_ids: Vec<String>,
    pub new_history_id: String,
    pub is_full_sync: bool,
}

#[tauri::command]
pub async fn sync_threads_incremental(
    account_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<IncrementalSyncResult, String> {
    let result = sync_threads_incremental_impl(&account_id, &app_handle, &state).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

/// Requested thread ids that the fetch did not return
fn vanished_thread_ids(requested: &[String], fetched: &[crate::models::Thread]) -> Vec<String> {
    let fetched: std::collections::HashSet<&str> =
        fetched.iter().map(|t| t.gmail_thread_id.as_str()).collect();
    let mut vanished: Vec<String> = Vec::new();
    for id in requested {
        if !fetched.contains(id.as_str()) && !vanished.contains(id) {
            vanished.push(id.clone());
        }
    }
    vanished
}

async fn sync_threads_incremental_impl(
    account_id: &str,
    app_handle: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<IncrementalSyncResult, String> {
    tracing::info!("sync_threads_incremental for account: {}", account_id);

    let account = account_id.to_string();
    let stored_history_id =
        blocking(state, move |state| with_db(state, |db| db.get_history_id(&account).map_err(|e| e.to_string())))
            .await?;

    let access_token = get_access_token(state, app_handle, account_id).await?;
    let gmail = GmailClient::new(access_token);
    let mut result = sync_mail_history(&gmail, stored_history_id.as_deref()).await?;
    for thread in &mut result.modified_threads {
        thread.account_id = account_id.to_string();
    }

    // Only advanced once the changes are in hand, so a failed sync is
    // retried from the same point
    let (account, history_id) = (account_id.to_string(), result.new_history_id.clone());
    blocking(state, move |state| {
        with_db(state, |db| db.set_history_id(&account, &history_id).map_err(|e| e.to_string()))
    })
    .await?;
    Ok(result)
}

/// The Gmail calls an incremental sync makes
trait MailHistory {
    async fn history_changes(&self, since: &str) -> Result<crate::gmail::HistoryChanges, String>;
    async fn split_deleted_threads(&self, thread_ids: &[String]) -> Result<(Vec<String>, Vec<String>), String>;
    async fn thread_details(&self, thread_ids: &[String]) -> Result<Vec<crate::models::Thread>, String>;
    async fn current_history_id(&self) -> Result<String, String>;
}

impl MailHistory for GmailClient {
    async fn history_changes(&self, since: &str) -> Result<crate::gmail::HistoryChanges, String> {
        self.get_history_changes(since).await
    }

    async fn split_deleted_threads(&self, thread_ids: &[String]) -> Result<(Vec<String>, Vec<String>), String> {
        GmailClient::split_deleted_threads(self, thread_ids).await
    }

    async fn thread_details(&self, thread_ids: &[String]) -> Result<Vec<crate::models::Thread>, String> {
        self.batch_get_thread_details(thread_ids).await
    }

    async fn current_history_id(&self) -> Result<String, String> {
        self.get_current_history_id().await
    }
}

/// Past this many changed threads, fetching each one costs more than the
/// frontend refetching its open cards, which it does anyway for most of them
const MAX_INCREMENTAL_THREADS: usize = 100;

/// Changes since `stored_history_id`, or a full sync (the frontend refetches
/// its cards) when there is none, it expired, or the backlog is too large
async fn sync_mail_history(
    gmail: &impl MailHistory,
    stored_history_id: Option<&str>,
) -> Result<IncrementalSyncResult, String> {
    let Some(history_id) = stored_history_id else {
        tracing::info!("No history ID found, performing initial full sync");
        return full_sync(gmail).await;
    };

    let changes = match gmail.history_changes(history_id).await {
        Ok(changes) => changes,
        Err(e) if e == crate::gmail::HISTORY_EXPIRED => {
            tracing::warn!("History ID expired, performing full sync");
            return full_sync(gmail).await;
        }
        Err(e) => return Err(e),
    };
    tracing::info!(
        "Incremental sync: {} modified threads, {} deletion candidates, {} deleted messages",
        changes.modified_thread_ids.len(),
        changes.deleted_thread_ids.len(),
        changes.deleted_message_ids.len()
    );

    if changes.modified_thread_ids.len() + changes.deleted_thread_ids.len() > MAX_INCREMENTAL_THREADS {
        tracing::info!("Too many changed threads to fetch one by one, refetching cards instead");
        return Ok(IncrementalSyncResult {
            modified_threads: Vec::new(),
            deleted_thread_ids: Vec::new(),
            new_history_id: changes.new_history_id,
            is_full_sync: true,
        });
    }

    // Verify deletion candidates: a thread that still exists only lost some
    // messages and must be treated as modified
    let mut modified_thread_ids = changes.modified_thread_ids;
    let (still_existing, mut deleted_thread_ids) = gmail.split_deleted_threads(&changes.deleted_thread_ids).await?;
    modified_thread_ids.extend(still_existing);

    let mut modified_threads = Vec::new();
    if !modified_thread_ids.is_empty() {
        modified_threads = gmail
            .thread_details(&modified_thread_ids)
            .await
            .map_err(|e| format!("Failed to fetch modified threads: {}", e))?;

        // A thread deleted between the history call and the fetch comes back
        // missing rather than as an error
        deleted_thread_ids.extend(vanished_thread_ids(&modified_thread_ids, &modified_threads));
    }

    Ok(IncrementalSyncResult {
        modified_threads,
        deleted_thread_ids,
        new_history_id: changes.new_history_id,
        is_full_sync: false,
    })
}

/// Establish a history ID for later incremental syncs; the frontend does its
/// normal card fetch, so the card queries aren't duplicated here
async fn full_sync(gmail: &impl MailHistory) -> Result<IncrementalSyncResult, String> {
    let history_id = gmail
        .current_history_id()
        .await
        .map_err(|e| format!("Failed to get history ID: {}", e))?;
    Ok(IncrementalSyncResult {
        modified_threads: Vec::new(),
        deleted_thread_ids: Vec::new(),
        new_history_id: history_id,
        is_full_sync: true,
    })
}

#[tauri::command]
pub async fn modify_threads(
    account_id: String,
    thread_ids: Vec<String>,
    add_labels: Vec<String>,
    remove_labels: Vec<String>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    let results = for_each_thread(thread_ids, |thread_id| {
        let (gmail, add, remove) = (&gmail, add_labels.clone(), remove_labels.clone());
        async move { gmail.modify_thread(&thread_id, add, remove).await }
    })
    .await;

    settle_thread_results(&state, &account_id, results)
}

/// Ok when every thread went through, else one failure, counting the others:
/// an auth error if there is one, since it evicts the cached token and
/// signing in fixes it, else the first
fn settle_thread_results(
    state: &AppState,
    account_id: &str,
    results: Vec<(String, Result<(), String>)>,
) -> Result<(), String> {
    let total = results.len();
    let failures: Vec<(String, String)> =
        results.into_iter().filter_map(|(id, r)| r.err().map(|e| (id, e))).collect();
    let Some((id, e)) = failures.iter().find(|(_, e)| is_auth_error(e)).or(failures.first()) else {
        return Ok(());
    };
    let message = match failures.len() {
        1 => format!("Failed to modify thread {}: {}", id, e),
        n => format!("Failed to modify {} of {} threads: {}", n, total, e),
    };
    evict_token_on_auth_error(state, account_id, Err(message))
}

/// Gmail answers 429 "Too many concurrent requests for user" past a few
/// requests in flight, so a bulk action on a large selection runs this many
/// at a time
const MAX_CONCURRENT_THREAD_REQUESTS: usize = 8;

/// Each thread id with the result of its request
async fn for_each_thread<F, Fut>(thread_ids: Vec<String>, mut request: F) -> Vec<(String, Result<(), String>)>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    use futures::StreamExt;
    futures::stream::iter(thread_ids)
        .map(|id| {
            let response = request(id.clone());
            async move { (id, response.await) }
        })
        .buffer_unordered(MAX_CONCURRENT_THREAD_REQUESTS)
        .collect()
        .await
}

/// Search threads by query (for preview, limited results)
#[tauri::command]
pub async fn search_threads_preview(
    account_id: String,
    query: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<ThreadGroup>, String> {
    const PREVIEW_THREADS: usize = 5;
    let accounts = scope_accounts(&state, &account_id).await?;
    let searches = accounts.iter().map(|account| {
        let (state, app_handle, query) = (&state, &app_handle, &query);
        async move {
            let access_token = get_access_token(state, app_handle, &account.id).await?;
            let result = GmailClient::new(access_token).search_threads_limited(query, PREVIEW_THREADS).await;
            let mut groups = evict_token_on_auth_error(state, &account.id, result).map_err(|e| format!("Search failed: {}", e))?;
            tag_thread_groups(&mut groups, &account.id);
            Ok::<_, String>(groups)
        }
    });
    let by_account = in_scope(&account_id, &accounts, futures::future::join_all(searches).await)?;
    if by_account.len() == 1 && account_id != ALL_ACCOUNTS {
        return Ok(by_account.into_iter().next().unwrap_or_default());
    }
    let threads = by_account.into_iter().flatten().flat_map(|g| g.threads).collect();
    Ok(crate::gmail::group_threads_by_date(crate::unified::newest_threads(threads, PREVIEW_THREADS), &chrono::Local::now()))
}

/// The accounts a card of `account_id` covers: that one, or every signed-in
/// account for `ALL_ACCOUNTS`
async fn scope_accounts(state: &AppState, account_id: &str) -> Result<Vec<Account>, String> {
    if account_id != ALL_ACCOUNTS {
        return Ok(vec![find_account(state, account_id).await?]);
    }
    blocking(state, |state| with_db(state, |db| db.get_accounts().map_err(|e| e.to_string()))).await
}

/// Each account's result, or the first failure; for an all-inboxes card the
/// failure names its account's email
fn in_scope<T>(account_id: &str, accounts: &[Account], results: Vec<Result<T, String>>) -> Result<Vec<T>, String> {
    accounts
        .iter()
        .zip(results)
        .map(|(account, result)| {
            result.map_err(|e| if account_id == ALL_ACCOUNTS { crate::unified::account_error(&account.email, &e) } else { e })
        })
        .collect()
}

#[tauri::command]
pub async fn get_thread_details(
    account_id: String,
    thread_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<crate::gmail::FullThread, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, gmail.get_thread(&thread_id).await)
}

#[tauri::command]
pub async fn send_email(
    account_id: String,
    to: String,
    cc: String,
    bcc: String,
    subject: String,
    body: String,
    attachments: Vec<SendAttachment>,
    is_html: Option<bool>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    let message = OutgoingMessage {
        to: &to,
        cc: &cc,
        bcc: &bcc,
        subject: &subject,
        body: &body,
        attachments: &attachments,
        is_html: is_html.unwrap_or(false),
    };
    let result = gmail.send_email(&message).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

#[tauri::command]
pub async fn reply_to_thread(
    account_id: String,
    thread_id: String,
    to: String,
    cc: String,
    bcc: String,
    subject: String,
    body: String,
    message_id: Option<String>,
    attachments: Vec<SendAttachment>,
    is_html: Option<bool>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    let message = OutgoingMessage {
        to: &to,
        cc: &cc,
        bcc: &bcc,
        subject: &subject,
        body: &body,
        attachments: &attachments,
        is_html: is_html.unwrap_or(false),
    };
    let result = gmail.reply_to_thread(&thread_id, message_id.as_deref(), &message).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

#[tauri::command]
pub async fn send_reaction(
    account_id: String,
    thread_id: String,
    message_id: String,
    emoji: String,
    to_email: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let from_email = get_account_email(&state, &account_id).await?;
    let access_token = get_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    let result = gmail.send_reaction(&thread_id, &message_id, &emoji, &from_email, &to_email).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

/// Posts a mailing list's one-click unsubscribe request (RFC 8058)
#[tauri::command]
pub async fn unsubscribe_one_click(url: String) -> Result<(), String> {
    let url = crate::unsubscribe::one_click_url(&url)?;
    crate::unsubscribe::post_one_click(&crate::unsubscribe::HTTP_CLIENT, url).await
}

#[derive(Debug, Serialize)]
pub struct CachedCardThreads {
    pub groups: Vec<ThreadGroup>,
    pub next_page_token: Option<String>,
    pub cached_at: i64,
}

#[tauri::command]
pub async fn get_cached_card_threads(
    card_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CachedCardThreads>, String> {
    blocking(&state, move |state| {
        with_db(state, |db| match db.get_card_threads(&card_id) {
            Ok(Some((groups, next_page_token, cached_at))) => Ok(Some(CachedCardThreads {
                groups,
                next_page_token,
                cached_at,
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        })
    })
    .await
}

#[tauri::command]
pub async fn save_cached_card_threads(
    card_id: String,
    groups: Vec<ThreadGroup>,
    next_page_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    blocking(&state, move |state| {
        save_card_cache(state, &card_id, |db| db.save_card_threads(&card_id, &groups, next_page_token.as_deref()))
    })
    .await
}

/// Save a card's cache, unless the card was deleted while it was being
/// refreshed; nothing would ever remove that row
fn save_card_cache(
    state: &AppState,
    card_id: &str,
    save: impl FnOnce(&CacheDb) -> Result<(), crate::cache::sqlite::CacheError>,
) -> Result<(), String> {
    // The database lock is held from the check through the save, so a
    // deletion can't slip in between
    with_db(state, |db| {
        if db.card_exists(card_id).map_err(|e| e.to_string())? {
            save(db).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn clear_card_cache(card_id: String, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| with_db(state, |db| db.clear_card_cache(&card_id).map_err(|e| e.to_string()))).await
}

#[derive(Debug, Serialize)]
pub struct CachedCardEvents {
    pub events: Vec<crate::models::GoogleCalendarEvent>,
    pub cached_at: i64,
}

#[tauri::command]
pub async fn get_cached_card_events(
    card_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CachedCardEvents>, String> {
    blocking(&state, move |state| {
        with_db(state, |db| match db.get_card_events(&card_id) {
            Ok(Some((events, cached_at))) => Ok(Some(CachedCardEvents {
                events,
                cached_at,
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        })
    })
    .await
}

#[tauri::command]
pub async fn save_cached_card_events(
    card_id: String,
    events: Vec<crate::models::GoogleCalendarEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    blocking(&state, move |state| save_card_cache(state, &card_id, |db| db.save_card_events(&card_id, &events))).await
}

#[tauri::command]
pub async fn download_attachment(
    account_id: String,
    message_id: String,
    attachment_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    evict_token_on_auth_error(
        &state,
        &account_id,
        gmail.get_attachment(&message_id, &attachment_id).await,
    )
}

fn get_extension_for_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/bmp" => Some("bmp"),
        "image/tiff" => Some("tiff"),
        "application/pdf" => Some("pdf"),
        "text/plain" => Some("txt"),
        "text/html" => Some("html"),
        "text/css" => Some("css"),
        "text/csv" => Some("csv"),
        "application/json" => Some("json"),
        "application/xml" => Some("xml"),
        "application/zip" => Some("zip"),
        "application/gzip" => Some("gz"),
        "audio/mpeg" => Some("mp3"),
        "audio/wav" => Some("wav"),
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "application/msword" => Some("doc"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.ms-excel" => Some("xls"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        _ => None,
    }
}

/// The filename comes from the sender; keep only the final path component so
/// it can't escape the directory it is written into
fn sanitize_attachment_filename(name: &str) -> String {
    std::path::Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "attachment".to_string())
}

/// Fetch attachment bytes (inline or via Gmail API) and normalize the filename
async fn resolve_attachment_file(
    account_id: &str,
    message_id: &str,
    attachment_id: Option<String>,
    filename: &str,
    mime_type: Option<&str>,
    inline_data: Option<String>,
    app_handle: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<(String, Vec<u8>), String> {
    let base64_data = if let Some(data) = inline_data {
        data
    } else {
        let attachment_id = attachment_id.ok_or("No attachment ID or inline data")?;
        let access_token = account_access_token(state, app_handle, account_id).await?;
        let gmail = GmailClient::new(access_token);
        evict_token_on_auth_error(
            state,
            account_id,
            gmail.get_attachment(message_id, &attachment_id).await,
        )?
    };

    // Decode base64 - Gmail uses URL-safe encoding, handle with/without padding
    let cleaned = base64_data.trim_end_matches('=');
    let bytes = URL_SAFE_NO_PAD
        .decode(cleaned)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    Ok((attachment_filename(filename, mime_type), bytes))
}

/// Safe on-disk name for an attachment, with an extension derived from the
/// MIME type when the sender's name has none
fn attachment_filename(filename: &str, mime_type: Option<&str>) -> String {
    let name = sanitize_attachment_filename(filename);
    if name.contains('.') {
        return name;
    }
    match mime_type.and_then(get_extension_for_mime) {
        Some(ext) => format!("{}.{}", name, ext),
        None => name,
    }
}

/// Extensions that run code or change the system when opened from the file
/// manager, rather than being shown by a viewer
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "app", "command", "terminal", "tool", "sh", "bash", "zsh", "csh", "ksh", "fish",
    "pkg", "mpkg", "workflow", "action", "scpt", "scptd", "applescript", "osax",
    "prefpane", "mobileconfig", "kext", "plugin", "jar", "py", "pl", "rb", "php",
    "fileloc", "inetloc", "webloc", "url", "desktop", "appimage", "run", "deb", "rpm",
    "exe", "com", "scr", "msi", "msp", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "hta", "lnk", "reg", "cpl",
];

/// Leads the error open_attachment returns for a file it refuses to open;
/// the frontend matches it to offer saving instead
const EXECUTABLE_ATTACHMENT_ERROR: &str = "EXECUTABLE_ATTACHMENT";

fn refuse_executable_attachment(filename: &str, mime_type: Option<&str>) -> Result<(), String> {
    if is_executable_attachment(&attachment_filename(filename, mime_type)) {
        return Err(format!(
            "{}: {} can run code on your computer, so Posta won't open it. Save it and open it yourself only if you trust the sender.",
            EXECUTABLE_ATTACHMENT_ERROR, filename
        ));
    }
    Ok(())
}

fn is_executable_attachment(filename: &str) -> bool {
    let trimmed = filename.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    match trimmed.rsplit_once('.') {
        Some((_, ext)) => EXECUTABLE_EXTENSIONS.iter().any(|e| e.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

/// Per-message directory under `base`, so same-named attachments from
/// different messages don't overwrite each other
fn attachment_temp_dir(base: &std::path::Path, message_id: &str) -> std::path::PathBuf {
    let safe: String = message_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    base.join("posta-attachments")
        .join(if safe.is_empty() { "message" } else { safe.as_str() })
}

/// Write `bytes` to `dir/filename`, or to `name (1).ext`, `name (2).ext`...
/// when taken; checking and creating the name is one atomic step. With
/// `reuse_identical`, a taken name that already holds these exact bytes is
/// returned instead of writing another copy.
fn write_unique_file(
    dir: &std::path::Path,
    filename: &str,
    bytes: &[u8],
    reuse_identical: bool,
) -> std::io::Result<std::path::PathBuf> {
    use std::io::Write;

    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e)),
        _ => (filename, None),
    };
    for counter in 0..10_000 {
        let candidate = match (counter, ext) {
            (0, _) => filename.to_string(),
            (n, Some(e)) => format!("{} ({}).{}", stem, n, e),
            (n, None) => format!("{} ({})", stem, n),
        };
        let path = dir.join(candidate);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(bytes) {
                    drop(file);
                    let _ = std::fs::remove_file(&path);
                    return Err(e);
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if reuse_identical && std::fs::read(&path).is_ok_and(|existing| existing == bytes) {
                    return Ok(path);
                }
            }
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        format!("Too many files named {}", filename),
    ))
}

/// Tag a file written from a sender's attachment with the quarantine
/// attribute browsers put on downloads, so Gatekeeper vets it before it runs
#[cfg(target_os = "macos")]
fn mark_quarantined(path: &std::path::Path) {
    let value = format!("0083;{:x};Posta;", chrono::Utc::now().timestamp());
    let status = std::process::Command::new("/usr/bin/xattr")
        .args(["-w", "com.apple.quarantine", &value])
        .arg(path)
        .status();
    if !matches!(status, Ok(s) if s.success()) {
        tracing::warn!("Failed to quarantine {:?}: {:?}", path, status);
    }
}

#[cfg(not(target_os = "macos"))]
fn mark_quarantined(_path: &std::path::Path) {}

#[tauri::command]
pub async fn open_attachment(
    account_id: String,
    message_id: String,
    attachment_id: Option<String>,
    filename: String,
    mime_type: Option<String>,
    inline_data: Option<String>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    refuse_executable_attachment(&filename, mime_type.as_deref())?;

    let (final_filename, bytes) = resolve_attachment_file(
        &account_id, &message_id, attachment_id, &filename,
        mime_type.as_deref(), inline_data, &app_handle, &state,
    ).await?;

    let dir = attachment_temp_dir(&std::env::temp_dir(), &message_id);
    let temp_path = write_attachment(&state, dir, final_filename, bytes, true).await?;

    // Open with system default application
    tauri_plugin_opener::open_path(&temp_path, None::<&str>).map_err(|e| format!("Failed to open file: {}", e))?;

    Ok(())
}

/// Save an attachment to the user's Downloads folder, returning the saved path
#[tauri::command]
pub async fn save_attachment(
    account_id: String,
    message_id: String,
    attachment_id: Option<String>,
    filename: String,
    mime_type: Option<String>,
    inline_data: Option<String>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<String, String> {
    let (final_filename, bytes) = resolve_attachment_file(
        &account_id, &message_id, attachment_id, &filename,
        mime_type.as_deref(), inline_data, &app_handle, &state,
    ).await?;

    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to get downloads dir: {}", e))?;

    let path = write_attachment(&state, download_dir, final_filename, bytes, false).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Write an attachment into `dir` under a name no other file has (see
/// `write_unique_file`) and quarantine it
async fn write_attachment(
    state: &AppState,
    dir: std::path::PathBuf,
    filename: String,
    bytes: Vec<u8>,
    reuse_identical: bool,
) -> Result<std::path::PathBuf, String> {
    blocking(state, move |_| {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder {:?}: {}", dir, e))?;
        let path = write_unique_file(&dir, &filename, &bytes, reuse_identical)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        mark_quarantined(&path);
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn list_labels(
    account_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<GmailLabel>, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, gmail.list_labels().await)
}

#[tauri::command]
pub async fn save_draft(
    account_id: String,
    draft_id: Option<String>,
    to: String,
    cc: String,
    bcc: String,
    subject: String,
    body: String,
    thread_id: Option<String>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<GmailDraft, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    let message = OutgoingMessage { to: &to, cc: &cc, bcc: &bcc, subject: &subject, body: &body, ..Default::default() };
    let result = match draft_id {
        Some(id) => gmail.update_draft(&id, &message, thread_id.as_deref()).await,
        None => gmail.create_draft(&message, thread_id.as_deref()).await,
    };
    evict_token_on_auth_error(&state, &account_id, result)
}

#[tauri::command]
pub async fn delete_draft(
    account_id: String,
    draft_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, gmail.delete_draft(&draft_id).await)
}

#[tauri::command]
pub async fn list_thread_drafts(
    account_id: String,
    thread_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<GmailDraft>, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, gmail.list_thread_drafts(&thread_id).await)
}

#[tauri::command]
pub async fn rsvp_calendar_event(
    account_id: String,
    event_uid: String,
    status: String, // "accepted", "tentative", or "declined"
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    validate_rsvp_status(&status)?;

    let user_email = get_account_email(&state, &account_id).await?;

    let access_token = get_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar.rsvp_calendar_event(&user_email, &event_uid, &status).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

/// Answers an event as listed on a calendar card, by its calendar and event
/// id, so recurring occurrences and invites from other systems resolve.
#[tauri::command]
pub async fn rsvp_listed_calendar_event(
    account_id: String,
    calendar_id: String,
    event_id: String,
    status: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<(), String> {
    validate_rsvp_status(&status)?;
    let user_email = get_account_email(&state, &account_id).await?;
    let access_token = get_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);
    let result = calendar.rsvp_event(&user_email, &calendar_id, &event_id, &status).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

fn validate_rsvp_status(status: &str) -> Result<(), String> {
    if ["accepted", "tentative", "declined"].contains(&status) {
        Ok(())
    } else {
        Err(format!("Invalid status: {}. Must be one of: accepted, tentative, declined", status))
    }
}

#[tauri::command]
pub async fn get_calendar_rsvp_status(
    account_id: String,
    event_uid: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let user_email = get_account_email(&state, &account_id).await?;

    let access_token = get_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    match calendar.get_calendar_event_status(&user_email, &event_uid).await {
        Err(e) if is_auth_error(&e) => evict_token_on_auth_error(&state, &account_id, Err(e)),
        // The status is decoration on an invite; other failures show none
        Err(e) => {
            tracing::warn!("Failed to look up RSVP status: {}", e);
            Ok(None)
        }
        status => status,
    }
}

// iCloud sync commands

/// Local account that owns a card pulled from iCloud. `mappings` records the
/// email behind each account id on the device that pushed the card.
fn icloud_card_account(
    card_account_id: &str,
    mappings: &HashMap<String, String>,
    accounts: &[Account],
) -> Option<String> {
    if card_account_id == ALL_ACCOUNTS || accounts.iter().any(|a| a.id == card_account_id) {
        return Some(card_account_id.to_string());
    }
    match mappings.get(card_account_id) {
        Some(email) => accounts
            .iter()
            .find(|a| a.email.eq_ignore_ascii_case(email))
            .map(|a| a.id.clone()),
        // Owner unknown: a lone local account adopts it
        None if accounts.len() == 1 => Some(accounts[0].id.clone()),
        None => None,
    }
}

/// Local card writes that bring this device in line with the iCloud backup
#[derive(Debug, Default)]
struct CardMerge {
    insert: Vec<Card>,
    update: Vec<Card>,
    delete: Vec<String>,
    /// Record to keep once the writes are done
    record: SyncRecord,
    /// This device has changes iCloud lacks: cards added or changed here, or
    /// deletions whose push didn't happen
    needs_push: bool,
}

/// Three-way merge of the iCloud backup into the local cards, against the
/// record (see `SyncRecord`). Only a tombstone deletes a local card; a card
/// changed on one side only takes that side's change, and one changed on both
/// takes iCloud's. Cards of accounts this device doesn't have are left alone.
fn plan_pull(
    accounts: &[Account],
    local_cards: &[Card],
    backup: Backup,
    record: &SyncRecord,
    now_ms: i64,
) -> CardMerge {
    let tombstones = merged_tombstones(&record.tombstones, &backup.tombstones, now_ms);
    let needs_push = tombstones.keys().any(|id| !backup.tombstones.contains_key(id));
    let emails = backup.emails;
    let (mut remote, foreign) = split_backup_cards(backup.cards, &emails, &tombstones, accounts);
    for card in &foreign {
        tracing::info!("Leaving card {} in iCloud - its account is not on this device", card.name);
    }

    let mut merge = CardMerge {
        record: SyncRecord { base: HashMap::new(), tombstones, seen_backup: true },
        needs_push,
        ..Default::default()
    };

    for local in local_cards {
        if merge.record.tombstones.contains_key(&local.id) {
            merge.delete.push(local.id.clone());
            continue;
        }
        let base = record.base.get(&local.id);
        let Some(remote) = take_card(&mut remote, &local.id) else {
            // Moved elsewhere to an account this device lacks; not deleted,
            // so no tombstone
            if moved_to_foreign_account(&foreign, &emails, &local.id) {
                merge.delete.push(local.id.clone());
                continue;
            }
            // Added here, or left out by another device's write before this
            // one's reached it
            merge.needs_push = true;
            if let Some(base) = base {
                merge.record.base.insert(local.id.clone(), base.clone());
            }
            continue;
        };
        let merged = merged_card(local, &remote, base, true);
        // Against iCloud's copy, the next push sees the fields kept from
        // this device as changed here
        merge.needs_push |= merged != remote;
        if merged != *local {
            merge.update.push(merged);
        }
        merge.record.base.insert(local.id.clone(), remote);
    }

    for card in remote {
        merge.record.base.insert(card.id.clone(), card.clone());
        merge.insert.push(card);
    }

    merge
}

fn apply_card_merge(db: &CacheDb, merge: &CardMerge) -> Result<(), String> {
    for id in &merge.delete {
        tracing::info!("Deleting card {} - deleted on another device", id);
    }
    db.apply_card_changes(&merge.insert, &merge.update, &merge.delete).map_err(|e| e.to_string())
}

/// Pull cards from iCloud and merge with local. Returns true if changes were made.
#[tauri::command]
pub async fn pull_from_icloud(state: State<'_, AppState>) -> Result<bool, String> {
    blocking(&state, pull_cards_from_icloud).await
}

fn pull_cards_from_icloud(state: &AppState) -> Result<bool, String> {
    // Held for the whole merge so a local card change can't push in between
    let mut icloud = state.icloud.lock().map_err(|_| "Lock error")?;
    let result = merge_cards_from_icloud(&mut icloud, state);
    if let Err(e) = &result {
        icloud.note_failure(format!("Couldn't pull cards from iCloud: {}", e));
    }
    result
}

fn merge_cards_from_icloud(icloud: &mut ICloudSync, state: &AppState) -> Result<bool, String> {
    // Merging a half-downloaded store would mark the backup as seen, which
    // lets the push after it replace the rest of the backup
    if icloud.store.as_ref().is_some_and(|s| !s.initial_sync_done()) && !icloud.load_record().seen_backup {
        return Ok(false);
    }
    let Some(backup) = icloud.load_backup()? else {
        // After a backup was seen, an empty store means iCloud is unavailable
        if icloud.store.is_some() && icloud.load_record().seen_backup {
            icloud.note_failure(BACKUP_UNAVAILABLE.into());
        }
        return Ok(false);
    };

    let merge = {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;

        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        let local_cards = db.get_board_cards().map_err(|e| e.to_string())?;

        tracing::info!(
            "pull_from_icloud: {} iCloud cards, {} tombstones, {} local accounts",
            backup.cards.len(),
            backup.tombstones.len(),
            accounts.len()
        );

        let merge = plan_pull(&accounts, &local_cards, backup, &icloud.load_record(), now_ms());
        apply_card_merge(db, &merge)?;
        merge
    };
    icloud.save_record(&merge.record);
    icloud.note_synced();
    if merge.needs_push {
        push_cards_to_icloud(icloud, state, None);
    }

    Ok(!(merge.insert.is_empty() && merge.update.is_empty() && merge.delete.is_empty()))
}

/// How card sync with iCloud last went
#[tauri::command]
pub async fn get_icloud_sync_status(state: State<'_, AppState>) -> Result<ICloudSyncStatus, String> {
    // Waits out a sync in progress, which holds the lock
    blocking(&state, |state| Ok(state.icloud.lock().map_err(|_| "Lock error")?.status())).await
}

// People API commands (contacts)

#[tauri::command]
pub async fn fetch_contacts(
    account_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<crate::people::Contact>, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let people = crate::people::PeopleClient::new(access_token);

    // Fetch up to 200 contacts
    evict_token_on_auth_error(&state, &account_id, people.fetch_all_contacts(200).await)
}

// Calendar API commands

#[tauri::command]
pub async fn list_calendars(
    account_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<crate::calendar::CalendarInfo>, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, calendar.list_calendars().await)
}

#[tauri::command]
pub async fn fetch_calendar_events(
    account_id: String,
    query: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<crate::calendar::CalendarEvent>, String> {
    let parsed_query = crate::calendar::CalendarQuery::try_parse(&query)?;
    let accounts = scope_accounts(&state, &account_id).await?;
    let searches = accounts.iter().map(|account| {
        let (state, app_handle, parsed_query) = (&state, &app_handle, &parsed_query);
        async move {
            let access_token = get_access_token(state, app_handle, &account.id).await?;
            let calendar = crate::calendar::CalendarClient::new(access_token);
            // Cap high enough that a month view on a busy account isn't silently cut off
            evict_token_on_auth_error(state, &account.id, calendar.search_events(parsed_query, 500).await)
        }
    });
    let by_account = in_scope(&account_id, &accounts, futures::future::join_all(searches).await)?;
    if account_id != ALL_ACCOUNTS {
        let events = by_account.into_iter().flatten();
        return Ok(events.map(|event| crate::models::GoogleCalendarEvent { account_id: account_id.clone(), ..event }).collect());
    }
    Ok(crate::unified::merge_calendar_events(accounts.iter().map(|a| a.id.clone()).zip(by_account).collect()))
}

#[tauri::command]
pub async fn create_calendar_event(
    account_id: String,
    calendar_id: Option<String>,
    summary: String,
    description: Option<String>,
    location: Option<String>,
    start_time: i64,
    end_time: i64,
    all_day: bool,
    attendees: Option<Vec<String>>,
    recurrence: Option<Vec<String>>,
    add_meet: Option<bool>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::GoogleCalendarEvent, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar
        .create_event(
            calendar_id.as_deref().unwrap_or("primary"),
            crate::calendar::EventFields {
                summary,
                description,
                location,
                start_time,
                end_time,
                all_day,
                attendees,
                recurrence,
                add_meet: add_meet.unwrap_or(false),
            },
        )
        .await;
    evict_token_on_auth_error(&state, &account_id, result).map(|event| crate::models::GoogleCalendarEvent { account_id: account_id.clone(), ..event })
}

#[tauri::command]
pub async fn move_calendar_event(
    account_id: String,
    source_calendar_id: String,
    event_id: String,
    destination_calendar_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::GoogleCalendarEvent, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar
        .move_event(&source_calendar_id, &event_id, &destination_calendar_id)
        .await;
    evict_token_on_auth_error(&state, &account_id, result).map(|event| crate::models::GoogleCalendarEvent { account_id: account_id.clone(), ..event })
}

#[tauri::command]
pub async fn delete_calendar_event(
    account_id: String,
    calendar_id: String,
    event_id: String,
    // "this" (the default), "following" or "all" occurrences of a repeating event
    scope: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = crate::calendar::RecurrenceScope::parse(scope.as_deref())?;
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, calendar.delete_event_in_series(&calendar_id, &event_id, scope).await)
}

#[tauri::command]
pub async fn update_calendar_event(
    account_id: String,
    calendar_id: String,
    event_id: String,
    summary: String,
    description: Option<String>,
    location: Option<String>,
    start_time: i64,
    end_time: i64,
    all_day: bool,
    attendees: Option<Vec<String>>,
    recurrence: Option<Vec<String>>,
    add_meet: Option<bool>,
    // "this" (the default), "following" or "all" occurrences of a repeating event
    scope: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::GoogleCalendarEvent, String> {
    let scope = crate::calendar::RecurrenceScope::parse(scope.as_deref())?;
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar
        .update_event_in_series(
            &calendar_id,
            &event_id,
            crate::calendar::EventFields {
                summary,
                description,
                location,
                start_time,
                end_time,
                all_day,
                attendees,
                recurrence,
                add_meet: add_meet.unwrap_or(false),
            },
            scope,
        )
        .await;
    evict_token_on_auth_error(&state, &account_id, result).map(|event| crate::models::GoogleCalendarEvent { account_id: account_id.clone(), ..event })
}

/// Prompt context for smart replies: the subject and the full bodies of the
/// last few real messages (reactions and unsent drafts left out)
fn reply_context(thread: &crate::gmail::FullThread) -> String {
    const MAX_MESSAGES: usize = 3;
    const MAX_BODY_BYTES: usize = 2000;

    fn header<'a>(msg: &'a crate::gmail::FullMessage, name: &str) -> Option<&'a str> {
        msg.payload
            .as_ref()?
            .headers
            .as_ref()?
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str())
    }

    let subject = thread
        .messages
        .first()
        .and_then(|m| header(m, "Subject"))
        .unwrap_or("(No Subject)");
    let mut context = format!("Subject: {}\n\n", subject);

    let is_draft = |m: &crate::gmail::FullMessage| {
        m.label_ids.as_ref().is_some_and(|l| l.iter().any(|x| x == "DRAFT"))
    };
    let messages: Vec<_> = thread
        .messages
        .iter()
        .filter(|m| m.reaction.is_none() && !is_draft(m))
        .collect();

    for msg in &messages[messages.len().saturating_sub(MAX_MESSAGES)..] {
        let body = crate::gmail::extract_body_text_from_message(msg)
            .unwrap_or_else(|| msg.snippet.clone().unwrap_or_default());

        // Keep the prompt within token limits; slicing mid-UTF-8 would panic
        let body = if body.len() > MAX_BODY_BYTES {
            let mut cut = MAX_BODY_BYTES;
            while !body.is_char_boundary(cut) {
                cut -= 1;
            }
            format!("{}...", &body[..cut])
        } else {
            body
        };

        context.push_str(&format!(
            "From: {}\nDate: {}\n{}\n\n---\n\n",
            header(msg, "From").unwrap_or("Unknown"),
            header(msg, "Date").unwrap_or(""),
            body
        ));
    }
    context
}

#[tauri::command]
pub async fn set_gemini_api_key(api_key: String, app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    blocking(&state, move |_| auth::store_gemini_api_key(&api_key, &app_data_dir).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn has_gemini_api_key(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    blocking(&state, move |_| auth::load_gemini_api_key(&app_data_dir).map(|key| key.is_some()).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn suggest_replies(
    account_id: String,
    thread_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    let api_key = blocking(&state, move |_| {
        auth::load_gemini_api_key(&app_data_dir)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Gemini API key is required for smart replies.".to_string())
    })
    .await?;

    let user_email = get_account_email(&state, &account_id).await?;

    let access_token = get_access_token(&state, &app_handle, &account_id).await?;

    let gmail = GmailClient::new(access_token);
    let thread = evict_token_on_auth_error(&state, &account_id, gmail.get_thread(&thread_id).await)
        .map_err(|e| format!("Failed to fetch thread: {}", e))?;

    let context = reply_context(&thread);

    let gemini = GeminiClient::new(api_key);
    gemini.suggest_replies(&context, &user_email).await
}

#[cfg(test)]
mod tests {
    use super::{
        adopt_legacy_data_dir, attachment_filename, attachment_temp_dir, cached_access_token, icloud_card_account, is_auth_error,
        is_executable_attachment, mark_quarantined, merged_tombstones, next_card_position, plan_pull, plan_push,
        refuse_executable_attachment, Backup, SyncRecord,
        reply_context, sanitize_attachment_filename, vanished_thread_ids, write_unique_file,
    };
    use crate::models::{Account, Card, Thread, ALL_ACCOUNTS};
    use std::collections::HashMap;

    #[test]
    fn data_from_the_old_bundle_identifier_is_adopted_once() {
        let root = std::env::temp_dir().join(format!("posta-adopt-{}", uuid::Uuid::new_v4()));
        let legacy = root.join("com.posta.app");
        let current = root.join("com.sryo.posta");
        std::fs::create_dir_all(legacy.join("dev")).unwrap();
        std::fs::write(legacy.join("posta.db"), "layout").unwrap();

        adopt_legacy_data_dir(&current, &legacy);
        assert_eq!(std::fs::read_to_string(current.join("posta.db")).unwrap(), "layout");
        assert!(current.join("dev").is_dir());
        assert!(!legacy.exists());

        // Data written by the old app later never overwrites the adopted copy
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("posta.db"), "stale").unwrap();
        adopt_legacy_data_dir(&current, &legacy);
        assert_eq!(std::fs::read_to_string(current.join("posta.db")).unwrap(), "layout");
        std::fs::remove_dir_all(&root).unwrap();
    }
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn account(id: &str, email: &str) -> Account {
        Account { id: id.into(), ..Account::new(email.into(), None) }
    }

    fn thread(id: &str) -> Thread {
        Thread {
            gmail_thread_id: id.into(),
            account_id: "acc".into(),
            subject: String::new(),
            snippet: String::new(),
            last_message_date: chrono::Utc::now(),
            unread_count: 0,
            labels: Vec::new(),
            participants: Vec::new(),
            has_attachment: false,
            attachments: Vec::new(),
            calendar_event: None,
        }
    }

    /// Gmail history with `modified` changed threads and `candidates` threads
    /// that lost messages, of which `gone` no longer exist
    #[derive(Default)]
    struct FakeMail {
        modified: Vec<String>,
        candidates: Vec<String>,
        gone: Vec<String>,
        expired: bool,
        calls: std::sync::Mutex<Vec<String>>,
    }

    impl FakeMail {
        fn with_changes(modified: usize, candidates: usize) -> Self {
            FakeMail {
                modified: (0..modified).map(|i| format!("m{}", i)).collect(),
                candidates: (0..candidates).map(|i| format!("d{}", i)).collect(),
                ..Default::default()
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl super::MailHistory for FakeMail {
        async fn history_changes(&self, since: &str) -> Result<crate::gmail::HistoryChanges, String> {
            self.calls.lock().unwrap().push(format!("history {}", since));
            if self.expired {
                return Err(crate::gmail::HISTORY_EXPIRED.to_string());
            }
            Ok(crate::gmail::HistoryChanges {
                modified_thread_ids: self.modified.clone(),
                deleted_thread_ids: self.candidates.clone(),
                deleted_message_ids: Vec::new(),
                new_history_id: "200".into(),
            })
        }

        async fn split_deleted_threads(&self, ids: &[String]) -> Result<(Vec<String>, Vec<String>), String> {
            self.calls.lock().unwrap().push(format!("split {}", ids.len()));
            Ok(ids.iter().cloned().partition(|id| !self.gone.contains(id)))
        }

        async fn thread_details(&self, ids: &[String]) -> Result<Vec<Thread>, String> {
            self.calls.lock().unwrap().push(format!("details {}", ids.len()));
            Ok(ids.iter().filter(|id| !self.gone.contains(id)).map(|id| thread(id)).collect())
        }

        async fn current_history_id(&self) -> Result<String, String> {
            self.calls.lock().unwrap().push("profile".into());
            Ok("300".into())
        }
    }

    #[tokio::test]
    async fn a_large_history_backlog_refetches_cards_instead_of_every_thread() {
        let gmail = FakeMail::with_changes(90, 20);
        let result = super::sync_mail_history(&gmail, Some("100")).await.unwrap();
        assert!(result.is_full_sync);
        assert!(result.modified_threads.is_empty() && result.deleted_thread_ids.is_empty());
        assert_eq!(result.new_history_id, "200", "the backlog is not fetched again");
        assert_eq!(gmail.calls(), vec!["history 100"]);
    }

    #[tokio::test]
    async fn a_small_history_backlog_fetches_the_changed_threads() {
        let gmail = FakeMail { gone: vec!["d1".into()], ..FakeMail::with_changes(2, 2) };
        let result = super::sync_mail_history(&gmail, Some("100")).await.unwrap();
        assert!(!result.is_full_sync);
        let mut fetched: Vec<&str> = result.modified_threads.iter().map(|t| t.gmail_thread_id.as_str()).collect();
        fetched.sort();
        assert_eq!(fetched, vec!["d0", "m0", "m1"]);
        assert_eq!(result.deleted_thread_ids, vec!["d1".to_string()]);
        assert_eq!(result.new_history_id, "200");
        assert_eq!(gmail.calls(), vec!["history 100", "split 2", "details 3"]);
    }

    #[tokio::test]
    async fn a_missing_or_expired_history_id_starts_a_full_sync() {
        let gmail = FakeMail::default();
        let result = super::sync_mail_history(&gmail, None).await.unwrap();
        assert!(result.is_full_sync);
        assert_eq!(result.new_history_id, "300");

        let gmail = FakeMail { expired: true, ..Default::default() };
        let result = super::sync_mail_history(&gmail, Some("1")).await.unwrap();
        assert!(result.is_full_sync);
        assert_eq!(result.new_history_id, "300");
        assert_eq!(gmail.calls(), vec!["history 1", "profile"]);
    }

    #[tokio::test]
    async fn bulk_thread_requests_stay_under_gmails_concurrency_limit() {
        use std::sync::atomic::AtomicUsize;
        let in_flight = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let ids: Vec<String> = (0..60).map(|i| format!("t{}", i)).collect();

        let results = super::for_each_thread(ids, |id: String| {
            let (in_flight, peak) = (&in_flight, &peak);
            async move {
                let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
                if id == "t7" { Err("429".into()) } else { Ok(()) }
            }
        })
        .await;

        assert_eq!(results.len(), 60, "a failure does not stop the others");
        let failed: Vec<&str> = results.iter().filter(|(_, r)| r.is_err()).map(|(id, _)| id.as_str()).collect();
        assert_eq!(failed, vec!["t7"]);
        let peak = peak.load(Ordering::SeqCst);
        assert!(peak > 1 && peak <= super::MAX_CONCURRENT_THREAD_REQUESTS, "peak {}", peak);
    }

    #[test]
    fn a_bulk_action_evicts_the_token_on_any_auth_error_and_counts_failures() {
        use std::time::{Duration, Instant};
        let state = super::AppState::new();
        let token = || ("t".to_string(), Instant::now() + Duration::from_secs(600));
        state.token_cache.lock().unwrap().insert("a1".into(), token());
        let results = vec![
            ("t1".to_string(), Err("API error 429 Too Many Requests: {}".to_string())),
            ("t2".to_string(), Ok(())),
            ("t3".to_string(), Err("API error 401 Unauthorized: {}".to_string())),
        ];
        let err = super::settle_thread_results(&state, "a1", results).unwrap_err();
        assert_eq!(err, "Failed to modify 2 of 3 threads: API error 401 Unauthorized: {}");
        assert!(state.token_cache.lock().unwrap().is_empty(), "the 401 was not the first to fail");

        state.token_cache.lock().unwrap().insert("a1".into(), token());
        let one = vec![("t1".to_string(), Err("API error 500 Internal Server Error: {}".to_string()))];
        let err = super::settle_thread_results(&state, "a1", one).unwrap_err();
        assert_eq!(err, "Failed to modify thread t1: API error 500 Internal Server Error: {}");
        assert!(!state.token_cache.lock().unwrap().is_empty());
        assert_eq!(super::settle_thread_results(&state, "a1", vec![("t1".to_string(), Ok(()))]), Ok(()));
    }

    #[test]
    fn threads_missing_from_the_fetch_are_reported_as_deleted() {
        let requested = vec!["a".to_string(), "b".to_string(), "c".to_string(), "b".to_string()];
        let fetched = vec![thread("a"), thread("c")];
        assert_eq!(vanished_thread_ids(&requested, &fetched), vec!["b".to_string()]);
        assert!(vanished_thread_ids(&requested[..1], &fetched).is_empty());
    }

    fn mappings(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn owned_card(id: &str, account_id: &str) -> Card {
        Card { id: id.into(), ..Card::new(account_id.into(), id.into(), "q".into(), 0) }
    }

    fn renamed(card: &Card, name: &str) -> Card {
        Card { name: name.into(), ..card.clone() }
    }

    fn ids(cards: &[Card]) -> Vec<&str> {
        cards.iter().map(|c| c.id.as_str()).collect()
    }

    const NOW: i64 = 1_800_000_000_000;

    fn backup(cards: Vec<Card>, emails: &[(&str, &str)], tombstones: &[&str]) -> Backup {
        Backup {
            cards,
            emails: mappings(emails),
            tombstones: tombstones.iter().map(|id| (id.to_string(), NOW - 1000)).collect(),
        }
    }

    /// Record of a device that last synced exactly these cards
    fn synced(cards: &[Card]) -> SyncRecord {
        SyncRecord {
            base: cards.iter().map(|c| (c.id.clone(), c.clone())).collect(),
            tombstones: HashMap::new(),
            seen_backup: true,
        }
    }

    fn tombstoned(mut record: SyncRecord, ids: &[&str]) -> SyncRecord {
        for id in ids {
            record.base.remove(*id);
            record.tombstones.insert(id.to_string(), NOW - 1000);
        }
        record
    }

    #[test]
    fn tombstones_round_trip_through_the_mapping_map_next_to_emails() {
        let b = backup(vec![owned_card("c", "a1")], &[("a1", "me@x.com")], &["gone"]);
        let read = Backup::from_store(Some(b.cards.clone()), Some(b.mappings())).unwrap();
        assert_eq!(read, b);
        assert_eq!(Backup::from_store(None, None), None);
        assert_eq!(Backup::from_store(Some(Vec::new()), None), Some(Backup::default()));
    }

    #[test]
    fn a_sync_record_in_the_old_format_reads_as_empty() {
        let old = br#"{"c1": "a1", "c2": "a1"}"#;
        let record: SyncRecord = serde_json::from_slice(old).unwrap();
        assert_eq!(record, SyncRecord::default());
    }

    #[test]
    fn old_tombstones_are_forgotten() {
        let a = HashMap::from([("old".to_string(), NOW - super::TOMBSTONE_TTL_MS - 1), ("new".to_string(), NOW - 5)]);
        let b = HashMap::from([("new".to_string(), NOW - 1), ("other".to_string(), NOW)]);
        let merged = merged_tombstones(&a, &b, NOW);
        assert_eq!(merged, HashMap::from([("new".to_string(), NOW - 1), ("other".to_string(), NOW)]));
    }

    #[test]
    fn push_never_overwrites_a_backup_it_cannot_read() {
        let mut seen = synced(&[]);
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut seen, true).ok(), None, "iCloud unavailable after a backup was seen");
        assert_eq!(super::backup_to_push_onto(Err("bad json".into()), &mut seen, true).ok(), None);
        assert_eq!(super::backup_to_push_onto(Err("bad json".into()), &mut SyncRecord::default(), true).ok(), None);

        let b = backup(vec![owned_card("c", "a1")], &[], &[]);
        let mut fresh = SyncRecord::default();
        assert_eq!(super::backup_to_push_onto(Ok(Some(b.clone())), &mut fresh, true), Ok(b));
        assert!(fresh.seen_backup);
    }

    #[test]
    fn the_first_push_starts_the_backup_and_later_empty_reads_are_not_trusted() {
        let mut record = SyncRecord::default();
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut record, true), Ok(Backup::default()));
        assert!(record.seen_backup);
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut record, true).ok(), None);
    }

    #[test]
    fn a_fresh_device_does_not_push_before_icloud_has_downloaded() {
        // An empty or half-downloaded store on a new Mac is not the backup;
        // writing over it would replace the only copy of the layout
        let mut fresh = SyncRecord::default();
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut fresh, false).ok(), None);
        let partial = backup(Vec::new(), &[("a1", "me@x.com")], &[]);
        assert_eq!(super::backup_to_push_onto(Ok(Some(partial)), &mut fresh, false).ok(), None);
        assert!(!fresh.seen_backup);

        // A device that has synced before keeps pushing onto what it reads
        let b = backup(vec![owned_card("c", "a1")], &[], &[]);
        assert_eq!(super::backup_to_push_onto(Ok(Some(b.clone())), &mut synced(&[]), false), Ok(b));
    }

    #[test]
    fn a_card_change_on_a_fresh_device_waits_for_the_icloud_download() {
        let dir = scratch_dir();
        let (state, store) = synced_state(&dir, &[]);
        {
            let icloud = state.icloud.lock().unwrap();
            icloud.save_record(&SyncRecord::default());
        }
        *store.0.lock().unwrap() = FakeBackup { downloading: true, ..Default::default() };

        super::change_cards(&state, None, |db| db.insert_card(&owned_card("new", "a1")).map_err(|e| e.to_string())).unwrap();
        assert_eq!(store.0.lock().unwrap().cards, None, "nothing written over the undownloaded backup");
        assert!(!state.icloud.lock().unwrap().load_record().seen_backup);

        // Once the download is in, the backup is merged rather than replaced
        *store.0.lock().unwrap() = FakeBackup {
            cards: Some(vec![owned_card("old", "a1")]),
            mappings: Some(mappings(&[("a1", "me@x.com")])),
            ..Default::default()
        };
        super::change_cards(&state, None, |_| Ok(())).unwrap();
        assert_eq!(sorted_ids(&store.backup().cards), vec!["new", "old"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pull_on_a_fresh_device_waits_for_the_icloud_download() {
        // Only the mappings key has arrived; merging it would mark the backup
        // as seen and push this Mac's cards over the ones still downloading
        let dir = scratch_dir();
        let (state, store) = synced_state(&dir, &[owned_card("here", "a1")]);
        state.icloud.lock().unwrap().save_record(&SyncRecord::default());
        *store.0.lock().unwrap() =
            FakeBackup { mappings: Some(mappings(&[("a1", "me@x.com")])), downloading: true, ..Default::default() };

        assert_eq!(super::pull_cards_from_icloud(&state), Ok(false));
        assert_eq!(store.0.lock().unwrap().cards, None, "nothing written over the undownloaded backup");
        assert!(!state.icloud.lock().unwrap().load_record().seen_backup);

        *store.0.lock().unwrap() = FakeBackup {
            cards: Some(vec![owned_card("old", "a1")]),
            mappings: Some(mappings(&[("a1", "me@x.com")])),
            ..Default::default()
        };
        super::pull_cards_from_icloud(&state).unwrap();
        assert_eq!(sorted_ids(&store.backup().cards), vec!["here", "old"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn push_is_skipped_without_local_accounts() {
        let b = backup(vec![owned_card("c1", "gone")], &[("gone", "me@x.com")], &[]);
        assert!(plan_push(&[], Vec::new(), b, &SyncRecord::default(), NOW).is_none());
    }

    #[test]
    fn push_keeps_cards_of_accounts_this_device_lacks() {
        let accounts = [account("a1", "me@x.com")];
        let mine = owned_card("mine", "a1");
        let b = backup(
            vec![mine.clone(), owned_card("work", "w9")],
            &[("a1", "me@x.com"), ("w9", "work@x.com")],
            &[],
        );
        let (pushed, _) = plan_push(&accounts, vec![mine.clone()], b, &synced(&[mine]), NOW).unwrap();
        assert_eq!(ids(&pushed.cards), vec!["mine", "work"]);
        assert_eq!(pushed.emails, mappings(&[("a1", "me@x.com"), ("w9", "work@x.com")]));
    }

    #[test]
    fn push_keeps_cards_added_elsewhere_that_were_not_pulled_yet() {
        let accounts = [account("a1", "me@x.com")];
        let mine = owned_card("mine", "a1");
        let b = backup(vec![mine.clone(), owned_card("theirs", "a1")], &[], &[]);
        let (pushed, record) = plan_push(&accounts, vec![mine.clone()], b, &synced(&[mine]), NOW).unwrap();
        assert_eq!(ids(&pushed.cards), vec!["mine", "theirs"]);
        // Not in the base: the next pull adds it here
        assert!(!record.base.contains_key("theirs"));
    }

    #[test]
    fn push_carries_a_deletion_made_here_and_does_not_bring_the_card_back() {
        let accounts = [account("a1", "me@x.com")];
        let keep = owned_card("keep", "a1");
        let gone = owned_card("gone", "a1");
        let b = backup(vec![keep.clone(), gone.clone()], &[], &[]);
        let record = tombstoned(synced(&[keep.clone(), gone]), &["gone"]);
        let (pushed, new_record) = plan_push(&accounts, vec![keep], b, &record, NOW).unwrap();
        assert_eq!(ids(&pushed.cards), vec!["keep"]);
        assert!(pushed.tombstones.contains_key("gone"));
        assert!(new_record.tombstones.contains_key("gone"));
    }

    #[test]
    fn push_does_not_resurrect_a_card_another_device_deleted() {
        // This device still has "x" because it has not pulled since the
        // other device deleted it
        let accounts = [account("a1", "me@x.com")];
        let keep = owned_card("keep", "a1");
        let x = owned_card("x", "a1");
        let b = backup(vec![keep.clone()], &[], &["x"]);
        let (pushed, record) =
            plan_push(&accounts, vec![keep.clone(), x.clone()], b, &synced(&[keep, x]), NOW).unwrap();
        assert_eq!(ids(&pushed.cards), vec!["keep"]);
        assert!(pushed.tombstones.contains_key("x"));
        assert!(record.tombstones.contains_key("x"));
    }

    #[test]
    fn push_does_not_revert_a_rename_made_on_another_device() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let theirs = renamed(&card, "Renamed there");
        let b = backup(vec![theirs.clone()], &[], &[]);
        let (pushed, record) = plan_push(&accounts, vec![card.clone()], b, &synced(std::slice::from_ref(&card)), NOW).unwrap();
        assert_eq!(pushed.cards, vec![theirs]);
        // The base still matches the local copy, so the next pull applies the rename here
        assert_eq!(record.base["c"], card);
    }

    #[test]
    fn push_publishes_a_change_made_here() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let mine = renamed(&card, "Renamed here");
        let b = backup(vec![card.clone()], &[], &[]);
        let (pushed, record) = plan_push(&accounts, vec![mine.clone()], b, &synced(&[card]), NOW).unwrap();
        assert_eq!(pushed.cards, vec![mine.clone()]);
        assert_eq!(record.base["c"], mine);
    }

    #[test]
    fn push_restores_a_synced_card_that_a_stale_write_left_out() {
        let accounts = [account("a1", "me@x.com")];
        let keep = owned_card("keep", "a1");
        let x = owned_card("x", "a1");
        let b = backup(vec![keep.clone()], &[], &[]);
        let (pushed, _) = plan_push(&accounts, vec![keep.clone(), x.clone()], b, &synced(&[keep, x]), NOW).unwrap();
        assert_eq!(ids(&pushed.cards), vec!["keep", "x"]);
    }

    #[test]
    fn push_drops_mappings_no_card_uses() {
        let accounts = [account("a1", "me@x.com"), account("a2", "other@x.com")];
        let local = vec![owned_card("mine", "a1")];
        let b = backup(Vec::new(), &[("stale", "old@x.com"), ("a1-old", "me@x.com")], &[]);
        let (pushed, _) = plan_push(&accounts, local, b, &SyncRecord::default(), NOW).unwrap();
        assert_eq!(pushed.emails, mappings(&[("a1", "me@x.com")]));
    }

    #[test]
    fn pull_deletes_local_cards_only_on_a_tombstone() {
        let accounts = [account("a1", "me@x.com")];
        let keep = owned_card("keep", "a1");
        let gone = owned_card("gone", "a1");
        let local = vec![keep.clone(), gone.clone()];
        let b = backup(vec![keep.clone()], &[], &["gone"]);
        let merge = plan_pull(&accounts, &local, b, &synced(&[keep.clone(), gone]), NOW);
        assert_eq!(merge.delete, vec!["gone".to_string()]);
        assert!(merge.insert.is_empty() && merge.update.is_empty());
        assert_eq!(merge.record.base, synced(&[keep]).base);
        assert!(merge.record.tombstones.contains_key("gone"));
    }

    #[test]
    fn pull_keeps_a_synced_card_that_a_stale_icloud_write_left_out() {
        // Another device pushed before this device's "x" reached it; nothing
        // was deleted, so "x" must survive here and go back up
        let accounts = [account("a1", "me@x.com")];
        let keep = owned_card("keep", "a1");
        let x = owned_card("x", "a1");
        let b = backup(vec![keep.clone()], &[], &[]);
        let merge = plan_pull(&accounts, &[keep.clone(), x.clone()], b, &synced(&[keep, x]), NOW);
        assert!(merge.delete.is_empty(), "{:?}", merge.delete);
        assert!(merge.needs_push);
    }

    #[test]
    fn pull_keeps_every_card_when_icloud_is_empty() {
        let accounts = [account("a1", "me@x.com")];
        let local = vec![owned_card("a", "a1"), owned_card("b", "a1")];
        let merge = plan_pull(&accounts, &local, Backup::default(), &synced(&local), NOW);
        assert!(merge.delete.is_empty() && merge.update.is_empty() && merge.insert.is_empty());
        assert!(merge.needs_push);
    }

    #[test]
    fn pull_does_not_resurrect_a_card_deleted_here() {
        // The deletion was recorded here but has not reached iCloud yet
        let accounts = [account("a1", "me@x.com")];
        let b = backup(vec![owned_card("deleted-here", "a1"), owned_card("added-there", "a1")], &[], &[]);
        let record = tombstoned(SyncRecord::default(), &["deleted-here"]);
        let merge = plan_pull(&accounts, &[], b, &record, NOW);
        assert_eq!(ids(&merge.insert), vec!["added-there"]);
        assert!(merge.delete.is_empty());
        assert!(merge.needs_push, "the deletion still has to reach iCloud");
    }

    #[test]
    fn pull_restores_cards_of_a_signed_out_account_on_sign_in() {
        // c1 was synced under a1-old; the account was then removed and signed
        // in again under a new id, and its layout must come back
        let accounts = [account("a1-new", "me@x.com")];
        let b = backup(vec![owned_card("c1", "a1-old")], &[("a1-old", "me@x.com")], &[]);
        let merge = plan_pull(&accounts, &[], b, &synced(&[owned_card("c1", "a1-old")]), NOW);
        assert_eq!(ids(&merge.insert), vec!["c1"]);
        assert_eq!(merge.insert[0].account_id, "a1-new");
        assert_eq!(merge.record.base["c1"].account_id, "a1-new");
    }

    #[test]
    fn pull_takes_changes_made_elsewhere_and_keeps_those_made_here() {
        let accounts = [account("a1", "me@x.com")];
        let same = owned_card("same", "a1");
        let there = owned_card("there", "a1");
        let here = owned_card("here", "a1");
        let record = synced(&[same.clone(), there.clone(), here.clone()]);
        let local = vec![same.clone(), there.clone(), renamed(&here, "Mine")];
        let b = backup(vec![same.clone(), renamed(&there, "Theirs"), here.clone()], &[], &[]);
        let merge = plan_pull(&accounts, &local, b, &record, NOW);
        assert_eq!(merge.update, vec![renamed(&there, "Theirs")]);
        assert!(merge.insert.is_empty() && merge.delete.is_empty());
        assert!(merge.needs_push);
        // "here" keeps its old base, so the next push still sees it as changed here
        assert_eq!(merge.record.base["here"], here);
        assert_eq!(merge.record.base["there"], renamed(&there, "Theirs"));
    }

    #[test]
    fn pull_lets_icloud_win_when_both_sides_changed_a_card() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let b = backup(vec![renamed(&card, "Theirs")], &[], &[]);
        let merge = plan_pull(&accounts, &[renamed(&card, "Mine")], b, &synced(std::slice::from_ref(&card)), NOW);
        assert_eq!(merge.update, vec![renamed(&card, "Theirs")]);
        // A fresh device has no base, and adopts the backup's copies
        let b = backup(vec![renamed(&card, "Theirs")], &[], &[]);
        let merge = plan_pull(&accounts, std::slice::from_ref(&card), b, &SyncRecord::default(), NOW);
        assert_eq!(merge.update, vec![renamed(&card, "Theirs")]);
        assert!(!merge.needs_push);
    }

    fn moved(card: &Card, position: i32) -> Card {
        Card { position, ..card.clone() }
    }

    #[test]
    fn pull_keeps_a_rename_made_here_when_another_device_reordered() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let b = backup(vec![moved(&card, 5)], &[], &[]);
        let merge = plan_pull(&accounts, &[renamed(&card, "Mine")], b, &synced(std::slice::from_ref(&card)), NOW);
        let both = moved(&renamed(&card, "Mine"), 5);
        assert_eq!(merge.update, vec![both]);
        assert!(merge.needs_push, "the rename still has to reach iCloud");
        // Against iCloud's copy, the next push sees the rename as made here
        assert_eq!(merge.record.base["c"], moved(&card, 5));
    }

    #[test]
    fn push_keeps_a_reorder_made_elsewhere_when_this_device_renamed() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let mine = Card { collapsed: true, ..renamed(&card, "Mine") };
        let b = backup(vec![moved(&card, 5)], &[], &[]);
        let (pushed, record) = plan_push(&accounts, vec![mine.clone()], b, &synced(std::slice::from_ref(&card)), NOW).unwrap();
        assert_eq!(pushed.cards, vec![moved(&mine, 5)]);
        // The next pull still sees the reorder as made elsewhere and applies it here
        assert_eq!(record.base["c"], mine);
    }

    #[test]
    fn a_field_changed_on_both_sides_goes_to_the_side_that_merges() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let mine = moved(&renamed(&card, "Mine"), 1);
        let theirs = renamed(&card, "Theirs");
        let merge = plan_pull(&accounts, std::slice::from_ref(&mine), backup(vec![theirs.clone()], &[], &[]), &synced(std::slice::from_ref(&card)), NOW);
        assert_eq!(merge.update, vec![moved(&theirs, 1)]);
        let (pushed, _) =
            plan_push(&accounts, vec![mine.clone()], backup(vec![theirs], &[], &[]), &synced(&[card]), NOW).unwrap();
        assert_eq!(pushed.cards, vec![mine]);
    }

    #[test]
    fn a_card_id_the_backup_holds_twice_is_pulled_once() {
        // Inserting it twice would fail the whole pull, on every focus
        let accounts = [account("a1", "me@x.com"), account("a2", "b@x.com")];
        let first = owned_card("x", "a1");
        let b = backup(
            vec![first.clone(), renamed(&first, "Again"), owned_card("x", "w9")],
            &[("a1", "me@x.com"), ("w9", "work@x.com")],
            &[],
        );
        let merge = plan_pull(&accounts, &[], b, &SyncRecord::default(), NOW);
        assert_eq!(merge.insert, vec![first]);
    }

    #[test]
    fn push_writes_each_card_id_once() {
        // "x" is a local card whose backup copy lost its owner mapping, plus
        // a duplicate of "y" from an earlier torn write
        let accounts = [account("a1", "me@x.com"), account("a2", "b@x.com")];
        let x = owned_card("x", "a1");
        let y = owned_card("y", "a1");
        let b = backup(
            vec![owned_card("x", "lost"), y.clone(), renamed(&y, "Again"), owned_card("w", "w9"), owned_card("w", "w9")],
            &[("a1", "me@x.com"), ("w9", "work@x.com")],
            &[],
        );
        let (pushed, _) = plan_push(&accounts, vec![x.clone()], b, &synced(&[x]), NOW).unwrap();
        assert_eq!(sorted_ids(&pushed.cards), vec!["w", "x", "y"]);
        assert_eq!(pushed.cards.iter().find(|c| c.id == "y"), Some(&y));
    }

    #[test]
    fn pull_leaves_cards_of_accounts_this_device_lacks_alone() {
        let accounts = [account("a1", "me@x.com"), account("a2", "b@x.com")];
        let b = backup(vec![owned_card("work", "w9")], &[("w9", "work@x.com")], &[]);
        let merge = plan_pull(&accounts, &[], b, &SyncRecord::default(), NOW);
        assert!(merge.insert.is_empty() && merge.update.is_empty() && merge.delete.is_empty());
        assert!(merge.record.base.is_empty());
        assert!(merge.record.seen_backup);
    }

    #[test]
    fn pull_takes_away_a_card_another_device_moved_to_an_account_this_one_lacks() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let b = backup(vec![owned_card("c", "w9")], &[("w9", "work@x.com")], &[]);
        let merge = plan_pull(&accounts, std::slice::from_ref(&card), b, &synced(std::slice::from_ref(&card)), NOW);
        assert_eq!(merge.delete, ["c"]);
        assert!(!merge.needs_push);
        assert!(!merge.record.base.contains_key("c"));
        assert!(!merge.record.tombstones.contains_key("c"), "the card lives on in its new account");

        // An owner with no mapping may be a torn read of this device's own
        // card: kept
        let b = backup(vec![owned_card("c", "w9")], &[], &[]);
        let accounts = [account("a1", "me@x.com"), account("a2", "b@x.com")];
        let merge = plan_pull(&accounts, std::slice::from_ref(&card), b, &synced(std::slice::from_ref(&card)), NOW);
        assert!(merge.delete.is_empty());
    }

    #[test]
    fn push_keeps_a_move_to_an_account_this_device_lacks() {
        let accounts = [account("a1", "me@x.com")];
        let card = owned_card("c", "a1");
        let theirs = owned_card("c", "w9");
        let b = backup(vec![theirs.clone()], &[("w9", "work@x.com")], &[]);
        let (pushed, record) = plan_push(&accounts, vec![card.clone()], b, &synced(std::slice::from_ref(&card)), NOW).unwrap();
        assert_eq!(pushed.cards, [theirs]);
        assert_eq!(pushed.emails, mappings(&[("w9", "work@x.com")]));
        // Kept so the next pull takes the card away here
        assert_eq!(record.base["c"], card);

        // Moved here too since the last sync: this device's move goes out
        let mine = Card { account_id: ALL_ACCOUNTS.into(), ..card.clone() };
        let b = backup(vec![owned_card("c", "w9")], &[("w9", "work@x.com")], &[]);
        let (pushed, _) = plan_push(&accounts, vec![mine.clone()], b, &synced(std::slice::from_ref(&card)), NOW).unwrap();
        assert_eq!(pushed.cards, [mine]);
    }

    #[test]
    fn a_card_moved_to_an_account_this_device_lacks_stays_moved_across_pull_and_push() {
        let dir = scratch_dir();
        let card = owned_card("c", "a1");
        let (state, store) = synced_state(&dir, std::slice::from_ref(&card));
        {
            // Moved on a Mac signed in to work@x.com too
            let mut backup = store.0.lock().unwrap();
            backup.cards = Some(vec![owned_card("c", "w9")]);
            backup.mappings.as_mut().unwrap().insert("w9".into(), "work@x.com".into());
        }

        assert!(super::pull_cards_from_icloud(&state).unwrap());
        assert!(board_ids(&state).is_empty());
        super::change_cards(&state, None, |db| db.reorder_cards(&[]).map_err(|e| e.to_string())).unwrap();
        assert_eq!(store.backup().cards, [owned_card("c", "w9")]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_push_after_a_pull_round_trips_without_changes() {
        let accounts = [account("a1", "me@x.com")];
        let local = vec![owned_card("a", "a1"), owned_card("b", "a1")];
        let b = backup(local.clone(), &[("a1", "me@x.com")], &["old"]);
        let merge = plan_pull(&accounts, &local, b.clone(), &SyncRecord::default(), NOW);
        assert!(!merge.needs_push);
        let (pushed, record) = plan_push(&accounts, local, b.clone(), &merge.record, NOW).unwrap();
        assert_eq!(pushed, b);
        assert_eq!(record, merge.record);
    }

    #[test]
    fn icloud_card_keeps_a_local_account_id() {
        let accounts = [account("a1", "me@x.com"), account("a2", "work@x.com")];
        assert_eq!(icloud_card_account("a2", &mappings(&[]), &accounts), Some("a2".into()));
    }

    #[test]
    fn icloud_card_is_remapped_by_email_case_insensitively() {
        let accounts = [account("a1", "me@x.com"), account("a2", "work@x.com")];
        let m = mappings(&[("old", "Work@X.com")]);
        assert_eq!(icloud_card_account("old", &m, &accounts), Some("a2".into()));
    }

    #[test]
    fn single_account_adopts_only_cards_with_unknown_owner() {
        let accounts = [account("a1", "me@x.com")];
        assert_eq!(icloud_card_account("old", &mappings(&[]), &accounts), Some("a1".into()));
        // The card belongs to an account this device doesn't have; adopting it
        // would run another mailbox's query against this one
        let m = mappings(&[("other", "work@x.com")]);
        assert_eq!(icloud_card_account("other", &m, &accounts), None);
    }

    #[test]
    fn icloud_card_without_match_is_skipped_with_several_accounts() {
        let accounts = [account("a1", "me@x.com"), account("a2", "work@x.com")];
        assert_eq!(icloud_card_account("old", &mappings(&[]), &accounts), None);
    }

    #[test]
    fn auth_errors_are_recognised_across_apis() {
        assert!(is_auth_error("Search failed: API error 401 Unauthorized: {}"));
        assert!(is_auth_error("People API error (401 Unauthorized): {}"));
        assert!(is_auth_error("Calendar access expired. Please re-login."));
        assert!(is_auth_error(
            r#"Failed to update RSVP: {"error": {"code": 401, "status": "UNAUTHENTICATED"}}"#
        ));
    }

    #[test]
    fn ids_containing_401_are_not_auth_errors() {
        assert!(!is_auth_error(
            "Failed to modify thread 18c4015fe2: API error 500 Internal Server Error: {}"
        ));
        assert!(!is_auth_error("Calendar not found."));
    }

    #[test]
    fn attachment_filename_adds_extension_from_mime() {
        assert_eq!(attachment_filename("scan", Some("application/pdf")), "scan.pdf");
        assert_eq!(attachment_filename("scan.PDF", Some("application/pdf")), "scan.PDF");
        assert_eq!(attachment_filename("notes", Some("application/x-unknown")), "notes");
        assert_eq!(attachment_filename("notes", None), "notes");
    }

    #[test]
    fn attachment_filename_never_yields_hidden_extension_only_name() {
        assert_eq!(attachment_filename("", Some("application/pdf")), "attachment.pdf");
        assert_eq!(attachment_filename("/", Some("image/png")), "attachment.png");
    }

    #[test]
    fn attachment_filename_checks_extension_on_the_final_component() {
        assert_eq!(attachment_filename("v1.2/invoice", Some("application/pdf")), "invoice.pdf");
        assert_eq!(attachment_filename("../../evil.sh", Some("application/pdf")), "evil.sh");
    }

    fn scratch_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("posta-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn refused_attachments_carry_the_error_prefix_the_frontend_matches() {
        let err = refuse_executable_attachment("setup.pkg", None).unwrap_err();
        assert!(err.starts_with("EXECUTABLE_ATTACHMENT: "), "{}", err);
        assert!(refuse_executable_attachment("report.pdf", Some("application/pdf")).is_ok());
    }

    #[test]
    fn executable_attachments_are_recognised_whatever_the_case() {
        for name in ["run.command", "Setup.PKG", "x.terminal", "script.sh", "App.app", "evil.command. "] {
            assert!(is_executable_attachment(name), "{}", name);
        }
        for name in ["report.pdf", "photo.jpeg", "notes", "command", "archive.zip", "sh.txt"] {
            assert!(!is_executable_attachment(name), "{}", name);
        }
    }

    #[test]
    fn same_named_attachments_from_different_messages_get_different_dirs() {
        let base = std::path::Path::new("/tmp/base");
        let a = attachment_temp_dir(base, "18c4a");
        let b = attachment_temp_dir(base, "18c4b");
        assert_ne!(a, b);
        assert!(a.starts_with(base));
    }

    #[test]
    fn attachment_temp_dir_ignores_path_characters_in_the_message_id() {
        let base = std::path::Path::new("/tmp/base");
        let dir = attachment_temp_dir(base, "../../etc");
        assert_eq!(dir, base.join("posta-attachments").join("etc"));
        assert_eq!(attachment_temp_dir(base, "/.."), base.join("posta-attachments").join("message"));
    }

    #[test]
    fn write_unique_file_never_overwrites() {
        let dir = scratch_dir();
        let first = write_unique_file(&dir, "a.txt", b"one", false).unwrap();
        let second = write_unique_file(&dir, "a.txt", b"two", false).unwrap();
        let third = write_unique_file(&dir, "a.txt", b"one", false).unwrap();
        let bare = write_unique_file(&dir, "README", b"x", false).unwrap();
        let bare2 = write_unique_file(&dir, "README", b"y", false).unwrap();
        assert_eq!(first, dir.join("a.txt"));
        assert_eq!(second, dir.join("a (1).txt"));
        assert_eq!(third, dir.join("a (2).txt"));
        assert_eq!(bare2, dir.join("README (1)"));
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        assert_eq!(std::fs::read(&bare).unwrap(), b"x");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_unique_file_reuses_an_identical_copy_when_asked() {
        let dir = scratch_dir();
        let first = write_unique_file(&dir, "a.txt", b"one", true).unwrap();
        assert_eq!(write_unique_file(&dir, "a.txt", b"one", true).unwrap(), first);
        let other = write_unique_file(&dir, "a.txt", b"two", true).unwrap();
        assert_eq!(other, dir.join("a (1).txt"));
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn written_attachments_carry_the_quarantine_attribute() {
        let dir = scratch_dir();
        let path = write_unique_file(&dir, "x.pdf", b"%PDF", false).unwrap();
        mark_quarantined(&path);
        let out = std::process::Command::new("/usr/bin/xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success());
        let value = String::from_utf8_lossy(&out.stdout);
        assert!(value.starts_with("0083;") && value.trim_end().ends_with(";Posta;"), "{}", value);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn attachments_are_written_into_a_new_folder_without_replacing_a_file() {
        let base = scratch_dir();
        let dir = base.join("posta-attachments").join("m1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.pdf"), b"other").unwrap();
        let state = super::AppState::new();

        let path = super::write_attachment(&state, dir.clone(), "a.pdf".into(), b"%PDF".to_vec(), true).await.unwrap();
        assert_eq!(path, dir.join("a (1).pdf"));
        assert_eq!(std::fs::read(dir.join("a.pdf")).unwrap(), b"other");

        let fresh = base.join("new");
        let path = super::write_attachment(&state, fresh.clone(), "b.txt".into(), b"x".to_vec(), false).await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"x");
        std::fs::remove_dir_all(base).unwrap();
    }

    fn message(id: &str, from: &str, text: &str, labels: &[&str], reaction: bool) -> serde_json::Value {
        use base64::Engine;
        let data = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(text);
        serde_json::json!({
            "id": id,
            "threadId": "t",
            "labelIds": labels,
            "snippet": "snip",
            "payload": {
                "mimeType": "text/plain",
                "headers": [
                    {"name": "Subject", "value": "Lunch"},
                    {"name": "from", "value": from},
                    {"name": "Date", "value": "Mon, 1 Jan 2024 10:00:00 +0000"}
                ],
                "body": {"data": data}
            },
            "reaction": if reaction {
                serde_json::json!({"emoji": "👍", "from_addr": from, "in_reply_to": "<x>", "message_id": id})
            } else {
                serde_json::Value::Null
            }
        })
    }

    fn full_thread(messages: Vec<serde_json::Value>) -> crate::gmail::FullThread {
        serde_json::from_value(serde_json::json!({"id": "t", "messages": messages})).unwrap()
    }

    #[test]
    fn reply_context_uses_the_last_three_sent_messages() {
        let thread = full_thread(vec![
            message("1", "a@x.com", "first", &["INBOX"], false),
            message("2", "b@x.com", "second", &["INBOX"], false),
            message("3", "a@x.com", "third", &["SENT"], false),
            message("4", "b@x.com", "fourth", &["INBOX"], false),
            message("5", "b@x.com", "👍", &["INBOX"], true),
            message("6", "me@x.com", "unsent draft", &["DRAFT"], false),
        ]);
        let context = reply_context(&thread);
        assert!(context.starts_with("Subject: Lunch\n\n"), "{}", context);
        assert!(!context.contains("first"));
        for body in ["second", "third", "fourth"] {
            assert!(context.contains(body), "missing {}: {}", body, context);
        }
        assert!(!context.contains("👍"));
        assert!(!context.contains("unsent draft"));
        assert!(context.contains("From: b@x.com\nDate: Mon, 1 Jan 2024"));
    }

    #[test]
    fn reply_context_truncates_long_bodies_on_a_char_boundary() {
        let body = "é".repeat(1500);
        let context = reply_context(&full_thread(vec![message("1", "a@x.com", &body, &[], false)]));
        let kept = context.matches('é').count();
        assert_eq!(kept, 1000);
        assert!(context.contains("é..."));
    }

    #[test]
    fn cached_tokens_are_reused_only_with_a_minute_to_spare() {
        use std::time::{Duration, Instant};
        let now = Instant::now();
        let cache = super::TokenCache::new(HashMap::from([
            ("fresh".to_string(), ("t1".to_string(), now + Duration::from_secs(600))),
            ("expiring".to_string(), ("t2".to_string(), now + Duration::from_secs(30))),
        ]));
        assert_eq!(cached_access_token(&cache, "fresh"), Ok(Some("t1".to_string())));
        assert_eq!(cached_access_token(&cache, "expiring"), Ok(None));
        assert_eq!(cached_access_token(&cache, "unknown"), Ok(None));
    }

    struct FakeRefresher(Arc<std::sync::atomic::AtomicUsize>);

    impl super::TokenRefresher for FakeRefresher {
        async fn refresh(&self, refresh_token: &str) -> Result<(String, Option<u64>), String> {
            self.0.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            Ok((format!("access-for-{}", refresh_token), Some(3600)))
        }
    }

    #[tokio::test]
    async fn parallel_calls_on_an_expired_token_read_secure_storage_once() {
        use std::sync::atomic::AtomicUsize;
        let refreshes = Arc::new(AtomicUsize::new(0));
        let loads = Arc::new(AtomicUsize::new(0));
        let auth = tokio::sync::Mutex::new(Some(FakeRefresher(refreshes.clone())));
        let cache = super::TokenCache::new(HashMap::new());

        let calls = (0..10).map(|_| {
            let loads = loads.clone();
            super::refreshed_access_token(&auth, &cache, "a1", move || {
                loads.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(20));
                Ok("rt".to_string())
            })
        });
        let tokens = futures::future::join_all(calls).await;

        assert!(tokens.iter().all(|t| t.as_deref() == Ok("access-for-rt")), "{:?}", tokens);
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_missing_refresh_token_fails_the_call_without_caching_anything() {
        let auth = tokio::sync::Mutex::new(Some(FakeRefresher(Default::default())));
        let cache = super::TokenCache::new(HashMap::new());
        let err = super::refreshed_access_token(&auth, &cache, "a1", || Err("No matching entry".into())).await;
        assert_eq!(err, Err("No matching entry".to_string()));
        assert!(cache.lock().unwrap().is_empty());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn signing_in_again_keeps_the_account_its_cards_and_its_signature() {
        let dir = scratch_dir();
        let state = super::AppState::new();
        *state.db.lock().unwrap() = Some(super::open_database(&dir.join("posta.db")).unwrap());
        let user = |picture: &str| super::UserInfo { email: "me@x.com".into(), picture: Some(picture.into()) };

        let first = super::save_signed_in_account(&state, user("old.png"), "rt-1", &dir).unwrap();
        super::with_db(&state, |db| {
            db.insert_card(&owned_card("inbox", &first.id)).unwrap();
            db.update_account_signature(&first.id, Some("-- me")).map_err(|e| e.to_string())
        })
        .unwrap();

        let again = super::save_signed_in_account(&state, user("new.png"), "rt-2", &dir).unwrap();
        assert_eq!(again.id, first.id);
        let accounts = super::with_db(&state, |db| db.get_accounts().map_err(|e| e.to_string())).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].picture.as_deref(), Some("new.png"));
        assert_eq!(accounts[0].signature.as_deref(), Some("-- me"));
        let cards = super::with_db(&state, |db| db.get_cards(&first.id).map_err(|e| e.to_string())).unwrap();
        assert_eq!(ids(&cards), vec!["inbox"]);
        assert_eq!(crate::auth::get_refresh_token(&first.id, &dir).unwrap(), "rt-2");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A local HTTP server that answers every request with `reply`, or
    /// never answers when it is None
    async fn one_reply_server(reply: Option<&'static str>) -> String {
        status_reply_server("200 OK", reply).await
    }

    async fn status_reply_server(status: &'static str, reply: Option<&'static str>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/userinfo", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = socket.read(&mut buf).await;
                    match reply {
                        Some(body) => {
                            let response = format!(
                                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                status,
                                body.len(),
                                body
                            );
                            let _ = socket.write_all(response.as_bytes()).await;
                        }
                        None => tokio::time::sleep(std::time::Duration::from_secs(60)).await,
                    }
                });
            }
        });
        url
    }

    #[tokio::test]
    async fn a_sign_in_whose_account_lookup_never_answers_fails() {
        let url = one_reply_server(None).await;
        let client = super::userinfo_http_client(std::time::Duration::from_millis(300));
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), super::fetch_user_info(&client, &url, "t"))
            .await
            .expect("the lookup must time out on its own");
        let err = result.err().expect("a hung lookup is an error");
        assert!(err.starts_with("Couldn't read your Google account"), "{}", err);
        assert!(!err.contains("127.0.0.1"), "{}", err);
    }

    async fn user_info_error(status: &'static str, body: &'static str) -> String {
        let url = status_reply_server(status, Some(body)).await;
        let client = super::userinfo_http_client(std::time::Duration::from_secs(5));
        super::fetch_user_info(&client, &url, "t").await.err().expect("the lookup fails")
    }

    #[tokio::test]
    async fn a_failed_account_lookup_shows_googles_message_not_the_raw_body() {
        let err = user_info_error(
            "401 Unauthorized",
            r#"{"error": {"code": 401, "message": "Request had invalid authentication credentials.", "status": "UNAUTHENTICATED"}}"#,
        )
        .await;
        assert_eq!(err, "Couldn't read your Google account (401 Unauthorized): Request had invalid authentication credentials.");

        let err = user_info_error("401 Unauthorized", r#"{"error": "invalid_token", "error_description": "Invalid Value"}"#).await;
        assert_eq!(err, "Couldn't read your Google account (401 Unauthorized): Invalid Value");

        let err = user_info_error("502 Bad Gateway", "<html><body>Bad gateway</body></html>").await;
        assert_eq!(err, "Couldn't read your Google account (502 Bad Gateway)");

        let err = user_info_error("200 OK", r#"{"name": "no email here"}"#).await;
        assert!(err.starts_with("Couldn't read your Google account: "), "{}", err);
        assert!(!err.contains("no email here"), "{}", err);
    }

    #[tokio::test]
    async fn the_account_lookup_reads_email_and_picture() {
        let url = one_reply_server(Some(r#"{"email": "me@x.com", "picture": "https://p/me.png", "id": "1"}"#)).await;
        let client = super::userinfo_http_client(std::time::Duration::from_secs(5));
        let info = super::fetch_user_info(&client, &url, "t").await.unwrap();
        assert_eq!(info.email, "me@x.com");
        assert_eq!(info.picture.as_deref(), Some("https://p/me.png"));
    }

    fn card_at(position: i32) -> Card {
        Card::new("acct".into(), "c".into(), "q".into(), position)
    }

    #[test]
    fn next_card_position_goes_after_the_last_card_even_with_gaps() {
        assert_eq!(next_card_position(&[]), 0);
        assert_eq!(next_card_position(&[card_at(0), card_at(1)]), 2);
        // After deleting the middle card of [0, 1, 2] the remaining positions are [0, 2]
        assert_eq!(next_card_position(&[card_at(0), card_at(2)]), 3);
    }

    #[test]
    fn a_pull_that_cannot_apply_every_change_applies_none() {
        let dir = scratch_dir();
        let db = super::open_database(&dir.join("posta.db")).unwrap();
        let existing = Card::new("a1".into(), "Existing".into(), "q".into(), 0);
        let deleted_elsewhere = Card::new("a1".into(), "Deleted".into(), "q".into(), 1);
        db.insert_card(&existing).unwrap();
        db.insert_card(&deleted_elsewhere).unwrap();

        let fresh = Card::new("a1".into(), "Fresh".into(), "q".into(), 2);
        let merge = super::CardMerge {
            insert: vec![fresh.clone(), existing.clone()],
            delete: vec![deleted_elsewhere.id.clone()],
            ..Default::default()
        };
        assert!(super::apply_card_merge(&db, &merge).is_err());

        let ids: Vec<String> = db.get_cards("a1").unwrap().into_iter().map(|c| c.id).collect();
        assert_eq!(ids, vec![existing.id, deleted_elsewhere.id]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn opening_the_database_keeps_an_old_offline_cache() {
        // A user back after a few days, and offline, still sees their cards
        let dir = scratch_dir();
        let path = dir.join("posta.db");
        let groups = vec![crate::models::ThreadGroup { label: "Today".into(), threads: Vec::new() }];
        let card = Card::new("a1".into(), "Inbox".into(), "in:inbox".into(), 0);
        {
            let db = super::open_database(&path).unwrap();
            db.insert_card(&card).unwrap();
            db.save_card_threads(&card.id, &groups, None).unwrap();
            db.save_card_threads("deleted-card", &groups, None).unwrap();
        }
        let three_days_ago = chrono::Utc::now().timestamp() - 3 * 24 * 3600;
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute("UPDATE card_thread_cache SET cached_at = ?1", [three_days_ago])
            .unwrap();

        let db = super::open_database(&path).unwrap();
        let (cached, _, cached_at) = db.get_card_threads(&card.id).unwrap().expect("cache kept");
        assert_eq!(cached.len(), 1);
        assert_eq!(cached_at, three_days_ago);
        assert!(db.get_card_threads("deleted-card").unwrap().is_none(), "orphaned cache removed");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cancelling_sign_in_stops_the_flow_waiting_on_the_browser() {
        let flag = Arc::new(AtomicBool::new(false));
        let slot = std::sync::Mutex::new(Some(flag.clone()));
        super::cancel_pending_oauth(&slot).unwrap();
        assert!(flag.load(Ordering::SeqCst));
        assert!(slot.lock().unwrap().is_none());
        // Nothing in flight: nothing to do
        super::cancel_pending_oauth(&slot).unwrap();
    }

    #[test]
    fn a_sign_in_releases_its_cancel_flag_however_it_ends() {
        let slot = std::sync::Mutex::new(None);
        let first = super::PendingOAuth::begin(&slot).unwrap();
        let first_flag = first.flag.clone();
        // A retry cancels the flow before it and takes the slot over
        let second = super::PendingOAuth::begin(&slot).unwrap();
        assert!(first_flag.load(Ordering::SeqCst));
        drop(first);
        assert!(slot.lock().unwrap().is_some(), "the earlier flow must not release the retry's flag");
        // An early return (no browser, no auth config) drops the guard
        drop(second);
        assert!(slot.lock().unwrap().is_none());
    }

    #[test]
    fn the_sign_in_page_can_be_reopened_only_while_its_flow_waits() {
        let slot = std::sync::Mutex::new(None);
        assert!(super::pending_oauth_url(&slot).is_err());
        let first = super::WaitingOAuthUrl::publish(&slot, "https://accounts.example/first".into()).unwrap();
        assert_eq!(super::pending_oauth_url(&slot).unwrap(), "https://accounts.example/first");
        // A retry's page replaces the earlier one, which must not clear it
        let second = super::WaitingOAuthUrl::publish(&slot, "https://accounts.example/second".into()).unwrap();
        drop(first);
        assert_eq!(super::pending_oauth_url(&slot).unwrap(), "https://accounts.example/second");
        drop(second);
        assert!(super::pending_oauth_url(&slot).is_err());
    }

    #[test]
    fn credentials_already_in_secure_storage_are_not_written_again() {
        let known = std::sync::Mutex::new(None);
        let config = super::AuthConfig { client_id: "id".into(), client_secret: "secret".into() };
        let mut writes = 0;
        super::remember_credentials(&known, &config, |_| { writes += 1; Ok(()) }).unwrap();
        super::remember_credentials(&known, &config, |_| { writes += 1; Ok(()) }).unwrap();
        assert_eq!(writes, 1);

        let changed = super::AuthConfig { client_secret: "new".into(), ..config.clone() };
        let failed = super::remember_credentials(&known, &changed, |_| Err("keychain locked".into()));
        assert!(failed.is_err());
        super::remember_credentials(&known, &changed, |_| { writes += 1; Ok(()) }).unwrap();
        assert_eq!(writes, 2, "a failed write is retried");
    }

    #[test]
    fn no_command_runs_on_the_main_thread() {
        // Tauri runs a command declared without `async` on the main thread,
        // where database, keychain and iCloud calls stall the UI
        let mut lines = include_str!("commands.rs").lines();
        while let Some(line) = lines.next() {
            if line.trim() == "#[tauri::command]" {
                let signature = lines.next().unwrap_or_default();
                assert!(signature.trim_start().starts_with("pub async fn"), "{}", signature);
            }
        }
    }

    /// Lines of async fns in `source` that touch the database or secure
    /// storage outside a `blocking` closure
    fn blocking_work_on_async_workers(source: &str) -> Vec<String> {
        const BLOCKING_WORK: &[&str] = &[
            "with_db(", ".db.lock()", "auth::get_", "auth::store_", "auth::delete_", "write_unique_file(", "mark_quarantined(",
        ];
        // Calls that take a closure and run it on the blocking pool
        const OFFLOADERS: &[&str] = &["blocking(", "refreshed_access_token("];
        let mut offending = Vec::new();
        let mut in_async_fn = false;
        // Paren depth, and the depth an offloader call opened at: lines are
        // offloaded until its parentheses close again
        let (mut depth, mut offloaded_at): (i32, Option<i32>) = (0, None);
        for line in source.lines().take_while(|l| l.trim() != "#[cfg(test)]") {
            let code = line.trim_start();
            if ["fn ", "pub fn ", "async fn ", "pub async fn "].iter().any(|p| code.starts_with(p)) {
                in_async_fn = code.contains("async fn ");
                (depth, offloaded_at) = (0, None);
            }
            if offloaded_at.is_none() && OFFLOADERS.iter().any(|o| code.contains(o)) {
                offloaded_at = Some(depth);
            }
            if in_async_fn && offloaded_at.is_none() && BLOCKING_WORK.iter().any(|w| code.contains(w)) {
                offending.push(code.to_string());
            }
            depth += code.matches('(').count() as i32 - code.matches(')').count() as i32;
            if offloaded_at.is_some_and(|at| depth <= at) {
                offloaded_at = None;
            }
        }
        offending
    }

    #[test]
    fn async_commands_leave_database_and_keychain_work_to_the_blocking_pool() {
        // A keychain read can wait on a user prompt, and the database lock
        // is held while multi-megabyte caches are written; either stalls a
        // tokio worker and every command queued on it
        assert_eq!(blocking_work_on_async_workers(include_str!("commands.rs")), Vec::<String>::new());
        let sample = "pub async fn a() {\n    with_db(state, f)?;\n}\nasync fn b() {\n    blocking(&state, |s| with_db(s, f)).await\n}\n";
        assert_eq!(blocking_work_on_async_workers(sample), vec!["with_db(state, f)?;"]);
        // Only work inside the offloaded closure is off the async worker
        let after = "async fn c() {\n    blocking(&state, move |s| {\n        with_db(s, f)\n    })\n    .await?;\n    with_db(state, g)?;\n}\n";
        assert_eq!(blocking_work_on_async_workers(after), vec!["with_db(state, g)?;"]);
    }

    #[tokio::test]
    async fn blocking_work_runs_off_the_calling_thread() {
        let caller = std::thread::current().id();
        let ran_on = super::blocking(&super::AppState::new(), |_| Ok(std::thread::current().id())).await;
        assert_ne!(ran_on.unwrap(), caller);
    }

    #[test]
    fn a_refresh_that_finishes_after_its_card_was_deleted_leaves_no_cache() {
        let dir = scratch_dir();
        let state = super::AppState::new();
        let db = super::open_database(&dir.join("posta.db")).unwrap();
        db.insert_account(&account("a1", "me@x.com")).unwrap();
        db.insert_card(&owned_card("live", "a1")).unwrap();
        *state.db.lock().unwrap() = Some(db);

        let save = |id: &str| super::save_card_cache(&state, id, |db| db.save_card_threads(id, &[], None));
        save("live").unwrap();
        save("deleted").unwrap();
        super::save_card_cache(&state, "deleted", |db| db.save_card_events("deleted", &[])).unwrap();

        let guard = state.db.lock().unwrap();
        let db = guard.as_ref().unwrap();
        assert!(db.get_card_threads("live").unwrap().is_some());
        assert!(db.get_card_threads("deleted").unwrap().is_none());
        assert!(db.get_card_events("deleted").unwrap().is_none());
        drop(guard);
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// In-memory card backup; `unreadable` models an iCloud store that
    /// errors on every read, `refuses` one that errors on every write, and
    /// `downloading` one whose first download from iCloud has not finished
    #[derive(Default)]
    struct FakeBackup {
        cards: Option<Vec<Card>>,
        mappings: Option<HashMap<String, String>>,
        unreadable: bool,
        refuses: bool,
        downloading: bool,
    }

    #[derive(Clone, Default)]
    struct FakeStore(Arc<std::sync::Mutex<FakeBackup>>);

    impl super::CardBackupStore for FakeStore {
        fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
            let b = self.0.lock().unwrap();
            if b.unreadable { Err("unreadable".into()) } else { Ok(b.cards.clone()) }
        }

        fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String> {
            let b = self.0.lock().unwrap();
            if b.unreadable { Err("unreadable".into()) } else { Ok(b.mappings.clone()) }
        }

        fn sync_cards(&self, cards: &[Card]) -> Result<(), String> {
            let mut b = self.0.lock().unwrap();
            if b.refuses {
                return Err("iCloud key-value store is unavailable".into());
            }
            b.cards = Some(cards.to_vec());
            Ok(())
        }

        fn sync_account_mappings(&self, mappings: &HashMap<String, String>) -> Result<(), String> {
            let mut b = self.0.lock().unwrap();
            if b.refuses {
                return Err("iCloud key-value store is unavailable".into());
            }
            b.mappings = Some(mappings.clone());
            Ok(())
        }

        fn initial_sync_done(&self) -> bool {
            !self.0.lock().unwrap().downloading
        }
    }

    impl FakeStore {
        fn backup(&self) -> Backup {
            let b = self.0.lock().unwrap();
            Backup::from_store(b.cards.clone(), b.mappings.clone()).unwrap_or_default()
        }
    }

    /// App state over a scratch database holding `cards` of account a1, with
    /// an iCloud backup holding the same cards and a record of having synced them
    fn synced_state(dir: &std::path::Path, cards: &[Card]) -> (super::AppState, FakeStore) {
        let state = super::AppState::new();
        let db = super::open_database(&dir.join("posta.db")).unwrap();
        db.insert_account(&account("a1", "me@x.com")).unwrap();
        for card in cards {
            db.insert_card(card).unwrap();
        }
        *state.db.lock().unwrap() = Some(db);

        let store = FakeStore::default();
        store.0.lock().unwrap().cards = Some(cards.to_vec());
        store.0.lock().unwrap().mappings = Some(mappings(&[("a1", "me@x.com")]));
        {
            let mut icloud = state.icloud.lock().unwrap();
            icloud.store = Some(Box::new(store.clone()));
            icloud.record_path = Some(dir.join("icloud-card-sync.json"));
            icloud.save_record(&synced(cards));
        }
        (state, store)
    }

    fn sorted_ids(cards: &[Card]) -> Vec<&str> {
        let mut ids = ids(cards);
        ids.sort();
        ids
    }

    fn local_card_ids(state: &super::AppState) -> Vec<String> {
        let guard = state.db.lock().unwrap();
        let mut ids: Vec<String> = guard.as_ref().unwrap().get_cards("a1").unwrap().into_iter().map(|c| c.id).collect();
        ids.sort();
        ids
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_builds_leave_the_installed_apps_icloud_backup_alone() {
        let icloud = super::ICloudSync::new();
        assert!(icloud.store.is_none());
        assert_eq!(icloud.load_backup(), Ok(None));
    }

    #[test]
    fn deleting_a_card_tombstones_it_in_icloud() {
        let dir = scratch_dir();
        let (keep, gone) = (owned_card("keep", "a1"), owned_card("gone", "a1"));
        let (state, store) = synced_state(&dir, &[keep, gone]);

        super::change_cards(&state, Some("gone"), |db| db.delete_card("gone").map_err(|e| e.to_string())).unwrap();

        assert_eq!(local_card_ids(&state), vec!["keep"]);
        let pushed = store.backup();
        assert_eq!(sorted_ids(&pushed.cards), vec!["keep"]);
        assert!(pushed.tombstones.contains_key("gone"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_deletion_made_while_icloud_is_unreadable_survives_the_next_pull() {
        let dir = scratch_dir();
        let (keep, gone) = (owned_card("keep", "a1"), owned_card("gone", "a1"));
        let (state, store) = synced_state(&dir, &[keep, gone]);

        store.0.lock().unwrap().unreadable = true;
        super::change_cards(&state, Some("gone"), |db| db.delete_card("gone").map_err(|e| e.to_string())).unwrap();
        assert_eq!(sorted_ids(&store.backup().cards), vec!["gone", "keep"], "nothing written while unreadable");

        store.0.lock().unwrap().unreadable = false;
        super::pull_cards_from_icloud(&state).unwrap();

        assert_eq!(local_card_ids(&state), vec!["keep"]);
        let pushed = store.backup();
        assert_eq!(sorted_ids(&pushed.cards), vec!["keep"]);
        assert!(pushed.tombstones.contains_key("gone"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn icloud_status(state: &super::AppState) -> super::ICloudSyncStatus {
        state.icloud.lock().unwrap().status()
    }

    #[test]
    fn a_card_backup_icloud_refuses_is_reported_until_a_write_goes_through() {
        let dir = scratch_dir();
        let (state, store) = synced_state(&dir, &[owned_card("keep", "a1")]);
        assert_eq!(icloud_status(&state), super::ICloudSyncStatus { available: true, last_synced_at: None, last_error: None });

        store.0.lock().unwrap().refuses = true;
        super::change_cards(&state, None, |db| db.insert_card(&owned_card("new", "a1")).map_err(|e| e.to_string())).unwrap();
        let status = icloud_status(&state);
        assert!(status.last_error.as_deref().is_some_and(|e| e.contains("unavailable")), "{:?}", status);
        assert_eq!(status.last_synced_at, None);

        store.0.lock().unwrap().refuses = false;
        super::change_cards(&state, None, |_| Ok(())).unwrap();
        let status = icloud_status(&state);
        assert_eq!(status.last_error, None);
        assert!(status.last_synced_at.is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pull_that_cannot_read_icloud_is_reported() {
        let dir = scratch_dir();
        let (state, store) = synced_state(&dir, &[owned_card("keep", "a1")]);
        store.0.lock().unwrap().unreadable = true;
        assert!(super::pull_cards_from_icloud(&state).is_err());
        assert!(icloud_status(&state).last_error.is_some());

        // A device that has synced before reads an empty store as iCloud
        // being unavailable, not as nothing to pull
        *store.0.lock().unwrap() = FakeBackup::default();
        assert_eq!(super::pull_cards_from_icloud(&state), Ok(false));
        assert!(icloud_status(&state).last_error.as_deref().is_some_and(|e| e.contains("unavailable")));

        *store.0.lock().unwrap() =
            FakeBackup { cards: Some(vec![owned_card("keep", "a1")]), mappings: Some(mappings(&[("a1", "me@x.com")])), ..Default::default() };
        super::pull_cards_from_icloud(&state).unwrap();
        let status = icloud_status(&state);
        assert_eq!(status.last_error, None);
        assert!(status.last_synced_at.is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_builds_report_icloud_sync_as_unavailable() {
        assert!(!super::ICloudSync::new().status().available);
    }

    fn record_at(path: std::path::PathBuf) -> super::ICloudSync {
        super::ICloudSync { store: None, record_path: Some(path), last_synced_at: None, last_error: None }
    }

    #[test]
    fn an_unreadable_sync_record_does_not_make_an_empty_store_look_like_a_first_push() {
        let dir = scratch_dir();
        let path = dir.join("icloud-card-sync.json");
        std::fs::write(&path, br#"{"base": {"c": {"id""#).unwrap();

        let mut record = record_at(path).load_record();
        assert!(record.seen_backup);
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut record, true).ok(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_device_without_a_sync_record_has_never_seen_a_backup() {
        let dir = scratch_dir();
        assert_eq!(record_at(dir.join("icloud-card-sync.json")).load_record(), SyncRecord::default());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_sync_record_is_replaced_whole() {
        let dir = scratch_dir();
        let icloud = record_at(dir.join("icloud-card-sync.json"));
        let first = tombstoned(synced(&[owned_card("a", "a1")]), &["gone"]);
        icloud.save_record(&first);
        assert_eq!(icloud.load_record(), first);

        let second = synced(&[owned_card("b", "a1")]);
        icloud.save_record(&second);
        assert_eq!(icloud.load_record(), second);
        let files: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(files, vec![std::ffi::OsString::from("icloud-card-sync.json")], "no temp file left behind");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sanitize_keeps_plain_filenames() {
        assert_eq!(sanitize_attachment_filename("report.pdf"), "report.pdf");
        assert_eq!(sanitize_attachment_filename("photo (1).jpg"), "photo (1).jpg");
    }

    #[test]
    fn sanitize_strips_directory_components() {
        assert_eq!(sanitize_attachment_filename("../../evil.sh"), "evil.sh");
        assert_eq!(sanitize_attachment_filename("/etc/passwd"), "passwd");
        assert_eq!(sanitize_attachment_filename("a/b/c.txt"), "c.txt");
    }

    #[test]
    fn sanitize_rejects_traversal_only_names() {
        assert_eq!(sanitize_attachment_filename(".."), "attachment");
        assert_eq!(sanitize_attachment_filename("foo/.."), "attachment");
        assert_eq!(sanitize_attachment_filename("/"), "attachment");
        assert_eq!(sanitize_attachment_filename(""), "attachment");
    }



    #[test]
    fn an_all_inboxes_card_from_icloud_stays_one() {
        let accounts = [account("a1", "me@x.com"), account("a2", "work@x.com")];
        assert_eq!(icloud_card_account(ALL_ACCOUNTS, &mappings(&[]), &accounts), Some(ALL_ACCOUNTS.into()));
        assert_eq!(icloud_card_account(ALL_ACCOUNTS, &mappings(&[("all", "*")]), &accounts[..1]), Some(ALL_ACCOUNTS.into()));
    }

    #[test]
    fn a_push_maps_the_all_inboxes_owner_to_no_email() {
        let accounts = [account("a1", "me@x.com")];
        let cards = vec![owned_card("mine", "a1"), owned_card("everything", ALL_ACCOUNTS)];
        let (pushed, _) = plan_push(&accounts, cards, Backup::default(), &SyncRecord::default(), NOW).unwrap();
        assert_eq!(pushed.emails, mappings(&[("a1", "me@x.com"), (ALL_ACCOUNTS, "*")]));
        assert_eq!(sorted_ids(&pushed.cards), ["everything", "mine"]);
    }

    #[test]
    fn an_owner_mapped_to_no_email_is_foreign_even_to_a_lone_account() {
        // How an older Mac, which knows no all-inboxes cards, reads one: its
        // lone account must not adopt it and run it as its own
        let accounts = [account("a1", "me@x.com")];
        assert_eq!(icloud_card_account("elsewhere", &mappings(&[("elsewhere", "*")]), &accounts), None);
        let backup = backup(vec![owned_card("everything", "elsewhere")], &[("elsewhere", "*")], &[]);
        let merge = plan_pull(&accounts, &[], backup, &SyncRecord::default(), NOW);
        assert!(merge.insert.is_empty());
    }

    fn board_ids(state: &super::AppState) -> Vec<String> {
        let guard = state.db.lock().unwrap();
        let mut ids: Vec<String> = guard.as_ref().unwrap().get_board_cards().unwrap().into_iter().map(|c| c.id).collect();
        ids.sort();
        ids
    }

    #[test]
    fn an_all_inboxes_card_pulled_from_icloud_is_kept_once_and_pushed_back() {
        let dir = scratch_dir();
        let mine = owned_card("mine", "a1");
        let (state, store) = synced_state(&dir, std::slice::from_ref(&mine));
        {
            // Added on another Mac
            let mut backup = store.0.lock().unwrap();
            backup.cards.as_mut().unwrap().push(owned_card("everything", ALL_ACCOUNTS));
            backup.mappings.as_mut().unwrap().insert(ALL_ACCOUNTS.into(), "*".into());
        }

        assert!(super::pull_cards_from_icloud(&state).unwrap());
        assert!(!super::pull_cards_from_icloud(&state).unwrap(), "a second pull changes nothing");
        assert_eq!(board_ids(&state), ["everything", "mine"]);

        super::change_cards(&state, None, |db| db.reorder_cards(&[("everything".into(), 0), ("mine".into(), 1)]).map_err(|e| e.to_string()))
            .unwrap();
        let pushed = store.backup();
        assert_eq!(sorted_ids(&pushed.cards), ["everything", "mine"]);
        assert_eq!(pushed.emails.get(ALL_ACCOUNTS).map(String::as_str), Some("*"));
        assert_eq!(icloud_status(&state).last_error, None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_backup_an_older_mac_rewrote_keeps_the_all_inboxes_card() {
        // An older Mac carries the card over as another account's, with its
        // mapping, and adds its own cards under its own account ids
        let dir = scratch_dir();
        let (state, store) = synced_state(&dir, &[owned_card("mine", "a1")]);
        {
            let mut backup = store.0.lock().unwrap();
            backup.cards = Some(vec![owned_card("mine", "old-a1"), owned_card("everything", ALL_ACCOUNTS), owned_card("added", "old-a1")]);
            backup.mappings = Some(mappings(&[("old-a1", "me@x.com"), (ALL_ACCOUNTS, "*")]));
        }

        super::pull_cards_from_icloud(&state).unwrap();
        assert_eq!(board_ids(&state), ["added", "everything", "mine"]);
        let pushed = store.backup();
        assert_eq!(sorted_ids(&pushed.cards), ["added", "everything", "mine"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_card_is_created_for_a_signed_in_account_or_all_of_them_after_the_last_card() {
        let dir = scratch_dir();
        let db = super::open_database(&dir.join("posta.db")).unwrap();
        db.insert_account(&account("a1", "me@x.com")).unwrap();
        db.insert_account(&account("a2", "work@x.com")).unwrap();
        db.insert_card(&Card { position: 3, ..owned_card("work", "a2") }).unwrap();

        let card = super::insert_new_card(&db, "a1".into(), "Mine".into(), "q".into(), None, None, None).unwrap();
        assert_eq!(card.position, 4, "after every account's cards");
        let all = super::insert_new_card(&db, ALL_ACCOUNTS.into(), "All".into(), "cal:7d".into(), None, None, Some("calendar".into())).unwrap();
        assert_eq!((all.position, all.card_type.as_str()), (5, "calendar"));

        let err = super::insert_new_card(&db, "signed-out".into(), "X".into(), "q".into(), None, None, None).unwrap_err();
        assert_eq!(err, "Account not found");
        assert!(super::check_card_scope(&db, "a2").is_ok());
        assert_eq!(super::check_card_scope(&db, "nope"), Err("Account not found".into()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_card_is_looked_up_by_id_and_needs_a_signed_in_owner() {
        let dir = scratch_dir();
        let db = super::open_database(&dir.join("posta.db")).unwrap();
        db.insert_account(&account("a1", "me@x.com")).unwrap();
        db.insert_card(&owned_card("mine", "a1")).unwrap();
        db.insert_card(&owned_card("everything", ALL_ACCOUNTS)).unwrap();
        db.insert_card(&owned_card("orphan", "gone")).unwrap();

        assert_eq!(super::board_card(&db, "mine").unwrap().id, "mine");
        assert_eq!(super::board_card(&db, "everything").unwrap().id, "everything");
        assert_eq!(super::board_card(&db, "orphan").unwrap_err(), "Card not found");
        assert_eq!(super::board_card(&db, "missing").unwrap_err(), "Card not found");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A mailbox listing `threads` (id, minutes ago) two to a page
    struct FakeMailbox {
        threads: Vec<(String, i64)>,
        fails: Option<&'static str>,
    }

    impl super::MailboxLister for FakeMailbox {
        async fn list_ids(&self, _query: &str, page: Option<&str>) -> Result<(Vec<String>, Option<String>), String> {
            if let Some(e) = self.fails {
                return Err(e.to_string());
            }
            let start: usize = page.map_or(0, |p| p.parse().unwrap());
            let end = (start + 2).min(self.threads.len());
            let next = (end < self.threads.len()).then(|| end.to_string());
            Ok((self.threads[start..end].iter().map(|(id, _)| id.clone()).collect(), next))
        }

        async fn details(&self, ids: &[String]) -> Result<Vec<Thread>, String> {
            Ok(ids
                .iter()
                .map(|id| {
                    let ago = self.threads.iter().find(|(t, _)| t == id).unwrap().1;
                    Thread { last_message_date: chrono::DateTime::from_timestamp(1_800_000_000 - ago * 60, 0).unwrap(), ..thread(id) }
                })
                .collect())
        }
    }

    fn mailbox(threads: &[(&str, i64)]) -> FakeMailbox {
        FakeMailbox { threads: threads.iter().map(|(id, ago)| (id.to_string(), *ago)).collect(), fails: None }
    }

    fn listed(result: &crate::gmail::SearchResult) -> Vec<(String, String)> {
        result.groups.iter().flat_map(|g| &g.threads).map(|t| (t.gmail_thread_id.clone(), t.account_id.clone())).collect()
    }

    #[tokio::test]
    async fn an_all_inboxes_card_pages_through_every_mailbox_naming_each_threads_account() {
        let accounts = vec![account("a1", "me@x.com"), account("a2", "work@x.com")];
        let open = |a: &Account| {
            let mailbox = if a.id == "a1" { mailbox(&[("m1", 1), ("m2", 30), ("m3", 90)]) } else { mailbox(&[("w1", 10), ("w2", 20)]) };
            async move { Ok::<_, String>(mailbox) }
        };

        let first = super::all_inboxes_page(&accounts, "in:inbox", None, open).await.unwrap();
        let pairs = |v: &[(&str, &str)]| v.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect::<Vec<_>>();
        assert_eq!(listed(&first), pairs(&[("m1", "a1"), ("w1", "a2"), ("w2", "a2"), ("m2", "a1")]));
        assert!(first.has_more);

        let second = super::all_inboxes_page(&accounts, "in:inbox", first.next_page_token.as_deref(), open).await.unwrap();
        assert_eq!(listed(&second), pairs(&[("m3", "a1")]));
        assert!(!second.has_more);
        assert_eq!(second.next_page_token, None);

        // Signed out of a1 meanwhile: the rest of its mail is not listed
        let only_work = vec![account("a2", "work@x.com")];
        let after_sign_out = super::all_inboxes_page(&only_work, "in:inbox", first.next_page_token.as_deref(), open).await.unwrap();
        assert!(listed(&after_sign_out).is_empty());
    }

    #[tokio::test]
    async fn an_all_inboxes_page_fails_whole_naming_the_account_that_failed() {
        let accounts = vec![account("a1", "me@x.com"), account("a2", "work@x.com")];
        let open = |a: &Account| {
            let mut mailbox = mailbox(&[("t", 1)]);
            if a.id == "a2" {
                mailbox.fails = Some("401 Unauthorized");
            }
            async move { Ok::<_, String>(mailbox) }
        };
        let (account_id, message) = super::all_inboxes_page(&accounts, "q", None, open).await.unwrap_err();
        assert_eq!((account_id.as_str(), message.as_str()), ("a2", "work@x.com: Search failed: 401 Unauthorized"));

        let no_token = |a: &Account| {
            let failed = a.id == "a1";
            async move { if failed { Err("invalid_grant".to_string()) } else { Ok(mailbox(&[])) } }
        };
        let (account_id, message) = super::all_inboxes_page(&accounts, "q", None, no_token).await.unwrap_err();
        assert_eq!((account_id.as_str(), message.as_str()), ("a1", "me@x.com: invalid_grant"));
    }

    #[test]
    fn fetched_threads_carry_their_account() {
        let mut groups = vec![crate::models::ThreadGroup { label: "Today".into(), threads: vec![thread("t1"), thread("t2")] }];
        super::tag_thread_groups(&mut groups, "a2");
        assert!(groups[0].threads.iter().all(|t| t.account_id == "a2"));
    }
}
