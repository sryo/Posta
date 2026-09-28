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

/// Execute a closure with database access
fn with_db<T, F>(state: &AppState, f: F) -> Result<T, String>
where
    F: FnOnce(&CacheDb) -> Result<T, String>,
{
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    f(db)
}

/// Verify that an account exists
fn verify_account_exists(state: &AppState, account_id: &str) -> Result<(), String> {
    with_db(state, |db| {
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        if accounts.iter().any(|a| a.id == account_id) {
            Ok(())
        } else {
            Err("Account not found".to_string())
        }
    })
}

/// Get email address for an account
fn get_account_email(state: &AppState, account_id: &str) -> Result<String, String> {
    with_db(state, |db| {
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        accounts
            .into_iter()
            .find(|a| a.id == account_id)
            .map(|a| a.email)
            .ok_or_else(|| "Account not found".to_string())
    })
}

/// The iCloud card backup plus this device's record of which cards it last
/// saw on both sides. Card sync is a three-way merge against that record: a
/// card missing on one side that both sides had was deleted there, while one
/// the record lacks was added there.
pub struct ICloudSync {
    store: ICloudKVStore,
    /// JSON map of card id -> owning account id; set once the app data dir is known
    base_path: Option<std::path::PathBuf>,
}

impl ICloudSync {
    fn new() -> Self {
        Self { store: ICloudKVStore::new(), base_path: None }
    }

    /// A missing or unreadable record only means deletions can't be told
    /// apart from additions, so everything on either side is kept
    fn load_base(&self) -> HashMap<String, String> {
        self.base_path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save_base(&self, base: &HashMap<String, String>) {
        let Some(path) = &self.base_path else { return };
        let result = serde_json::to_vec(base)
            .map_err(|e| e.to_string())
            .and_then(|json| std::fs::write(path, json).map_err(|e| e.to_string()));
        if let Err(e) = result {
            tracing::warn!("Failed to save iCloud card sync state: {}", e);
        }
    }
}

/// Whether the card was synced under an account this device still has. Such
/// a card missing locally was deleted here; under a since-removed account it
/// went away with the account and comes back when the account is re-added.
fn synced_here(card_id: &str, base: &HashMap<String, String>, accounts: &[Account]) -> bool {
    base.get(card_id).is_some_and(|owner| accounts.iter().any(|a| &a.id == owner))
}

/// The cards and id -> email mappings to write back to iCloud after a local
/// card change: every local card, plus iCloud cards this device did not
/// delete (another device's additions, and cards of accounts this device
/// doesn't have). Mappings are kept only for owners of those cards. None
/// without local accounts, since nothing on this device can then speak for
/// the backup.
fn icloud_snapshot(
    accounts: &[Account],
    local_cards: Vec<Card>,
    icloud_cards: Vec<Card>,
    icloud_mappings: HashMap<String, String>,
    base: &HashMap<String, String>,
) -> Option<(Vec<Card>, HashMap<String, String>)> {
    if accounts.is_empty() {
        return None;
    }

    let mut cards = local_cards;
    for card in icloud_cards {
        if cards.iter().any(|c| c.id == card.id) {
            continue;
        }
        let foreign = icloud_card_account(&card.account_id, &icloud_mappings, accounts).is_none();
        if foreign || !synced_here(&card.id, base, accounts) {
            cards.push(card);
        }
    }

    let mut mappings = icloud_mappings;
    mappings.extend(accounts.iter().map(|a| (a.id.clone(), a.email.clone())));
    let owners: std::collections::HashSet<&str> = cards.iter().map(|c| c.account_id.as_str()).collect();
    mappings.retain(|id, _| owners.contains(id.as_str()));

    Some((cards, mappings))
}

// Sync all cards to iCloud after any card operation
fn sync_cards_to_icloud(state: &AppState) {
    // Held across the local read too, so a concurrent pull can't change the
    // cards between reading them and pushing them
    let Ok(icloud) = state.icloud.lock() else { return };

    let (accounts, local_cards) = {
        let Ok(db_guard) = state.db.lock() else { return };
        let Some(db) = db_guard.as_ref() else { return };
        let Ok(accounts) = db.get_accounts() else { return };
        let mut cards = Vec::new();
        for account in &accounts {
            match db.get_cards(&account.id) {
                Ok(c) => cards.extend(c),
                // A partial list would delete the missing cards from iCloud
                Err(_) => return,
            }
        }
        (accounts, cards)
    };

    let new_base: HashMap<String, String> =
        local_cards.iter().map(|c| (c.id.clone(), c.account_id.clone())).collect();

    // Unreadable (corrupt) iCloud values are replaced by the local state
    let Some((cards, mappings)) = icloud_snapshot(
        &accounts,
        local_cards,
        icloud.store.load_cards().ok().flatten().unwrap_or_default(),
        icloud.store.load_account_mappings().ok().flatten().unwrap_or_default(),
        &icloud.load_base(),
    ) else {
        return;
    };
    match icloud.store.sync_cards(&cards) {
        Ok(()) => icloud.save_base(&new_base),
        Err(e) => tracing::warn!("iCloud card sync failed: {}", e),
    }
    if let Err(e) = icloud.store.sync_account_mappings(&mappings) {
        tracing::warn!("iCloud account mapping sync failed: {}", e);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[tauri::command]
pub fn init_app(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_dir = get_app_data_dir(&app_handle)?;

    tracing::info!("App data dir: {:?}", app_dir);

    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app dir: {}", e))?;

    let db_path = app_dir.join("posta.db");
    tracing::info!("DB path: {:?}", db_path);

    let db = CacheDb::new(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    match db.clear_stale_card_cache(24) {
        Ok(count) => {
            if count > 0 {
                tracing::info!("Cleaned up {} stale card cache entries", count);
            }
        }
        Err(e) => tracing::warn!("Failed to clean card cache: {}", e),
    }

    state.icloud.lock().map_err(|_| "Lock error")?.base_path = Some(app_dir.join("icloud-card-sync.json"));

    let mut db_guard = state.db.lock().map_err(|_| "Lock error".to_string())?;
    *db_guard = Some(db);

    tracing::info!("App initialized successfully");
    Ok(())
}

#[tauri::command]
pub async fn configure_auth(config: AuthConfig, app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    // Store credentials securely
    auth::store_oauth_credentials(&config.client_id, &config.client_secret, &app_data_dir)
        .map_err(|e| e.to_string())?;

    let auth = GmailAuth::new(config.client_id, config.client_secret);
    *state.auth.lock().await = Some(auth);
    Ok(())
}

#[tauri::command]
pub fn get_stored_credentials(app_handle: tauri::AppHandle) -> Result<Option<AuthConfig>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    match auth::get_oauth_credentials(&app_data_dir) {
        Ok(creds) => Ok(Some(AuthConfig {
            client_id: creds.client_id,
            client_secret: creds.client_secret,
        })),
        Err(auth::AuthError::NoCredentials) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
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
    // Get user info from Google API
    let user_info = get_user_info(access_token).await?;

    // Reuse the existing account id on re-login so cards keep pointing at it;
    // only mint a new UUID for genuinely new emails
    let existing = with_db(state, |db| {
        db.get_account_by_email(&user_info.email).map_err(|e| e.to_string())
    })?;
    let account = match existing {
        Some(mut account) => {
            account.picture = user_info.picture;
            account
        }
        None => Account::new(user_info.email, user_info.picture),
    };

    // Get app data directory for secure storage
    let app_data_dir = get_app_data_dir(app_handle)?;

    // Store refresh token securely
    auth::store_refresh_token(&account.id, refresh_token, &app_data_dir)
        .map_err(|e| e.to_string())?;

    // Save account to database
    with_db(state, |db| db.insert_account(&account).map_err(|e| e.to_string()))?;

    // Cache the fresh access token, replacing any stale entry for this account
    let expiry = Instant::now() + Duration::from_secs(expires_in.unwrap_or(3600));
    state
        .token_cache
        .lock()
        .map_err(|_| "Lock error")?
        .insert(account.id.clone(), (access_token.to_string(), expiry));

    Ok(account)
}

async fn get_user_info(access_token: &str) -> Result<UserInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

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
pub fn get_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, String> {
    with_db(&state, |db| db.get_accounts().map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn delete_account(account_id: String, app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    // Delete from database
    with_db(&state, |db| db.delete_account(&account_id).map_err(|e| e.to_string()))?;

    // Delete stored refresh token
    auth::delete_refresh_token(&account_id, &app_data_dir).map_err(|e| e.to_string())?;

    // Drop any cached access token for this account
    if let Ok(mut cache) = state.token_cache.lock() {
        cache.remove(&account_id);
    }

    Ok(())
}

#[tauri::command]
pub fn update_account_signature(account_id: String, signature: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state, |db| db.update_account_signature(&account_id, signature.as_deref()).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn get_cards(account_id: String, state: State<'_, AppState>) -> Result<Vec<Card>, String> {
    with_db(&state, |db| db.get_cards(&account_id).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn create_card(
    account_id: String,
    name: String,
    query: String,
    color: Option<String>,
    group_by: Option<String>,
    card_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<Card, String> {
    let card = with_db(&state, |db| {
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
    })?;

    sync_cards_to_icloud(&state);
    Ok(card)
}

#[tauri::command]
pub fn update_card(card: Card, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state, |db| db.update_card(&card).map_err(|e| e.to_string()))?;

    sync_cards_to_icloud(&state);
    Ok(())
}

#[tauri::command]
pub fn delete_card(id: String, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state, |db| db.delete_card(&id).map_err(|e| e.to_string()))?;

    sync_cards_to_icloud(&state);
    Ok(())
}

#[tauri::command]
pub fn reorder_cards(orders: Vec<(String, i32)>, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state, |db| db.reorder_cards(&orders).map_err(|e| e.to_string()))?;

    sync_cards_to_icloud(&state);
    Ok(())
}

/// Positions keep gaps after a delete, so count-based numbering can collide
fn next_card_position(cards: &[Card]) -> i32 {
    cards.iter().map(|c| c.position + 1).max().unwrap_or(0)
}

/// Helper to get account and card from database
fn get_account_and_card(
    state: &AppState,
    account_id: &str,
    card_id: &str,
) -> Result<(Account, Card), String> {
    with_db(state, |db| {
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        let account = accounts
            .into_iter()
            .find(|a| a.id == account_id)
            .ok_or("Account not found")?;

        let cards = db.get_cards(account_id).map_err(|e| e.to_string())?;
        let card = cards
            .into_iter()
            .find(|c| c.id == card_id)
            .ok_or("Card not found")?;

        Ok((account, card))
    })
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
    if let Some(token) = cached_access_token(&state.token_cache, account_id)? {
        return Ok(token);
    }

    let app_data_dir = get_app_data_dir(app_handle)?;
    let refresh_token = auth::get_refresh_token(account_id, &app_data_dir).map_err(|e| e.to_string())?;

    let (access_token, expires_in) = {
        let auth_guard = state.auth.lock().await;
        // Parallel calls queue on the auth lock; the first one refreshes and
        // the rest reuse its token instead of each refreshing again
        if let Some(token) = cached_access_token(&state.token_cache, account_id)? {
            return Ok(token);
        }
        let auth = auth_guard
            .as_ref()
            .ok_or("Auth not configured. Please configure auth first.")?;

        auth.refresh_access_token(&refresh_token)
            .await
            .map_err(|e| e.to_string())?
    };

    let expiry = Instant::now() + Duration::from_secs(expires_in.unwrap_or(3600));
    state
        .token_cache
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
    verify_account_exists(state, account_id)?;
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

    let (account, card) = get_account_and_card(&state, &account_id, &card_id)?;
    let access_token = get_access_token(&state, &app_handle, &account.id).await?;

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

    // Get stored history ID
    let stored_history_id = {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.get_history_id(account_id).map_err(|e| e.to_string())?
    };

    let access_token = get_access_token(state, app_handle, account_id).await?;
    let gmail = GmailClient::new(access_token);

    match stored_history_id {
        Some(history_id) => {
            // Incremental sync - get changes since last sync
            match gmail.get_history_changes(&history_id).await {
                Ok(changes) => {
                    tracing::info!(
                        "Incremental sync: {} modified threads, {} deletion candidates, {} deleted messages",
                        changes.modified_thread_ids.len(),
                        changes.deleted_thread_ids.len(),
                        changes.deleted_message_ids.len()
                    );

                    // Verify deletion candidates: a thread that still exists only
                    // lost some messages and must be treated as modified
                    let mut modified_thread_ids = changes.modified_thread_ids;
                    let (still_existing, mut deleted_thread_ids) =
                        gmail.split_deleted_threads(&changes.deleted_thread_ids).await?;
                    modified_thread_ids.extend(still_existing);

                    // Batch fetch the modified threads; propagate errors so the
                    // frontend keeps its current data and retries (the history ID
                    // is not advanced on failure)
                    let mut modified_threads = Vec::new();
                    if !modified_thread_ids.is_empty() {
                        modified_threads = gmail
                            .batch_get_thread_details(&modified_thread_ids)
                            .await
                            .map_err(|e| format!("Failed to fetch modified threads: {}", e))?;

                        // Set account_id on all threads
                        for thread in &mut modified_threads {
                            thread.account_id = account_id.to_string();
                        }

                        // A thread deleted between the history call and the
                        // fetch comes back missing rather than as an error
                        deleted_thread_ids.extend(vanished_thread_ids(&modified_thread_ids, &modified_threads));
                    }

                    // Update stored history ID
                    {
                        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
                        let db = db_guard.as_ref().ok_or("Database not initialized")?;
                        db.set_history_id(account_id, &changes.new_history_id)
                            .map_err(|e| e.to_string())?;
                    }

                    Ok(IncrementalSyncResult {
                        modified_threads,
                        deleted_thread_ids,
                        new_history_id: changes.new_history_id,
                        is_full_sync: false,
                    })
                }
                Err(e) if e == crate::gmail::HISTORY_EXPIRED => {
                    tracing::warn!("History ID expired, performing full sync");
                    // Clear the stale history ID and do full sync
                    {
                        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
                        let db = db_guard.as_ref().ok_or("Database not initialized")?;
                        db.clear_history_id(account_id).map_err(|e| e.to_string())?;
                    }
                    perform_full_sync(&gmail, account_id, state).await
                }
                Err(e) => Err(e),
            }
        }
        None => {
            // No history ID stored - this is the first sync
            tracing::info!("No history ID found, performing initial full sync");
            perform_full_sync(&gmail, account_id, state).await
        }
    }
}

/// Perform a full sync and establish history ID for future incremental syncs
async fn perform_full_sync(
    gmail: &GmailClient,
    account_id: &str,
    state: &State<'_, AppState>,
) -> Result<IncrementalSyncResult, String> {
    // Get current history ID for future syncs
    let history_id = gmail
        .get_current_history_id()
        .await
        .map_err(|e| format!("Failed to get history ID: {}", e))?;

    // Store the history ID
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.set_history_id(account_id, &history_id)
            .map_err(|e| e.to_string())?;
    }

    // Return empty result - frontend should do its normal fetch
    // This avoids duplicating the card-specific query logic here
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
    let gmail = std::sync::Arc::new(GmailClient::new(access_token));

    // Process in parallel for better performance
    let futures: Vec<_> = thread_ids
        .into_iter()
        .map(|thread_id| {
            let gmail = gmail.clone();
            let add = add_labels.clone();
            let remove = remove_labels.clone();
            async move {
                gmail
                    .modify_thread(&thread_id, add, remove)
                    .await
                    .map_err(|e| format!("Failed to modify thread {}: {}", thread_id, e))
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    // Return first error if any
    for result in results {
        evict_token_on_auth_error(&state, &account_id, result)?;
    }

    Ok(())
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
    let from_email = get_account_email(&state, &account_id)?;
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
pub fn get_cached_card_threads(
    card_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CachedCardThreads>, String> {
    with_db(&state, |db| {
        match db.get_card_threads(&card_id) {
            Ok(Some((groups, next_page_token, cached_at))) => Ok(Some(CachedCardThreads {
                groups,
                next_page_token,
                cached_at,
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
}

#[tauri::command]
pub fn save_cached_card_threads(
    card_id: String,
    groups: Vec<ThreadGroup>,
    next_page_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    with_db(&state, |db| {
        db.save_card_threads(&card_id, &groups, next_page_token.as_deref())
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn clear_card_cache(card_id: String, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state, |db| db.clear_card_cache(&card_id).map_err(|e| e.to_string()))
}

#[derive(Debug, Serialize)]
pub struct CachedCardEvents {
    pub events: Vec<crate::models::GoogleCalendarEvent>,
    pub cached_at: i64,
}

#[tauri::command]
pub fn get_cached_card_events(
    card_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CachedCardEvents>, String> {
    with_db(&state, |db| {
        match db.get_card_events(&card_id) {
            Ok(Some((events, cached_at))) => Ok(Some(CachedCardEvents {
                events,
                cached_at,
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
}

#[tauri::command]
pub fn save_cached_card_events(
    card_id: String,
    events: Vec<crate::models::GoogleCalendarEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    with_db(&state, |db| {
        db.save_card_events(&card_id, &events)
            .map_err(|e| e.to_string())
    })
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
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let temp_path = write_unique_file(&dir, &final_filename, &bytes, true)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    mark_quarantined(&temp_path);

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

    let path = write_unique_file(&download_dir, &final_filename, &bytes, false)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    mark_quarantined(&path);

    Ok(path.to_string_lossy().to_string())
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
    // Validate status
    let valid_statuses = ["accepted", "tentative", "declined"];
    if !valid_statuses.contains(&status.as_str()) {
        return Err(format!("Invalid status: {}. Must be one of: accepted, tentative, declined", status));
    }

    let user_email = get_account_email(&state, &account_id)?;

    let access_token = get_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar.rsvp_calendar_event(&user_email, &event_uid, &status).await;
    evict_token_on_auth_error(&state, &account_id, result)
}

#[tauri::command]
pub async fn get_calendar_rsvp_status(
    account_id: String,
    event_uid: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let user_email = get_account_email(&state, &account_id)?;

    let access_token = get_access_token(&state, &app_handle, &account_id).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    Ok(calendar.get_calendar_event_status(&user_email, &event_uid).await)
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
    /// Sync record after the writes: local cards that are also in iCloud
    base: HashMap<String, String>,
}

/// Three-way merge of the iCloud cards into the local ones, against `base`
/// (see `ICloudSync`). Cards of accounts this device doesn't have are left
/// alone, and cards only this device has, never synced, are kept.
fn merge_icloud_cards(
    accounts: &[Account],
    local_cards: &[Card],
    icloud_cards: Vec<Card>,
    mappings: &HashMap<String, String>,
    base: &HashMap<String, String>,
) -> CardMerge {
    let mut merge = CardMerge::default();
    let icloud_ids: std::collections::HashSet<String> = icloud_cards.iter().map(|c| c.id.clone()).collect();

    for mut card in icloud_cards {
        let Some(account_id) = icloud_card_account(&card.account_id, mappings, accounts) else {
            tracing::warn!("Skipping card {} - no matching local account", card.name);
            continue;
        };
        card.account_id = account_id;

        match local_cards.iter().find(|c| c.id == card.id) {
            None if synced_here(&card.id, base, accounts) => continue,
            None => {
                merge.base.insert(card.id.clone(), card.account_id.clone());
                merge.insert.push(card);
            }
            Some(local) => {
                merge.base.insert(card.id.clone(), local.account_id.clone());
                // An identical local copy is not rewritten, so a lagging
                // iCloud snapshot doesn't trigger no-op frontend refreshes
                if *local != card {
                    merge.update.push(card);
                }
            }
        }
    }

    for card in local_cards {
        if !icloud_ids.contains(&card.id) && base.contains_key(&card.id) {
            merge.delete.push(card.id.clone());
        }
    }

    merge
}

/// Pull cards from iCloud and merge with local. Returns true if changes were made.
#[tauri::command]
pub fn pull_from_icloud(state: State<'_, AppState>) -> Result<bool, String> {
    // Held for the whole merge so a local card change can't push in between
    let icloud = state.icloud.lock().map_err(|_| "Lock error")?;

    let Some(icloud_cards) = icloud.store.load_cards().map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    // Account mappings: old_account_id -> email (from iCloud)
    let account_mappings = icloud
        .store
        .load_account_mappings()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let accounts = db.get_accounts().map_err(|e| e.to_string())?;
    let mut local_cards = Vec::new();
    for account in &accounts {
        local_cards.extend(db.get_cards(&account.id).map_err(|e| e.to_string())?);
    }

    tracing::info!(
        "pull_from_icloud: {} iCloud cards, {} local accounts, {} account mappings",
        icloud_cards.len(),
        accounts.len(),
        account_mappings.len()
    );

    let merge = merge_icloud_cards(&accounts, &local_cards, icloud_cards, &account_mappings, &icloud.load_base());
    for card in &merge.insert {
        db.insert_card(card).map_err(|e| e.to_string())?;
    }
    for card in &merge.update {
        db.update_card(card).map_err(|e| e.to_string())?;
    }
    for id in &merge.delete {
        tracing::info!("Deleting card {} - deleted on another device", id);
        db.delete_card(id).map_err(|e| e.to_string())?;
    }
    icloud.save_base(&merge.base);

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
pub fn set_gemini_api_key(api_key: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    auth::store_gemini_api_key(&api_key, &app_data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_gemini_api_key(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    Ok(auth::get_gemini_api_key(&app_data_dir).is_some())
}

#[tauri::command]
pub async fn suggest_replies(
    account_id: String,
    thread_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    let api_key = auth::get_gemini_api_key(&app_data_dir)
        .ok_or_else(|| "Gemini API key is required for smart replies.".to_string())?;

    let user_email = get_account_email(&state, &account_id)?;

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
        attachment_filename, attachment_temp_dir, cached_access_token, icloud_card_account, icloud_snapshot, is_auth_error,
        is_executable_attachment, mark_quarantined, merge_icloud_cards, next_card_position, refuse_executable_attachment,
        reply_context, sanitize_attachment_filename, vanished_thread_ids, write_unique_file,
    };
    use crate::models::{Account, Card, Thread};
    use std::collections::HashMap;

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

    fn base(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        mappings(pairs)
    }

    fn ids(cards: &[Card]) -> Vec<&str> {
        cards.iter().map(|c| c.id.as_str()).collect()
    }

    #[test]
    fn icloud_snapshot_is_skipped_without_local_accounts() {
        let backup = vec![owned_card("c1", "gone")];
        let m = mappings(&[("gone", "me@x.com")]);
        assert!(icloud_snapshot(&[], Vec::new(), backup, m, &base(&[])).is_none());
    }

    #[test]
    fn icloud_snapshot_keeps_cards_of_accounts_this_device_lacks() {
        let accounts = [account("a1", "me@x.com")];
        let local = vec![owned_card("mine", "a1")];
        let backup = vec![
            owned_card("mine", "a1"),
            owned_card("deleted-here", "a1"),
            owned_card("work", "w9"),
        ];
        let m = mappings(&[("w9", "work@x.com")]);
        let synced = base(&[("mine", "a1"), ("deleted-here", "a1")]);
        let (cards, new_mappings) = icloud_snapshot(&accounts, local, backup, m, &synced).unwrap();
        assert_eq!(ids(&cards), vec!["mine", "work"]);
        assert_eq!(new_mappings, mappings(&[("a1", "me@x.com"), ("w9", "work@x.com")]));
    }

    #[test]
    fn icloud_snapshot_keeps_cards_added_elsewhere_that_were_not_pulled_yet() {
        // Another device added "theirs" to a shared account; a local change
        // made before pulling it must not wipe it from the backup
        let accounts = [account("a1", "me@x.com")];
        let local = vec![owned_card("mine", "a1")];
        let backup = vec![owned_card("mine", "a1"), owned_card("theirs", "a1")];
        let synced = base(&[("mine", "a1")]);
        let (cards, _) = icloud_snapshot(&accounts, local, backup, mappings(&[]), &synced).unwrap();
        assert_eq!(ids(&cards), vec!["mine", "theirs"]);
    }

    #[test]
    fn icloud_snapshot_drops_mappings_no_card_uses() {
        let accounts = [account("a1", "me@x.com"), account("a2", "other@x.com")];
        let local = vec![owned_card("mine", "a1")];
        let m = mappings(&[("stale", "old@x.com"), ("a1-old", "me@x.com")]);
        let (_, new_mappings) = icloud_snapshot(&accounts, local, Vec::new(), m, &base(&[])).unwrap();
        assert_eq!(new_mappings, mappings(&[("a1", "me@x.com")]));
    }

    #[test]
    fn pull_deletes_local_cards_that_another_device_deleted() {
        let accounts = [account("a1", "me@x.com")];
        let local = vec![owned_card("keep", "a1"), owned_card("gone", "a1"), owned_card("new-here", "a1")];
        let icloud = vec![owned_card("keep", "a1")];
        let synced = base(&[("keep", "a1"), ("gone", "a1")]);
        let merge = merge_icloud_cards(&accounts, &local, icloud, &mappings(&[]), &synced);
        assert_eq!(merge.delete, vec!["gone".to_string()]);
        assert!(merge.insert.is_empty() && merge.update.is_empty());
        // "new-here" was never synced, so it stays and is not in the new base
        assert_eq!(merge.base, base(&[("keep", "a1")]));
    }

    #[test]
    fn pull_does_not_resurrect_a_card_deleted_here() {
        let accounts = [account("a1", "me@x.com")];
        let icloud = vec![owned_card("deleted-here", "a1"), owned_card("added-there", "a1")];
        let synced = base(&[("deleted-here", "a1")]);
        let merge = merge_icloud_cards(&accounts, &[], icloud, &mappings(&[]), &synced);
        assert_eq!(ids(&merge.insert), vec!["added-there"]);
        assert!(merge.delete.is_empty());
        assert_eq!(merge.base, base(&[("added-there", "a1")]));
    }

    #[test]
    fn pull_restores_cards_of_a_signed_out_account_on_sign_in() {
        // c1 was synced under a1-old; the account was then removed and signed
        // in again under a new id, and its layout must come back
        let accounts = [account("a1-new", "me@x.com")];
        let icloud = vec![owned_card("c1", "a1-old")];
        let m = mappings(&[("a1-old", "me@x.com")]);
        let synced = base(&[("c1", "a1-old")]);
        let merge = merge_icloud_cards(&accounts, &[], icloud, &m, &synced);
        assert_eq!(ids(&merge.insert), vec!["c1"]);
        assert_eq!(merge.insert[0].account_id, "a1-new");
        assert_eq!(merge.base, base(&[("c1", "a1-new")]));
    }

    #[test]
    fn pull_updates_only_cards_that_changed() {
        let accounts = [account("a1", "me@x.com")];
        let local = vec![owned_card("same", "a1"), owned_card("renamed", "a1")];
        let mut renamed = owned_card("renamed", "a1");
        renamed.name = "New name".into();
        let icloud = vec![owned_card("same", "a1"), renamed.clone()];
        let merge = merge_icloud_cards(&accounts, &local, icloud, &mappings(&[]), &base(&[]));
        assert_eq!(merge.update, vec![renamed]);
        assert!(merge.insert.is_empty() && merge.delete.is_empty());
        assert_eq!(merge.base, base(&[("same", "a1"), ("renamed", "a1")]));
    }

    #[test]
    fn pull_leaves_cards_of_accounts_this_device_lacks_alone() {
        let accounts = [account("a1", "me@x.com"), account("a2", "b@x.com")];
        let icloud = vec![owned_card("work", "w9")];
        let m = mappings(&[("w9", "work@x.com")]);
        let merge = merge_icloud_cards(&accounts, &[], icloud, &m, &base(&[]));
        assert!(merge.insert.is_empty() && merge.update.is_empty() && merge.delete.is_empty());
        assert!(merge.base.is_empty());
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
