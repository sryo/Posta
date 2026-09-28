// Tauri command handlers

// Command parameters are the frontend's invoke() argument names, so they stay flat
#![allow(clippy::too_many_arguments)]

use crate::auth::{self, CallbackServer, GmailAuth};
use crate::ai::GeminiClient;
use crate::cache::CacheDb;
use crate::gmail::{GmailClient, GmailDraft, GmailLabel, OutgoingMessage, SearchResult};
use crate::icloud::ICloudKVStore;
use crate::models::{Account, Card, SendAttachment, ThreadGroup};
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

// --- Helper functions to reduce boilerplate ---

/// Get app data directory from handle. Debug builds keep their own
/// subdirectory so development never shares accounts, cache or secret files
/// with the installed app.
fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(if cfg!(debug_assertions) { dir.join("dev") } else { dir })
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
}

impl ICloudSync {
    fn new() -> Self {
        let store: Option<Box<dyn CardBackupStore>> =
            if cfg!(debug_assertions) { None } else { Some(Box::new(ICloudKVStore::new())) };
        Self { store, record_path: None }
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

/// Which side changed a card that both sides have, judged against the base
#[derive(Debug, PartialEq)]
enum Changed {
    Neither,
    Local,
    Remote,
    /// Both sides, or no base to tell
    Both,
}

fn changed_side(local: &Card, remote: &Card, base: Option<&Card>) -> Changed {
    if local == remote {
        Changed::Neither
    } else if base == Some(local) {
        Changed::Remote
    } else if base == Some(remote) {
        Changed::Local
    } else {
        Changed::Both
    }
}

/// Backup cards not tombstoned, split into those owned by a local account
/// (re-keyed to its local id) and those of accounts this device lacks
fn split_backup_cards(
    backup_cards: Vec<Card>,
    emails: &HashMap<String, String>,
    tombstones: &HashMap<String, i64>,
    accounts: &[Account],
) -> (Vec<Card>, Vec<Card>) {
    let mut own = Vec::new();
    let mut foreign = Vec::new();
    for mut card in backup_cards {
        if tombstones.contains_key(&card.id) {
            continue;
        }
        match icloud_card_account(&card.account_id, emails, accounts) {
            Some(account_id) => {
                card.account_id = account_id;
                own.push(card);
            }
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
    let (mut remote, foreign) = split_backup_cards(backup.cards, &backup.emails, &tombstones, accounts);
    let mut new_record = SyncRecord { base: HashMap::new(), tombstones: tombstones.clone(), seen_backup: record.seen_backup };

    let mut cards = Vec::new();
    for local in local_cards {
        // Deleted on another device; the next pull removes it here
        if tombstones.contains_key(&local.id) {
            continue;
        }
        let base = record.base.get(&local.id);
        let card = match take_card(&mut remote, &local.id) {
            // The base stays at the local copy, so the next pull still sees
            // the change as made elsewhere and applies it here
            Some(remote) if changed_side(&local, &remote, base) == Changed::Remote => {
                new_record.base.insert(local.id.clone(), local);
                remote
            }
            _ => {
                new_record.base.insert(local.id.clone(), local.clone());
                local
            }
        };
        cards.push(card);
    }
    cards.extend(remote);
    cards.extend(foreign);

    let mut emails = backup.emails;
    emails.extend(accounts.iter().map(|a| (a.id.clone(), a.email.clone())));
    let owners: std::collections::HashSet<&str> = cards.iter().map(|c| c.account_id.as_str()).collect();
    emails.retain(|id, _| owners.contains(id.as_str()));

    Some((Backup { cards, emails, tombstones }, new_record))
}

/// Push every card to iCloud after a local card change. The caller holds the
/// iCloud lock from before its database write, so a pull can't merge in
/// between.
fn push_cards_to_icloud(icloud: &ICloudSync, state: &AppState, deleted_card: Option<&str>) {
    let mut record = icloud.load_record();
    if let Some(id) = deleted_card {
        record.tombstones.insert(id.to_string(), now_ms());
        record.base.remove(id);
        // Saved even if nothing is pushed below, so the deletion goes out
        // with a later push and a pull can't bring the card back meanwhile
        icloud.save_record(&record);
    }

    let (accounts, local_cards) = {
        let Ok(db_guard) = state.db.lock() else { return };
        let Some(db) = db_guard.as_ref() else { return };
        let Ok(accounts) = db.get_accounts() else { return };
        let mut cards = Vec::new();
        for account in &accounts {
            match db.get_cards(&account.id) {
                Ok(c) => cards.extend(c),
                // A partial list would drop the missing cards from iCloud
                Err(_) => return,
            }
        }
        (accounts, cards)
    };

    let Some(store) = &icloud.store else { return };
    let Some(backup) = backup_to_push_onto(icloud.load_backup(), &mut record, store.initial_sync_done()) else {
        return;
    };
    let Some((backup, new_record)) = plan_push(&accounts, local_cards, backup, &record, now_ms()) else {
        return;
    };
    if let Err(e) = store.sync_account_mappings(&backup.mappings()) {
        tracing::warn!("iCloud account mapping sync failed: {}", e);
        return;
    }
    match store.sync_cards(&backup.cards) {
        Ok(()) => icloud.save_record(&new_record),
        Err(e) => tracing::warn!("iCloud card sync failed: {}", e),
    }
}

/// The backup a push merges into, or None when the backup must not be
/// overwritten. Marks the record as having seen a backup, which only sticks
/// once the push is written.
fn backup_to_push_onto(
    loaded: Result<Option<Backup>, String>,
    record: &mut SyncRecord,
    initial_sync_done: bool,
) -> Option<Backup> {
    // A new Mac's store is empty, or holds only some keys, until iCloud has
    // downloaded it; a write then would replace the backup other Macs made
    if !record.seen_backup && !initial_sync_done {
        tracing::warn!("iCloud has not downloaded the card backup yet; card changes stay on this device for now");
        return None;
    }
    match loaded {
        Ok(Some(backup)) => {
            record.seen_backup = true;
            Some(backup)
        }
        // No device has pushed yet, as far as this one knows
        Ok(None) if !record.seen_backup => {
            record.seen_backup = true;
            Some(Backup::default())
        }
        Ok(None) => {
            tracing::warn!("iCloud card backup is unavailable; card changes stay on this device for now");
            None
        }
        Err(e) => {
            tracing::warn!("iCloud card backup is unreadable, not overwriting it: {}", e);
            None
        }
    }
}

/// Run a card database write, then push the cards to iCloud
fn change_cards<T>(
    state: &AppState,
    deleted_card: Option<&str>,
    write: impl FnOnce(&CacheDb) -> Result<T, String>,
) -> Result<T, String> {
    let icloud = state.icloud.lock().map_err(|_| "Lock error")?;
    let result = with_db(state, write)?;
    push_cards_to_icloud(&icloud, state, deleted_card);
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

    blocking(&state, move |state| match auth::get_oauth_credentials(&app_data_dir) {
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
    // Cancel any previous in-flight flow so it releases port 8420 promptly
    let cancel_flag = {
        let mut slot = state.oauth_cancel.lock().map_err(|_| "Lock error")?;
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::SeqCst);
        }
        let flag = Arc::new(AtomicBool::new(false));
        *slot = Some(flag.clone());
        flag
    };

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

    // Wait for callback in a blocking thread
    let wait_cancel = cancel_flag.clone();
    let callback_result = tokio::task::spawn_blocking(move || server.wait_for_callback(120, wait_cancel, &expected_state))
        .await
        .map_err(|e| format!("Task error: {}", e))?;

    // Release the cancel slot if it still belongs to this flow
    {
        let mut slot = state.oauth_cancel.lock().map_err(|_| "Lock error")?;
        if slot.as_ref().is_some_and(|f| Arc::ptr_eq(f, &cancel_flag)) {
            *slot = None;
        }
    }

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
        .map_err(|e| format!("Failed to read your Google account: {}", e.without_url()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    #[derive(Deserialize)]
    struct GoogleUserInfo {
        email: String,
        picture: Option<String>,
    }

    let body = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let info: GoogleUserInfo = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response: {} - Body: {}", e, body))?;
    Ok(UserInfo {
        email: info.email,
        picture: info.picture,
    })
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

    Ok(())
}

#[tauri::command]
pub async fn update_account_signature(account_id: String, signature: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| {
        with_db(state, |db| db.update_account_signature(&account_id, signature.as_deref()).map_err(|e| e.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn get_cards(account_id: String, state: State<'_, AppState>) -> Result<Vec<Card>, String> {
    blocking(&state, move |state| with_db(state, |db| db.get_cards(&account_id).map_err(|e| e.to_string()))).await
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
    blocking(&state, move |state| change_cards(state, None, |db| {
        let cards = db.get_cards(&account_id).map_err(|e| e.to_string())?;
        let position = next_card_position(&cards);

        let card_type_value = card_type.unwrap_or_else(|| "email".to_string());
        let mut card = if card_type_value == "calendar" {
            Card::new_calendar(account_id, name, query, position)
        } else {
            Card::new(account_id, name, query, position)
        };
        card.color = color;
        card.group_by = group_by.unwrap_or_else(|| "date".to_string());
        db.insert_card(&card).map_err(|e| e.to_string())?;
        Ok(card)
    }))
    .await
}

#[tauri::command]
pub async fn update_card(card: Card, state: State<'_, AppState>) -> Result<(), String> {
    blocking(&state, move |state| change_cards(state, None, |db| db.update_card(&card).map_err(|e| e.to_string()))).await
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

/// A card of a local account, or "Account not found" / "Card not found"
async fn find_card(state: &AppState, account_id: &str, card_id: &str) -> Result<Card, String> {
    let (account_id, card_id) = (account_id.to_string(), card_id.to_string());
    blocking(state, move |state| {
        with_db(state, |db| {
            if !db.get_accounts().map_err(|e| e.to_string())?.iter().any(|a| a.id == account_id) {
                return Err("Account not found".to_string());
            }
            db.get_card(&account_id, &card_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Card not found".to_string())
        })
    })
    .await
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

#[tauri::command]
pub async fn fetch_threads_paginated(
    account_id: String,
    card_id: String,
    page_token: Option<String>,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    tracing::info!("fetch_threads_paginated for card: {}, page_token: {:?}", card_id, page_token);

    let card = find_card(&state, &account_id, &card_id).await?;
    let access_token = get_access_token(&state, &app_handle, &account_id).await?;

    let gmail = GmailClient::new(access_token);
    let result = evict_token_on_auth_error(
        &state,
        &account_id,
        gmail
            .search_threads_paginated(&card.query, page_token.as_deref())
            .await,
    )
    .map_err(|e| format!("Search failed: {}", e))?;

    tracing::info!("Found {} groups, has_more: {}", result.groups.len(), result.has_more);

    Ok(result)
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
        async move {
            gmail
                .modify_thread(&thread_id, add, remove)
                .await
                .map_err(|e| format!("Failed to modify thread {}: {}", thread_id, e))
        }
    })
    .await;

    // Return first error if any
    for result in results {
        evict_token_on_auth_error(&state, &account_id, result)?;
    }

    Ok(())
}

/// Gmail answers 429 "Too many concurrent requests for user" past a few
/// requests in flight, so a bulk action on a large selection runs this many
/// at a time
const MAX_CONCURRENT_THREAD_REQUESTS: usize = 8;

async fn for_each_thread<F, Fut>(thread_ids: Vec<String>, request: F) -> Vec<Result<(), String>>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    use futures::StreamExt;
    futures::stream::iter(thread_ids)
        .map(request)
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
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    // Limit to 5 threads for preview
    evict_token_on_auth_error(&state, &account_id, gmail.search_threads_limited(&query, 5).await)
        .map_err(|e| format!("Search failed: {}", e))
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
    if accounts.iter().any(|a| a.id == card_account_id) {
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
    let (mut remote, foreign) = split_backup_cards(backup.cards, &backup.emails, &tombstones, accounts);
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
            // Added here, or left out by another device's write before this
            // one's reached it
            merge.needs_push = true;
            if let Some(base) = base {
                merge.record.base.insert(local.id.clone(), base.clone());
            }
            continue;
        };
        match changed_side(local, &remote, base) {
            Changed::Neither => {
                merge.record.base.insert(local.id.clone(), remote);
            }
            Changed::Local => {
                merge.needs_push = true;
                merge.record.base.insert(local.id.clone(), remote);
            }
            Changed::Remote | Changed::Both => {
                merge.record.base.insert(local.id.clone(), remote.clone());
                merge.update.push(remote);
            }
        }
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
    let icloud = state.icloud.lock().map_err(|_| "Lock error")?;

    let Some(backup) = icloud.load_backup()? else {
        return Ok(false);
    };

    let merge = {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;

        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        let mut local_cards = Vec::new();
        for account in &accounts {
            local_cards.extend(db.get_cards(&account.id).map_err(|e| e.to_string())?);
        }

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
    if merge.needs_push {
        push_cards_to_icloud(&icloud, state, None);
    }

    Ok(!(merge.insert.is_empty() && merge.update.is_empty() && merge.delete.is_empty()))
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
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let parsed_query = crate::calendar::CalendarQuery::parse(&query);
    // Cap high enough that a month view on a busy account isn't silently cut off
    evict_token_on_auth_error(&state, &account_id, calendar.search_events(&parsed_query, 500).await)
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
            },
        )
        .await;
    evict_token_on_auth_error(&state, &account_id, result)
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
    evict_token_on_auth_error(&state, &account_id, result)
}

#[tauri::command]
pub async fn delete_calendar_event(
    account_id: String,
    calendar_id: String,
    event_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, calendar.delete_event(&calendar_id, &event_id).await)
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
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::GoogleCalendarEvent, String> {
    let access_token = account_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar
        .update_event(
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
            },
        )
        .await;
    evict_token_on_auth_error(&state, &account_id, result)
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
    blocking(&state, move |_| Ok(auth::get_gemini_api_key(&app_data_dir).is_some())).await
}

#[tauri::command]
pub async fn suggest_replies(
    account_id: String,
    thread_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    let api_key = blocking(&state, move |_| {
        auth::get_gemini_api_key(&app_data_dir).ok_or_else(|| "Gemini API key is required for smart replies.".to_string())
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
        attachment_filename, attachment_temp_dir, cached_access_token, icloud_card_account, is_auth_error,
        is_executable_attachment, mark_quarantined, merged_tombstones, next_card_position, plan_pull, plan_push,
        refuse_executable_attachment, Backup, SyncRecord,
        reply_context, sanitize_attachment_filename, vanished_thread_ids, write_unique_file,
    };
    use crate::models::{Account, Card, Thread};
    use std::collections::HashMap;
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

        let results = super::for_each_thread(ids, |id| {
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
        assert_eq!(results.iter().filter(|r| r.is_err()).count(), 1);
        let peak = peak.load(Ordering::SeqCst);
        assert!(peak > 1 && peak <= super::MAX_CONCURRENT_THREAD_REQUESTS, "peak {}", peak);
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
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut seen, true), None, "iCloud unavailable after a backup was seen");
        assert_eq!(super::backup_to_push_onto(Err("bad json".into()), &mut seen, true), None);
        assert_eq!(super::backup_to_push_onto(Err("bad json".into()), &mut SyncRecord::default(), true), None);

        let b = backup(vec![owned_card("c", "a1")], &[], &[]);
        let mut fresh = SyncRecord::default();
        assert_eq!(super::backup_to_push_onto(Ok(Some(b.clone())), &mut fresh, true), Some(b));
        assert!(fresh.seen_backup);
    }

    #[test]
    fn the_first_push_starts_the_backup_and_later_empty_reads_are_not_trusted() {
        let mut record = SyncRecord::default();
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut record, true), Some(Backup::default()));
        assert!(record.seen_backup);
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut record, true), None);
    }

    #[test]
    fn a_fresh_device_does_not_push_before_icloud_has_downloaded() {
        // An empty or half-downloaded store on a new Mac is not the backup;
        // writing over it would replace the only copy of the layout
        let mut fresh = SyncRecord::default();
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut fresh, false), None);
        let partial = backup(Vec::new(), &[("a1", "me@x.com")], &[]);
        assert_eq!(super::backup_to_push_onto(Ok(Some(partial)), &mut fresh, false), None);
        assert!(!fresh.seen_backup);

        // A device that has synced before keeps pushing onto what it reads
        let b = backup(vec![owned_card("c", "a1")], &[], &[]);
        assert_eq!(super::backup_to_push_onto(Ok(Some(b.clone())), &mut synced(&[]), false), Some(b));
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
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
        assert!(err.starts_with("Failed to read your Google account"), "{}", err);
        assert!(!err.contains("127.0.0.1"), "{}", err);
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
        let (mut in_async_fn, mut offloaded) = (false, false);
        for line in source.lines().take_while(|l| l.trim() != "#[cfg(test)]") {
            let code = line.trim_start();
            if ["fn ", "pub fn ", "async fn ", "pub async fn "].iter().any(|p| code.starts_with(p)) {
                in_async_fn = code.contains("async fn ");
                offloaded = false;
            }
            offloaded |= OFFLOADERS.iter().any(|o| code.contains(o));
            if in_async_fn && !offloaded && BLOCKING_WORK.iter().any(|w| code.contains(w)) {
                offending.push(code.to_string());
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
    /// errors on every read, `downloading` one whose first download from
    /// iCloud has not finished
    #[derive(Default)]
    struct FakeBackup {
        cards: Option<Vec<Card>>,
        mappings: Option<HashMap<String, String>>,
        unreadable: bool,
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
            self.0.lock().unwrap().cards = Some(cards.to_vec());
            Ok(())
        }

        fn sync_account_mappings(&self, mappings: &HashMap<String, String>) -> Result<(), String> {
            self.0.lock().unwrap().mappings = Some(mappings.clone());
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

    fn record_at(path: std::path::PathBuf) -> super::ICloudSync {
        super::ICloudSync { store: None, record_path: Some(path) }
    }

    #[test]
    fn an_unreadable_sync_record_does_not_make_an_empty_store_look_like_a_first_push() {
        let dir = scratch_dir();
        let path = dir.join("icloud-card-sync.json");
        std::fs::write(&path, br#"{"base": {"c": {"id""#).unwrap();

        let mut record = record_at(path).load_record();
        assert!(record.seen_backup);
        assert_eq!(super::backup_to_push_onto(Ok(None), &mut record, true), None);
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
}
