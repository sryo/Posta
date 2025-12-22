// Tauri command handlers

use crate::auth::{self, wait_for_callback, GmailAuth};
use crate::cache::CacheDb;
use crate::gmail::{GmailClient, GmailLabel, SearchResult};
use crate::models::{Account, Card, SendAttachment, ThreadGroup};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::Mutex;

pub struct AppState {
    pub db: Arc<std::sync::Mutex<Option<CacheDb>>>,
    pub auth: Arc<Mutex<Option<GmailAuth>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(std::sync::Mutex::new(None)),
            auth: Arc::new(Mutex::new(None)),
        }
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
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    tracing::info!("App data dir: {:?}", app_dir);

    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app dir: {}", e))?;

    let db_path = app_dir.join("posta.db");
    tracing::info!("DB path: {:?}", db_path);

    let db = CacheDb::new(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    let mut db_guard = state.db.lock().map_err(|_| "Lock error".to_string())?;
    *db_guard = Some(db);

    tracing::info!("App initialized successfully");
    Ok(())
}

#[tauri::command]
pub async fn configure_auth(config: AuthConfig, state: State<'_, AppState>) -> Result<(), String> {
    // Store credentials securely
    auth::store_oauth_credentials(&config.client_id, &config.client_secret)
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
pub fn get_stored_credentials() -> Result<Option<StoredCredentials>, String> {
    match auth::get_oauth_credentials() {
        Ok(creds) => Ok(Some(StoredCredentials {
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
    state: State<'_, AppState>,
) -> Result<Account, String> {
    // Exchange code for tokens
    let (access_token, refresh_token) = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard.as_ref().ok_or("Auth not configured")?;
        auth.exchange_code(code).await.map_err(|e| e.to_string())?
    };

    finalize_oauth(&access_token, &refresh_token, &state).await
}

/// Full OAuth flow: opens browser, waits for callback, exchanges code
#[tauri::command]
pub async fn run_oauth_flow(state: State<'_, AppState>) -> Result<Account, String> {
    // Start OAuth flow to get the auth URL
    let auth_url = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard
            .as_ref()
            .ok_or("Auth not configured. Call configure_auth first.")?;

        let (url, _csrf_token) = auth
            .start_auth_flow()
            .await
            .map_err(|e| e.to_string())?;
        url
    };

    // Open the browser
    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {}", e))?;

    // Wait for callback in a blocking thread
    let code = tokio::task::spawn_blocking(move || wait_for_callback(120))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("OAuth callback error: {}", e))?;

    // Exchange code for tokens
    let (access_token, refresh_token) = {
        let auth_guard = state.auth.lock().await;
        let auth = auth_guard.as_ref().ok_or("Auth not configured")?;
        auth.exchange_code(code).await.map_err(|e| e.to_string())?
    };

    finalize_oauth(&access_token, &refresh_token, &state).await
}

struct UserInfo {
    email: String,
    picture: Option<String>,
}

/// Finalize OAuth by creating account and storing tokens
async fn finalize_oauth(
    access_token: &str,
    refresh_token: &str,
    state: &State<'_, AppState>,
) -> Result<Account, String> {
    // Get user info from Google API
    let user_info = get_user_info(access_token).await?;

    // Create account
    let account = Account::new(user_info.email, user_info.picture);

    // Store refresh token securely
    auth::store_refresh_token(&account.id, refresh_token).map_err(|e| e.to_string())?;

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
pub fn delete_account(id: String, state: State<'_, AppState>) -> Result<(), String> {
    // Delete from keychain
    let _ = auth::delete_refresh_token(&id);

    // Delete from database
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    db.delete_account(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cards(account_id: String, state: State<'_, AppState>) -> Result<Vec<Card>, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    db.get_cards(&account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_card(
    account_id: String,
    name: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Card, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let cards = db.get_cards(&account_id).map_err(|e| e.to_string())?;
    let position = cards.len() as i32;

    let card = Card::new(account_id, name, query, position);
    db.insert_card(&card).map_err(|e| e.to_string())?;

    Ok(card)
}

#[tauri::command]
pub fn update_card(card: Card, state: State<'_, AppState>) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    db.update_card(&card).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_card(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    db.delete_card(&id).map_err(|e| e.to_string())
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

/// Helper to get a fresh access token for an account
async fn get_access_token(state: &AppState, account_id: &str) -> Result<String, String> {
    let refresh_token =
        auth::get_refresh_token(account_id).map_err(|e| format!("No auth token: {}", e))?;

    let auth_guard = state.auth.lock().await;
    let auth = auth_guard
        .as_ref()
        .ok_or("Auth not configured. Please reconnect your account.")?;
    auth.refresh_access_token(&refresh_token)
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))
}

#[tauri::command]
pub async fn fetch_threads(
    account_id: String,
    card_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ThreadGroup>, String> {
    let (account, card) = get_account_and_card(&state, &account_id, &card_id)?;
    let access_token = get_access_token(&state, &account.id).await?;

    let gmail = GmailClient::new(access_token);
    gmail
        .search_threads(&card.query)
        .await
        .map_err(|e| format!("Search failed: {}", e))
}

#[tauri::command]
pub async fn fetch_threads_paginated(
    account_id: String,
    card_id: String,
    page_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    tracing::info!("fetch_threads_paginated for card: {}, page_token: {:?}", card_id, page_token);

    let (account, card) = get_account_and_card(&state, &account_id, &card_id)?;
    let access_token = get_access_token(&state, &account.id).await?;

    let gmail = GmailClient::new(access_token);
    let result = gmail
        .search_threads_paginated(&card.query, page_token.as_deref())
        .await
        .map_err(|e| format!("Search failed: {}", e))?;

    tracing::info!("Found {} groups, has_more: {}", result.groups.len(), result.has_more);

    Ok(result)
}

#[tauri::command]
pub async fn modify_threads(
    account_id: String,
    thread_ids: Vec<String>,
    add_labels: Vec<String>,
    remove_labels: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        
        if !accounts.iter().any(|a| a.id == account_id) {
             return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;

    let gmail = GmailClient::new(access_token);
    
    // Process sequentially for now. Parallelizing would be better but requires more boilerplate.
    for thread_id in thread_ids {
        gmail
            .modify_thread(&thread_id, add_labels.clone(), remove_labels.clone())
            .await
            .map_err(|e| format!("Failed to modify thread {}: {}", thread_id, e))?;
    }

    Ok(())
}

/// Search threads by query (for preview, limited results)
#[tauri::command]
pub async fn search_threads_preview(
    account_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<ThreadGroup>, String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;

        if !accounts.iter().any(|a| a.id == account_id) {
             return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;
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
    state: State<'_, AppState>,
) -> Result<crate::gmail::FullThread, String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;
        
        if !accounts.iter().any(|a| a.id == account_id) {
             return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;
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
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;

        if !accounts.iter().any(|a| a.id == account_id) {
             return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    gmail.send_email(&to, &cc, &bcc, &subject, &body, &attachments).await
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
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;

        if !accounts.iter().any(|a| a.id == account_id) {
             return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    gmail.reply_to_thread(&thread_id, &to, &cc, &bcc, &subject, &body, message_id.as_deref(), &attachments).await
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
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    match db.get_card_threads(&card_id) {
        Ok(Some((groups, next_page_token, cached_at))) => Ok(Some(CachedCardThreads {
            groups,
            next_page_token,
            cached_at,
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_cached_card_threads(
    card_id: String,
    groups: Vec<ThreadGroup>,
    next_page_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.save_card_threads(&card_id, &groups, next_page_token.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_card_cache(card_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "Lock error")?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.clear_card_cache(&card_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_attachment(
    account_id: String,
    message_id: String,
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;

        if !accounts.iter().any(|a| a.id == account_id) {
            return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    gmail.get_attachment(&message_id, &attachment_id).await
}

#[tauri::command]
pub async fn list_labels(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<GmailLabel>, String> {
    // Verify account exists
    {
        let db_guard = state.db.lock().map_err(|_| "Lock error")?;
        let db = db_guard.as_ref().ok_or("Database not initialized")?;
        let accounts = db.get_accounts().map_err(|e| e.to_string())?;

        if !accounts.iter().any(|a| a.id == account_id) {
            return Err("Account not found".to_string());
        }
    }

    let access_token = get_access_token(&state, &account_id).await?;
    let gmail = GmailClient::new(access_token);

    gmail.list_labels().await
}
