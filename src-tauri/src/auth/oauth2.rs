// Gmail OAuth2 authentication - simplified implementation using reqwest directly

use serde::Deserialize;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "https://mail.google.com/ https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/contacts.readonly email profile";
const REDIRECT_URI: &str = "http://localhost:8420/callback";

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("OAuth2 error: {0}")]
    OAuth2(String),
    #[error("Token refresh failed: {0}")]
    TokenRefresh(String),
    #[error("Keyring error: {0}")]
    Keyring(String),
    #[error("No credentials configured")]
    NoCredentials,
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    #[allow(dead_code)]
    expires_in: Option<u64>,
}

pub struct GmailAuth {
    client_id: String,
    client_secret: String,
    pending_auth: Arc<Mutex<Option<PendingAuth>>>,
}

struct PendingAuth {
    verifier: String,
    state: String,
}

impl GmailAuth {
    pub fn new(client_id: String, client_secret: String) -> Self {
        Self {
            client_id,
            client_secret,
            pending_auth: Arc::new(Mutex::new(None)),
        }
    }

    fn generate_pkce() -> (String, String) {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        use std::time::{SystemTime, UNIX_EPOCH};

        // Generate verifier (43-128 chars, URL-safe base64)
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let random: u64 = rand::random();

        let mut hasher = DefaultHasher::new();
        timestamp.hash(&mut hasher);
        random.hash(&mut hasher);
        let verifier = format!("{:016x}{:016x}{:016x}{:016x}", hasher.finish(), random, timestamp as u64, rand::random::<u64>());

        // Generate challenge (SHA256 of verifier, base64url encoded)
        use sha2::{Digest, Sha256};
        let mut sha = Sha256::new();
        sha.update(verifier.as_bytes());
        let hash = sha.finalize();
        let challenge = base64_url_encode(&hash);

        (verifier, challenge)
    }

    pub async fn start_auth_flow(&self) -> Result<(String, String), AuthError> {
        let (verifier, challenge) = Self::generate_pkce();
        let state: String = format!("{:016x}", rand::random::<u64>());

        let auth_url = format!(
            "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256&state={}",
            GOOGLE_AUTH_URL,
            urlencoding::encode(&self.client_id),
            urlencoding::encode(REDIRECT_URI),
            urlencoding::encode(SCOPES),
            urlencoding::encode(&challenge),
            urlencoding::encode(&state)
        );

        *self.pending_auth.lock().await = Some(PendingAuth {
            verifier,
            state: state.clone(),
        });

        Ok((auth_url, state))
    }

    pub async fn exchange_code(&self, code: String, received_state: Option<&str>) -> Result<(String, String), AuthError> {
        let pending = self
            .pending_auth
            .lock()
            .await
            .take()
            .ok_or_else(|| AuthError::OAuth2("No pending auth flow".to_string()))?;

        // Verify state to prevent CSRF attacks
        if let Some(received) = received_state {
            if received != pending.state {
                return Err(AuthError::OAuth2("State mismatch - possible CSRF attack".to_string()));
            }
        }

        let verifier = pending.verifier;

        tracing::info!("Exchanging code for tokens...");
        tracing::debug!("Code: {}...", &code[..20.min(code.len())]);

        let client = reqwest::Client::new();
        let resp = client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("code", &code),
                ("code_verifier", &verifier),
                ("grant_type", "authorization_code"),
                ("redirect_uri", REDIRECT_URI),
            ])
            .send()
            .await?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        tracing::info!("Token response status: {}", status);
        tracing::debug!("Token response body: {}", &body);

        if !status.is_success() {
            return Err(AuthError::OAuth2(format!("Token exchange failed ({}): {}", status, body)));
        }

        let token_resp: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| AuthError::OAuth2(format!("Failed to parse token response: {} - {}", e, body)))?;

        tracing::info!("Got access token: {}...", &token_resp.access_token[..20.min(token_resp.access_token.len())]);

        let refresh_token = token_resp
            .refresh_token
            .ok_or_else(|| AuthError::OAuth2("No refresh token received. Make sure to use 'prompt=consent' and 'access_type=offline'.".to_string()))?;

        Ok((token_resp.access_token, refresh_token))
    }

    pub async fn refresh_access_token(&self, refresh_token: &str) -> Result<String, AuthError> {
        let client = reqwest::Client::new();
        let resp = client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(AuthError::TokenRefresh(format!("Token refresh failed: {}", error_text)));
        }

        let token_resp: TokenResponse = resp.json().await?;
        Ok(token_resp.access_token)
    }
}

fn base64_url_encode(input: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(input)
}

// Secure token storage - tries keychain first, falls back to file storage
const KEYRING_SERVICE: &str = "com.posta.mail";

use std::path::PathBuf;

fn get_token_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".posta_tokens")
}

fn get_token_file_path(account_id: &str) -> PathBuf {
    get_token_dir().join(format!("{}.token", account_id))
}

fn get_credentials_file_path() -> PathBuf {
    get_token_dir().join("oauth_credentials.json")
}

pub fn store_refresh_token(account_id: &str, token: &str) -> Result<(), AuthError> {
    tracing::info!("Storing refresh token for account: {}", account_id);

    // Try keychain first
    let keychain_ok = keyring::Entry::new(KEYRING_SERVICE, &format!("token:{}", account_id))
        .ok()
        .and_then(|entry| entry.set_password(token).ok())
        .is_some();

    if keychain_ok {
        tracing::info!("Token stored in system keychain");
    }

    // Always write to file as backup (keychain can silently fail on unsigned apps)
    let path = get_token_file_path(account_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AuthError::Keyring(format!("Failed to create token dir: {}", e)))?;
    }
    std::fs::write(&path, token)
        .map_err(|e| AuthError::Keyring(format!("Failed to write token: {}", e)))?;
    tracing::info!("Token stored at: {:?}", path);
    Ok(())
}

pub fn get_refresh_token(account_id: &str) -> Result<String, AuthError> {
    tracing::info!("Getting refresh token for account: {}", account_id);

    // Try keychain first
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &format!("token:{}", account_id)) {
        if let Ok(token) = entry.get_password() {
            tracing::info!("Token found in keychain");
            return Ok(token);
        }
    }

    // Fall back to file storage
    let path = get_token_file_path(account_id);
    if path.exists() {
        let token = std::fs::read_to_string(&path)
            .map_err(|e| AuthError::Keyring(format!("Failed to read token: {}", e)))?;
        tracing::info!("Token found in file storage");
        return Ok(token);
    }

    tracing::warn!("No token found for account: {}", account_id);
    Err(AuthError::Keyring("No matching entry found in secure storage".to_string()))
}

pub fn delete_refresh_token(account_id: &str) -> Result<(), AuthError> {
    // Delete from keychain if present
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &format!("token:{}", account_id)) {
        let _ = entry.delete_credential();
    }

    // Delete from file storage if present
    let path = get_token_file_path(account_id);
    let _ = std::fs::remove_file(path);

    Ok(())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OAuthCredentials {
    pub client_id: String,
    pub client_secret: String,
}

pub fn store_oauth_credentials(client_id: &str, client_secret: &str) -> Result<(), AuthError> {
    tracing::info!("Storing OAuth credentials");

    let credentials = OAuthCredentials {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
    };

    let json = serde_json::to_string(&credentials)
        .map_err(|e| AuthError::Keyring(format!("Failed to serialize credentials: {}", e)))?;

    // Try keychain first
    let keychain_ok = keyring::Entry::new(KEYRING_SERVICE, "oauth:credentials")
        .ok()
        .and_then(|entry| entry.set_password(&json).ok())
        .is_some();

    if keychain_ok {
        tracing::info!("OAuth credentials stored in keychain");
    }

    // Always write to file as backup (keychain can silently fail on unsigned apps)
    let path = get_credentials_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AuthError::Keyring(format!("Failed to create credentials dir: {}", e)))?;
    }
    std::fs::write(&path, &json)
        .map_err(|e| AuthError::Keyring(format!("Failed to write credentials: {}", e)))?;
    tracing::info!("OAuth credentials stored at: {:?}", path);
    Ok(())
}

pub fn get_oauth_credentials() -> Result<OAuthCredentials, AuthError> {
    // Try keychain first
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "oauth:credentials") {
        if let Ok(json) = entry.get_password() {
            let credentials: OAuthCredentials = serde_json::from_str(&json)
                .map_err(|e| AuthError::Keyring(format!("Failed to parse credentials: {}", e)))?;
            return Ok(credentials);
        }
    }

    // Fall back to file storage
    let path = get_credentials_file_path();
    if path.exists() {
        let json = std::fs::read_to_string(&path)
            .map_err(|e| AuthError::Keyring(format!("Failed to read credentials: {}", e)))?;
        let credentials: OAuthCredentials = serde_json::from_str(&json)
            .map_err(|e| AuthError::Keyring(format!("Failed to parse credentials: {}", e)))?;
        return Ok(credentials);
    }

    Err(AuthError::NoCredentials)
}

pub fn delete_oauth_credentials() -> Result<(), AuthError> {
    // Delete from keychain if present
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "oauth:credentials") {
        let _ = entry.delete_credential();
    }

    // Delete from file storage if present
    let path = get_credentials_file_path();
    let _ = std::fs::remove_file(path);

    Ok(())
}
