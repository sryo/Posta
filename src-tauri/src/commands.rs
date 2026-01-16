// Tauri command handlers

use crate::auth::{self, wait_for_callback, GmailAuth};
use crate::ai::GeminiClient;
use crate::cache::CacheDb;
use crate::gmail::{GmailClient, GmailDraft, GmailLabel, SearchResult};
use crate::icloud::ICloudKVStore;
use crate::models::{Account, Card, SendAttachment, ThreadGroup};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Manager, State};

use tokio::sync::Mutex;

pub struct AppState {
    pub db: Arc<std::sync::Mutex<Option<CacheDb>>>,
    pub auth: Arc<Mutex<Option<GmailAuth>>>,
    pub icloud: Arc<std::sync::Mutex<ICloudKVStore>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(std::sync::Mutex::new(None)),
            auth: Arc::new(Mutex::new(None)),
            icloud: Arc::new(std::sync::Mutex::new(ICloudKVStore::new())),
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
    let mut account_mappings = std::collections::HashMap::new();

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
        let _ = icloud.sync_account_mappings(&account_mappings);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Serialize)]
pub struct AuthUrl {
    pub url: String,
    pub state: String,
}

#[tauri::command]
pub fn init_app(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_dir = get_app_data_dir(&app_handle)?;

    tracing::info!("App data dir: {:?}", app_dir);

    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app dir: {}", e))?;

    let db_path = app_dir.join("posta.db");
    tracing::info!("DB path: {:?}", db_path);

    let db = CacheDb::new(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    // Clean up stale cache on startup (24 hour expiry for non-priority items)
    match db.clear_old_cache(24) {
        Ok(count) => {
            if count > 0 {
                tracing::info!("Cleaned up {} stale thread cache entries", count);
            }
        }
        Err(e) => tracing::warn!("Failed to clean thread cache: {}", e),
    }
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

#[derive(Debug, Serialize)]
pub struct StoredCredentials {
    pub client_id: String,
    pub client_secret: String,
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

#[tauri::command]
pub async fn start_oauth_flow(state: State<'_, AppState>) -> Result<AuthUrl, String> {
    let auth_guard = state.auth.lock().await;
    let auth = auth_guard
        .as_ref()
        .ok_or("Auth not configured. Call configure_auth first.")?;

    let (url, csrf_token) = auth
        .start_auth_flow()
        .await
        .map_err(|e| e.to_string())?;

    Ok(AuthUrl {
        url,
        state: csrf_token,
    })
}

#[tauri::command]
pub async fn complete_oauth_flow(
    code: String,
    received_state: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Account, String> {
    // Exchange code for tokens, verifying state to prevent CSRF
    let (access_token, refresh_token) = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard.as_ref().ok_or("Auth not configured")?;
        auth.exchange_code(code, received_state.as_deref())
            .await
            .map_err(|e| e.to_string())?
    };

    finalize_oauth(&access_token, &refresh_token, &app_handle, &state).await
}



/// Full OAuth flow: opens browser, waits for callback, exchanges code
#[tauri::command]
pub async fn run_oauth_flow(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Account, String> {
    let _app_data_dir = get_app_data_dir(&app_handle)?;

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
    let callback_result = tokio::task::spawn_blocking(move || wait_for_callback(120))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("OAuth callback error: {}", e))?;

    // Exchange code for tokens
    let (access_token, refresh_token) = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard.as_ref().ok_or("Auth not configured")?;
        auth.exchange_code(callback_result.code, callback_result.state.as_deref())
            .await
            .map_err(|e| e.to_string())?
    };

    // Finalize the OAuth flow and return account
    finalize_oauth(&access_token, &refresh_token, &app_handle, &state).await
}

struct UserInfo {
    email: String,
    picture: Option<String>,
}

/// Finalize OAuth by creating account and storing tokens
async fn finalize_oauth(
    access_token: &str,
    refresh_token: &str,
    app_handle: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<Account, String> {
    // Get user info from Google API
    let user_info = get_user_info(access_token).await?;

    // Create account
    let account = Account::new(user_info.email, user_info.picture);

    // Get app data directory for secure storage
    let app_data_dir = get_app_data_dir(&app_handle)?;

    // Store refresh token securely
    auth::store_refresh_token(&account.id, refresh_token, &app_data_dir)
        .map_err(|e| e.to_string())?;

    // Save account to database
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.insert_account(&account).map_err(|e| e.to_string())?;
    }

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
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    db.get_accounts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(account_id: String, app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    // Delete from database
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.delete_account(&account_id).map_err(|e| e.to_string())?;
    }

    // Delete stored refresh token
    auth::delete_refresh_token(&account_id, &app_data_dir).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_account_signature(account_id: String, signature: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    db.update_account_signature(&account_id, signature.as_deref()).map_err(|e| e.to_string())
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
    let card = {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;

        let cards = db.get_cards(&account_id).map_err(|e| e.to_string())?;
        let position = cards.len() as i32;

        let card_type_value = card_type.unwrap_or_else(|| "email".to_string());
        let mut card = if card_type_value == "calendar" {
            Card::new_calendar(account_id, name, query, position)
        } else {
            Card::new(account_id, name, query, position)
        };
        card.color = color;
        card.group_by = group_by.unwrap_or_else(|| "date".to_string());
        db.insert_card(&card).map_err(|e| e.to_string())?;
        card
    };

    sync_cards_to_icloud(&state);
    Ok(card)
}

#[tauri::command]
pub fn update_card(card: Card, state: State<'_, AppState>) -> Result<(), String> {
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.update_card(&card).map_err(|e| e.to_string())?;
    }

    sync_cards_to_icloud(&state);
    Ok(())
}

#[tauri::command]
pub fn delete_card(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.delete_card(&id).map_err(|e| e.to_string())?;
    }

    sync_cards_to_icloud(&state);
    Ok(())
}

#[tauri::command]
pub fn reorder_cards(orders: Vec<(String, i32)>, state: State<'_, AppState>) -> Result<(), String> {
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.reorder_cards(&orders).map_err(|e| e.to_string())?;
    }

    sync_cards_to_icloud(&state);
    Ok(())
}

/// Helper to get account and card from database
fn get_account_and_card(
    state: &AppState,
    account_id: &str,
    card_id: &str,
) -> Result<(Account, Card), String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

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
}

/// Helper to get a valid access token for an account (refreshing if needed)
async fn get_access_token(state: &AppState, account_id: &str, app_data_dir: &std::path::Path) -> Result<String, String> {
    // Get stored refresh token
    let refresh_token = auth::get_refresh_token(account_id, app_data_dir).map_err(|e| e.to_string())?;

    // Get auth instance
    let auth_guard = state.auth.lock().await;
    let auth = auth_guard
        .as_ref()
        .ok_or("Auth not configured. Please configure auth first.")?;

    // Refresh the access token
    auth.refresh_access_token(&refresh_token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_threads(
    account_id: String,
    card_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ThreadGroup>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    let (account, card) = get_account_and_card(&state, &account_id, &card_id)?;
    let access_token = get_access_token(&state, &account.id, &app_data_dir).await?;

    let client = GmailClient::new(access_token);
    let threads = client
        .search_threads(&card.query)
        .await
        .map_err(|e| format!("Search failed: {}", e))?;

    Ok(threads)
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
    let result = gmail
        .search_threads_paginated(&card.query, page_token.as_deref())
        .await
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    tracing::info!("sync_threads_incremental for account: {}", account_id);

    // Get stored history ID
    let stored_history_id = {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        db.get_history_id(&account_id).map_err(|e| e.to_string())?
    };

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
    let gmail = GmailClient::new(access_token);

    match stored_history_id {
        Some(history_id) => {
            // Incremental sync - get changes since last sync
            match gmail.get_history_changes(&history_id).await {
                Ok(changes) => {
                    tracing::info!(
                        "Incremental sync: {} modified threads, {} deleted messages",
                        changes.modified_thread_ids.len(),
                        changes.deleted_message_ids.len()
                    );

                    // Batch fetch the modified threads
                    let mut modified_threads = Vec::new();
                    if !changes.modified_thread_ids.is_empty() {
                        modified_threads = gmail
                            .batch_get_thread_details(&changes.modified_thread_ids)
                            .await
                            .unwrap_or_default();

                        // Set account_id on all threads
                        for thread in &mut modified_threads {
                            thread.account_id = account_id.clone();
                        }
                    }

                    // Update stored history ID
                    {
                        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
                        let db = db_guard.as_ref().ok_or("Database not initialized")?;
                        db.set_history_id(&account_id, &changes.new_history_id)
                            .map_err(|e| e.to_string())?;
                    }

                    Ok(IncrementalSyncResult {
                        modified_threads,
                        deleted_thread_ids: changes.modified_thread_ids, // Thread IDs that had messages deleted
                        new_history_id: changes.new_history_id,
                        is_full_sync: false,
                    })
                }
                Err(e) if e.contains("expired") => {
                    tracing::warn!("History ID expired, performing full sync");
                    // Clear the stale history ID and do full sync
                    {
                        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
                        let db = db_guard.as_ref().ok_or("Database not initialized")?;
                        db.clear_history_id(&account_id).map_err(|e| e.to_string())?;
                    }
                    perform_full_sync(&gmail, &account_id, &state).await
                }
                Err(e) => Err(e),
            }
        }
        None => {
            // No history ID stored - this is the first sync
            tracing::info!("No history ID found, performing initial full sync");
            perform_full_sync(&gmail, &account_id, &state).await
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
        result?;
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
    gmail
        .search_threads_limited(&query, 5)
        .await
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

    gmail.get_thread(&thread_id).await
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

    gmail.send_email(&to, &cc, &bcc, &subject, &body, &attachments, is_html.unwrap_or(false)).await
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

    gmail.reply_to_thread(&thread_id, &to, &cc, &bcc, &subject, &body, message_id.as_deref(), &attachments, is_html.unwrap_or(false)).await
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

    gmail.send_reaction(&thread_id, &message_id, &emoji, &from_email, &to_email).await
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

    gmail.get_attachment(&message_id, &attachment_id).await
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
    let app_data_dir = get_app_data_dir(&app_handle)?;

    // Get base64 data either from inline or by downloading
    let base64_data = if let Some(data) = inline_data {
        data
    } else {
        let attachment_id = attachment_id.ok_or("No attachment ID or inline data")?;
        verify_account_exists(&state, &account_id)?;

        let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
        let gmail = GmailClient::new(access_token);
        gmail.get_attachment(&message_id, &attachment_id).await?
    };

    // Decode base64 - Gmail uses URL-safe encoding, handle with/without padding
    let cleaned = base64_data.trim_end_matches('=');
    let bytes = URL_SAFE_NO_PAD
        .decode(cleaned)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Ensure filename has extension based on mime type
    let final_filename = if !filename.contains('.') {
        if let Some(ref mt) = mime_type {
            if let Some(ext) = get_extension_for_mime(mt) {
                format!("{}.{}", filename, ext)
            } else {
                filename.clone()
            }
        } else {
            filename.clone()
        }
    } else {
        filename.clone()
    };

    // Save to temp file
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(&final_filename);
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Open with system default application
    open::that(&temp_path).map_err(|e| format!("Failed to open file: {}", e))?;

    Ok(())
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

    gmail.list_labels().await
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

    match draft_id {
        Some(id) => {
            gmail
                .update_draft(&id, &to, &cc, &bcc, &subject, &body, thread_id.as_deref(), false)
                .await
        }
        None => {
            gmail
                .create_draft(&to, &cc, &bcc, &subject, &body, thread_id.as_deref(), false)
                .await
        }
    }
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

    gmail.delete_draft(&draft_id).await
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
    let gmail = GmailClient::new(access_token);

    crate::gmail::rsvp_calendar_event(&gmail, &user_email, &event_uid, &status).await
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
    let gmail = GmailClient::new(access_token);

    Ok(crate::gmail::get_calendar_event_status(&gmail, &user_email, &event_uid).await)
}

// iCloud sync commands

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
    let mut local_card_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for account in &accounts {
        let cards = db.get_cards(&account.id).map_err(|e| e.to_string())?;
        for card in cards {
            local_card_ids.insert(card.id.clone());
        }
    }

    // Build local account lookup by ID and by email
    let local_account_ids: std::collections::HashSet<String> =
        accounts.iter().map(|a| a.id.clone()).collect();
    let local_account_by_email: std::collections::HashMap<String, &crate::models::Account> =
        accounts.iter().map(|a| (a.email.to_lowercase(), a)).collect();

    let mut changes_made = false;

    tracing::info!(
        "pull_from_icloud: {} iCloud cards, {} local accounts, {} account mappings",
        icloud_cards.len(),
        accounts.len(),
        account_mappings.len()
    );

    // Merge: iCloud cards that don't exist locally get inserted
    for mut card in icloud_cards {
        // Check if this card's account exists locally
        if !local_account_ids.contains(&card.account_id) {
            let mut remapped = false;

            // Try to match by email mapping first
            if let Some(old_email) = account_mappings.get(&card.account_id) {
                if let Some(local_account) = local_account_by_email.get(&old_email.to_lowercase()) {
                    tracing::info!(
                        "Remapping card {} from {} to {} via email {}",
                        card.name,
                        card.account_id,
                        local_account.id,
                        old_email
                    );
                    card.account_id = local_account.id.clone();
                    remapped = true;
                }
            }

            // Fallback: If there is exactly one local account, assign orphaned cards to it
            if !remapped {
                if accounts.len() == 1 {
                    tracing::info!(
                        "Remapping orphaned card {} to single account {}",
                        card.name,
                        accounts[0].id
                    );
                    card.account_id = accounts[0].id.clone();
                    remapped = true;
                } else {
                    tracing::warn!(
                        "Skipping card {} - no matching account (have {} accounts)",
                        card.name,
                        accounts.len()
                    );
                    continue;
                }
            }
        }

        if !local_card_ids.contains(&card.id) {
            db.insert_card(&card).map_err(|e| e.to_string())?;
            changes_made = true;
        } else {
            // Update existing card with iCloud version
            db.update_card(&card).map_err(|e| e.to_string())?;
            changes_made = true;
        }
    }

    Ok(changes_made)
}

/// Force sync all cards to iCloud
#[tauri::command]
pub fn force_icloud_sync(state: State<'_, AppState>) -> Result<(), String> {
    sync_cards_to_icloud(&state);
    Ok(())
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
    people.fetch_all_contacts(200).await
}

#[tauri::command]
pub async fn search_contacts(
    account_id: String,
    query: String,
    app_handle: tauri::AppHandle, state: State<'_, AppState>,
) -> Result<Vec<crate::people::Contact>, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;

    verify_account_exists(&state, &account_id)?;

    let access_token = get_access_token(&state, &account_id, &app_data_dir).await?;
    let people = crate::people::PeopleClient::new(access_token);

    people.search_contacts(&query).await
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

    calendar.list_calendars().await
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
    calendar.search_events(&parsed_query, 50).await
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

    calendar
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
        .await
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

    calendar
        .move_event(&source_calendar_id, &event_id, &destination_calendar_id)
        .await
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

    calendar.delete_event(&calendar_id, &event_id).await
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

    calendar
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
        .await
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
    let gmail = GmailClient::new(access_token.clone());
    let thread = gmail
        .get_thread(&thread_id)
        .await
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

        // Truncate very long messages to avoid token limits
        let body_truncated = if body.len() > 2000 {
            format!("{}...", &body[..2000])
        } else {
            body
        };

        context.push_str(&format!("From: {}\nDate: {}\n{}\n\n---\n\n", from, date, body_truncated));
    }

    // 3. Call Gemini API
    let gemini = GeminiClient::new(api_key);
    gemini.suggest_replies(&context, &user_email).await
}
