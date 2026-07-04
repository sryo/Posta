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
        // Verifier: 64 URL-safe hex chars (RFC 7636 requires 43-128) built
        // from two v4 UUIDs, which use a cryptographic RNG
        let verifier = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );

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

    /// Exchange the authorization code for tokens.
    /// Returns (access_token, refresh_token, expires_in_secs).
    pub async fn exchange_code(&self, code: String, received_state: Option<&str>) -> Result<(String, String, Option<u64>), AuthError> {
        // Verify state BEFORE consuming the pending flow, so a stray callback
        // with a bad state doesn't destroy a still-valid flow
        let verifier = {
            let mut guard = self.pending_auth.lock().await;
            let pending = guard
                .as_ref()
                .ok_or_else(|| AuthError::OAuth2("No pending auth flow".to_string()))?;

            if let Some(received) = received_state {
                if received != pending.state {
                    return Err(AuthError::OAuth2("State mismatch - possible CSRF attack".to_string()));
                }
            }

            guard.take().map(|p| p.verifier).unwrap_or_default()
        };

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

        Ok((token_resp.access_token, refresh_token, token_resp.expires_in))
    }

    /// Refresh the access token. Returns (access_token, expires_in_secs).
    pub async fn refresh_access_token(&self, refresh_token: &str) -> Result<(String, Option<u64>), AuthError> {
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
        Ok((token_resp.access_token, token_resp.expires_in))
    }
}

fn base64_url_encode(input: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(input)
}

// Secure token storage - tries keychain first, falls back to file storage
const KEYRING_SERVICE: &str = "com.posta.mail";

use std::path::{Path, PathBuf};

fn get_token_file_path(app_data_dir: &Path, account_id: &str) -> PathBuf {
    app_data_dir.join("tokens").join(format!("{}.token", account_id))
}

fn get_credentials_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("tokens").join("oauth_credentials.json")
}

/// Store a secret in the keychain and verify it can be read back
/// (keychain can silently fail in sandboxed apps)
fn keychain_store_verified(key: &str, secret: &str) -> bool {
    match keyring::Entry::new(KEYRING_SERVICE, key) {
        Ok(entry) => {
            entry.set_password(secret).is_ok()
                && entry.get_password().map(|s| s == secret).unwrap_or(false)
        }
        Err(_) => false,
    }
}

/// Write a secret to the plaintext fallback file, restricting it to the
/// current user on unix
fn write_secret_file(path: &Path, secret: &str, what: &str) -> Result<(), AuthError> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, secret)
        .map_err(|e| AuthError::Keyring(format!("Failed to store {}: {}", what, e)))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn store_refresh_token(account_id: &str, token: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    tracing::info!("Storing refresh token for account: {}", account_id);

    let path = get_token_file_path(app_data_dir, account_id);

    // Keychain is the primary store; the plaintext file is only a fallback
    if keychain_store_verified(&format!("token:{}", account_id), token) {
        tracing::info!("Token stored in system keychain");
        // Best-effort removal of any legacy plaintext copy
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        return Ok(());
    }

    tracing::warn!("Keychain storage failed, using file fallback");
    write_secret_file(&path, token, "token")?;
    tracing::info!("Token stored in file: {:?}", path);

    Ok(())
}

pub fn get_refresh_token(account_id: &str, app_data_dir: &Path) -> Result<String, AuthError> {
    tracing::info!("Getting refresh token for account: {}", account_id);

    // Try keychain first
    let key = format!("token:{}", account_id);
    match keyring::Entry::new(KEYRING_SERVICE, &key) {
        Ok(entry) => {
            match entry.get_password() {
                Ok(token) => {
                    tracing::info!("Found token in keychain");
                    return Ok(token);
                }
                Err(e) => {
                    tracing::warn!("Keychain get_password failed: {:?}", e);
                }
            }
        }
        Err(e) => {
            tracing::warn!("Keychain Entry::new failed: {:?}", e);
        }
    }

    // Fall back to file storage for backwards compatibility
    let path = get_token_file_path(app_data_dir, account_id);
    tracing::info!("Checking file fallback at: {:?}, exists: {}", path, path.exists());
    if path.exists() {
        if let Ok(token) = std::fs::read_to_string(&path) {
            let token = token.trim().to_string();
            if !token.is_empty() {
                tracing::info!("Found token in file storage (legacy), migrating to keychain");
                // Migrate to keychain; only remove the file once the
                // keychain copy is verified readable
                if keychain_store_verified(&key, &token) {
                    let _ = std::fs::remove_file(&path);
                    tracing::info!("Token migrated to keychain, removed legacy file");
                }
                return Ok(token);
            }
        }
    }

    tracing::warn!("No token found for account: {}", account_id);
    Err(AuthError::Keyring("No matching entry found in secure storage".to_string()))
}

pub fn delete_refresh_token(account_id: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    // Delete from keychain if present
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &format!("token:{}", account_id)) {
        let _ = entry.delete_credential();
    }

    // Delete from file storage if present
    let path = get_token_file_path(app_data_dir, account_id);
    let _ = std::fs::remove_file(path);

    Ok(())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OAuthCredentials {
    pub client_id: String,
    pub client_secret: String,
}

pub fn store_oauth_credentials(client_id: &str, client_secret: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    tracing::info!("Storing OAuth credentials");

    let credentials = OAuthCredentials {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
    };

    let json = serde_json::to_string(&credentials)
        .map_err(|e| AuthError::Keyring(format!("Failed to serialize credentials: {}", e)))?;

    let path = get_credentials_file_path(app_data_dir);

    // Keychain is the primary store; the plaintext file is only a fallback
    if keychain_store_verified("oauth:credentials", &json) {
        tracing::info!("OAuth credentials stored in keychain");
        // Best-effort removal of any legacy plaintext copy
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        return Ok(());
    }

    tracing::warn!("Keychain storage failed for credentials, using file fallback");
    write_secret_file(&path, &json, "credentials")?;
    tracing::info!("OAuth credentials stored in file: {:?}", path);

    Ok(())
}

pub fn get_oauth_credentials(app_data_dir: &Path) -> Result<OAuthCredentials, AuthError> {
    // Try keychain first
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "oauth:credentials") {
        if let Ok(json) = entry.get_password() {
            if let Ok(creds) = serde_json::from_str(&json) {
                tracing::info!("Found OAuth credentials in keychain");
                return Ok(creds);
            }
        }
    }

    // Fall back to file storage for backwards compatibility
    let path = get_credentials_file_path(app_data_dir);
    if path.exists() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(creds) = serde_json::from_str::<OAuthCredentials>(&json) {
                tracing::info!("Found OAuth credentials in file (legacy), migrating to keychain");
                // Migrate to keychain; only remove the file once the
                // keychain copy is verified readable
                if keychain_store_verified("oauth:credentials", &json) {
                    let _ = std::fs::remove_file(&path);
                    tracing::info!("Credentials migrated to keychain, removed legacy file");
                }
                return Ok(creds);
            }
        }
    }

    Err(AuthError::NoCredentials)
}

pub fn delete_oauth_credentials(app_data_dir: &Path) -> Result<(), AuthError> {
    // Delete from keychain if present
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "oauth:credentials") {
        let _ = entry.delete_credential();
    }

    // Delete from file storage if present
    let path = get_credentials_file_path(app_data_dir);
    let _ = std::fs::remove_file(path);

    Ok(())
}
