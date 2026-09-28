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
    pub icloud: Arc<std::sync::Mutex<ICloudKVStore>>,
    /// Cancel flag for the in-flight OAuth flow, so a retry can release port 8420
    pub oauth_cancel: Arc<std::sync::Mutex<Option<Arc<AtomicBool>>>>,
    /// Cached access tokens per account_id; never hold this lock across an await
    pub token_cache: Arc<std::sync::Mutex<HashMap<String, (String, Instant)>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(std::sync::Mutex::new(None)),
            auth: Arc::new(Mutex::new(None)),
            icloud: Arc::new(std::sync::Mutex::new(ICloudKVStore::new())),
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

/// Get app data directory from handle
fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))
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

// Sync all cards to iCloud after any card operation
fn sync_cards_to_icloud(state: &AppState) {
    let db_guard = match state.db.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let db = match db_guard.as_ref() {
        Some(d) => d,
        None => return,
    };

    // Collect all cards from all accounts and build account mappings
    let accounts = match db.get_accounts() {
        Ok(a) => a,
        Err(_) => return,
    };

    let mut all_cards = Vec::new();
    let mut account_mappings = HashMap::new();

    for account in &accounts {
        // Build account_id -> email mapping for iCloud restore
        account_mappings.insert(account.id.clone(), account.email.clone());

        if let Ok(cards) = db.get_cards(&account.id) {
            all_cards.extend(cards);
        }
    }

    // Sync to iCloud (no-op on non-iOS)
    drop(db_guard); // Release db lock before acquiring icloud lock
    if let Ok(icloud) = state.icloud.lock() {
        let _ = icloud.sync_cards(&all_cards);
        // Keep other devices' id -> email entries so their cards can still be
        // matched to the right account when this device pulls them
        let mut merged = icloud.load_account_mappings().ok().flatten().unwrap_or_default();
        merged.extend(account_mappings);
        let _ = icloud.sync_account_mappings(&merged);
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
    let (auth_url, _csrf_token) = {
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
    let callback_result = tokio::task::spawn_blocking(move || server.wait_for_callback(120, wait_cancel))
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

/// Helper to get a valid access token for an account (refreshing if needed)
async fn get_access_token(state: &AppState, account_id: &str, app_data_dir: &std::path::Path) -> Result<String, String> {
    // Serve from cache if the token is good for at least another 60s
    {
        let cache = state.token_cache.lock().map_err(|_| "Lock error")?;
        if let Some((token, expiry)) = cache.get(account_id) {
            if expiry.saturating_duration_since(Instant::now()) > Duration::from_secs(60) {
                return Ok(token.clone());
            }
        }
    }

    // Get stored refresh token
    let refresh_token = auth::get_refresh_token(account_id, app_data_dir).map_err(|e| e.to_string())?;

    // Refresh the access token
    let (access_token, expires_in) = {
        let auth_guard = state.auth.lock().await;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    tracing::info!("fetch_threads_paginated for card: {}, page_token: {:?}", card_id, page_token);

    let (account, card) = get_account_and_card(&state, &account_id, &card_id)?;
    let access_token = get_access_token(&state, &account.id, &app_data_dir).await?;

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
    let app_data_dir = get_app_data_dir(app_handle)?;

    tracing::info!("sync_threads_incremental for account: {}", account_id);

    // Get stored history ID
    let stored_history_id = {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.get_history_id(account_id).map_err(|e| e.to_string())?
    };

    let access_token = get_access_token(state, account_id, &app_data_dir).await?;
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
                    let mut deleted_thread_ids = Vec::new();
                    for thread_id in &changes.deleted_thread_ids {
                        if gmail
                            .thread_exists(thread_id)
                            .await
                            .map_err(|e| format!("Failed to verify deleted thread {}: {}", thread_id, e))?
                        {
                            modified_thread_ids.push(thread_id.clone());
                        } else {
                            deleted_thread_ids.push(thread_id.clone());
                        }
                    }

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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;
    let from_email = get_account_email(&state, &account_id)?;
    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
        verify_account_exists(state, account_id)?;

        let app_data_dir = get_app_data_dir(app_handle)?;
        let access_token = get_access_token(state, account_id, &app_data_dir).await?;
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
    let (final_filename, bytes) = resolve_attachment_file(
        &account_id, &message_id, attachment_id, &filename,
        mime_type.as_deref(), inline_data, &app_handle, &state,
    ).await?;

    let temp_path = std::env::temp_dir().join(&final_filename);
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Open with system default application
    open::that(&temp_path).map_err(|e| format!("Failed to open file: {}", e))?;

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

    // Avoid clobbering an existing file: name.ext, name (1).ext, name (2).ext...
    let (stem, ext) = match final_filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), Some(e.to_string())),
        _ => (final_filename.clone(), None),
    };
    let mut path = download_dir.join(&final_filename);
    let mut counter = 1;
    while path.exists() {
        let candidate = match &ext {
            Some(e) => format!("{} ({}).{}", stem, counter, e),
            None => format!("{} ({})", stem, counter),
        };
        path = download_dir.join(candidate);
        counter += 1;
    }

    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_labels(
    account_id: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<GmailLabel>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    // Validate status
    let valid_statuses = ["accepted", "tentative", "declined"];
    if !valid_statuses.contains(&status.as_str()) {
        return Err(format!("Invalid status: {}. Must be one of: accepted, tentative, declined", status));
    }

    let user_email = get_account_email(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let user_email = get_account_email(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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

/// Pull cards from iCloud and merge with local. Returns true if changes were made.
#[tauri::command]
pub fn pull_from_icloud(state: State<'_, AppState>) -> Result<bool, String> {
    let (icloud_cards, account_mappings) = {
        let icloud = state.icloud.lock().map_err(|_| "Lock error")?;
        let cards = icloud.load_cards().map_err(|e| e.to_string())?;
        let mappings = icloud.load_account_mappings().map_err(|e| e.to_string())?;
        (cards, mappings)
    };

    let Some(icloud_cards) = icloud_cards else {
        return Ok(false);
    };

    if icloud_cards.is_empty() {
        return Ok(false);
    }

    // Account mappings: old_account_id -> email (from iCloud)
    let account_mappings = account_mappings.unwrap_or_default();

    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    // Get existing local accounts and cards
    let accounts = db.get_accounts().map_err(|e| e.to_string())?;
    let mut local_cards: HashMap<String, Card> = HashMap::new();
    for account in &accounts {
        let cards = db.get_cards(&account.id).map_err(|e| e.to_string())?;
        for card in cards {
            local_cards.insert(card.id.clone(), card);
        }
    }

    let mut changes_made = false;

    tracing::info!(
        "pull_from_icloud: {} iCloud cards, {} local accounts, {} account mappings",
        icloud_cards.len(),
        accounts.len(),
        account_mappings.len()
    );

    // Merge: iCloud cards that don't exist locally get inserted
    for mut card in icloud_cards {
        match icloud_card_account(&card.account_id, &account_mappings, &accounts) {
            Some(account_id) => {
                if account_id != card.account_id {
                    tracing::info!(
                        "Remapping card {} from {} to {}",
                        card.name,
                        card.account_id,
                        account_id
                    );
                    card.account_id = account_id;
                }
            }
            None => {
                tracing::warn!("Skipping card {} - no matching local account", card.name);
                continue;
            }
        }

        match local_cards.get(&card.id) {
            None => {
                db.insert_card(&card).map_err(|e| e.to_string())?;
                changes_made = true;
            }
            // Identical local copy: skip the write so a lagging iCloud
            // snapshot doesn't trigger no-op frontend refreshes
            Some(local) if *local == card => {}
            Some(_) => {
                // Update existing card with iCloud version
                db.update_card(&card).map_err(|e| e.to_string())?;
                changes_made = true;
            }
        }
    }

    Ok(changes_made)
}

// People API commands (contacts)

#[tauri::command]
pub async fn fetch_contacts(
    account_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<crate::people::Contact>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    evict_token_on_auth_error(&state, &account_id, calendar.list_calendars().await)
}

#[tauri::command]
pub async fn fetch_calendar_events(
    account_id: String,
    query: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<crate::calendar::CalendarEvent>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar
        .create_event(
            calendar_id.as_deref().unwrap_or("primary"),
            summary,
            description,
            start_time,
            end_time,
            all_day,
            location,
            attendees,
            recurrence,
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
    let calendar = crate::calendar::CalendarClient::new(access_token);

    let result = calendar
        .update_event(
            &calendar_id,
            &event_id,
            summary,
            description,
            start_time,
            end_time,
            all_day,
            location,
            attendees,
            recurrence,
        )
        .await;
    evict_token_on_auth_error(&state, &account_id, result)
}

#[tauri::command]
pub async fn suggest_replies(
    account_id: String,
    thread_id: String,
    api_key: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    if api_key.is_empty() {
        return Err("Gemini API key is required for smart replies.".to_string());
    }

    let user_email = get_account_email(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;

    // 1. Get thread details to build context
    let gmail = GmailClient::new(access_token);
    let thread = evict_token_on_auth_error(&state, &account_id, gmail.get_thread(&thread_id).await)
        .map_err(|e| format!("Failed to fetch thread: {}", e))?;

    // 2. Build email context from the last few messages with FULL bodies
    let mut context = String::new();

    // Get subject
    let subject = thread.messages.first()
        .and_then(|m| m.payload.as_ref())
        .and_then(|p| p.headers.as_ref())
        .and_then(|h| h.iter().find(|x| x.name.eq_ignore_ascii_case("Subject")))
        .map(|x| x.value.as_str())
        .unwrap_or("(No Subject)");

    context.push_str(&format!("Subject: {}\n\n", subject));

    // Take last 3 messages with full bodies
    let count = thread.messages.len();
    let skip = count.saturating_sub(3);

    for msg in thread.messages.iter().skip(skip) {
        let from = msg.payload.as_ref()
            .and_then(|p| p.headers.as_ref())
            .and_then(|h| h.iter().find(|x| x.name.eq_ignore_ascii_case("From")))
            .map(|x| x.value.as_str())
            .unwrap_or("Unknown");

        let date = msg.payload.as_ref()
            .and_then(|p| p.headers.as_ref())
            .and_then(|h| h.iter().find(|x| x.name.eq_ignore_ascii_case("Date")))
            .map(|x| x.value.as_str())
            .unwrap_or("");

        // Get full body text instead of snippet
        let body = crate::gmail::extract_body_text_from_message(msg)
            .unwrap_or_else(|| msg.snippet.clone().unwrap_or_default());

        // Truncate very long messages to avoid token limits; back off to a
        // char boundary since slicing mid-UTF-8 panics
        let body_truncated = if body.len() > 2000 {
            let mut cut = 2000;
            while !body.is_char_boundary(cut) {
                cut -= 1;
            }
            format!("{}...", &body[..cut])
        } else {
            body
        };

        context.push_str(&format!("From: {}\nDate: {}\n{}\n\n---\n\n", from, date, body_truncated));
    }

    // 3. Call Gemini API
    let gemini = GeminiClient::new(api_key);
    gemini.suggest_replies(&context, &user_email).await
}

#[cfg(test)]
mod tests {
    use super::{
        attachment_filename, icloud_card_account, is_auth_error, next_card_position,
        sanitize_attachment_filename, vanished_thread_ids,
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
