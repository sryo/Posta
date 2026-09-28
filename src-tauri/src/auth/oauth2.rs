// Gmail OAuth2 authentication - simplified implementation using reqwest directly

use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
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
    http: reqwest::Client,
    token_url: String,
    pending_auth: Arc<Mutex<Option<PendingAuth>>>,
}

struct PendingAuth {
    verifier: String,
    state: String,
}

impl GmailAuth {
    pub fn new(client_id: String, client_secret: String) -> Self {
        // Callers hold the shared auth lock across token requests, so a hung
        // request would stall every account's refresh
        Self::with_endpoint(client_id, client_secret, GOOGLE_TOKEN_URL.to_string(), Duration::from_secs(30))
    }

    fn with_endpoint(client_id: String, client_secret: String, token_url: String, timeout: Duration) -> Self {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client_id,
            client_secret,
            http,
            token_url,
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

            if received_state != Some(pending.state.as_str()) {
                return Err(AuthError::OAuth2("State mismatch - possible CSRF attack".to_string()));
            }

            guard.take().map(|p| p.verifier).unwrap_or_default()
        };

        tracing::info!("Exchanging code for tokens...");

        let resp = self
            .http
            .post(&self.token_url)
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

        if !status.is_success() {
            return Err(AuthError::OAuth2(format!("Token exchange failed ({}): {}", status, body)));
        }

        // A successful body carries the tokens, so keep it out of the error
        let token_resp: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| AuthError::OAuth2(format!("Failed to parse token response: {}", e)))?;

        let refresh_token = token_resp
            .refresh_token
            .ok_or_else(|| AuthError::OAuth2("No refresh token received. Make sure to use 'prompt=consent' and 'access_type=offline'.".to_string()))?;

        Ok((token_resp.access_token, refresh_token, token_resp.expires_in))
    }

    /// Refresh the access token. Returns (access_token, expires_in_secs).
    pub async fn refresh_access_token(&self, refresh_token: &str) -> Result<(String, Option<u64>), AuthError> {
        let resp = self
            .http
            .post(&self.token_url)
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
            return Err(AuthError::TokenRefresh(error_text));
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

/// Debug builds never touch the keychain: every rebuild is a new binary to
/// macOS, so each one would prompt for the login password again, once per
/// secret. They use the owner-only fallback files instead.
fn keychain_entry(key: &str) -> Option<keyring::Entry> {
    if cfg!(debug_assertions) {
        return None;
    }
    keyring::Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| tracing::warn!("Keychain Entry::new failed: {:?}", e))
        .ok()
}

use std::path::{Path, PathBuf};

fn get_token_file_path(app_data_dir: &Path, account_id: &str) -> PathBuf {
    app_data_dir.join("tokens").join(format!("{}.token", account_id))
}

fn get_credentials_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("tokens").join("oauth_credentials.json")
}

fn get_gemini_key_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("tokens").join("gemini_api_key")
}

const GEMINI_KEYCHAIN_KEY: &str = "gemini:api_key";

/// Store a secret in the keychain and verify it can be read back
/// (keychain can silently fail in sandboxed apps)
fn keychain_store_verified(key: &str, secret: &str) -> bool {
    match keychain_entry(key) {
        Some(entry) => {
            entry.set_password(secret).is_ok()
                && entry.get_password().map(|s| s == secret).unwrap_or(false)
        }
        None => false,
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
    if let Some(entry) = keychain_entry(&key) {
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
    if let Some(entry) = keychain_entry(&format!("token:{}", account_id)) {
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
    if let Some(entry) = keychain_entry("oauth:credentials") {
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

/// Stores the Gemini API key used for smart replies; an empty key removes it
pub fn store_gemini_api_key(api_key: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    let path = get_gemini_key_file_path(app_data_dir);
    let api_key = api_key.trim();

    if api_key.is_empty() {
        if let Some(entry) = keychain_entry(GEMINI_KEYCHAIN_KEY) {
            let _ = entry.delete_credential();
        }
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }

    // Keychain is the primary store; the plaintext file is only a fallback
    if keychain_store_verified(GEMINI_KEYCHAIN_KEY, api_key) {
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        return Ok(());
    }

    tracing::warn!("Keychain storage failed for the Gemini API key, using file fallback");
    write_secret_file(&path, api_key, "Gemini API key")
}

pub fn get_gemini_api_key(app_data_dir: &Path) -> Option<String> {
    if let Some(entry) = keychain_entry(GEMINI_KEYCHAIN_KEY) {
        if let Ok(key) = entry.get_password() {
            if !key.is_empty() {
                return Some(key);
            }
        }
    }

    std::fs::read_to_string(get_gemini_key_file_path(app_data_dir))
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_builds_keep_secrets_in_owner_only_files_not_the_keychain() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("posta-secrets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        store_refresh_token("acct", "refresh-1", &dir).unwrap();
        store_oauth_credentials("id", "secret", &dir).unwrap();
        store_gemini_api_key("gem", &dir).unwrap();

        assert_eq!(get_refresh_token("acct", &dir).unwrap(), "refresh-1");
        assert_eq!(get_oauth_credentials(&dir).unwrap().client_secret, "secret");
        assert_eq!(get_gemini_api_key(&dir).as_deref(), Some("gem"));
        for path in [
            get_token_file_path(&dir, "acct"),
            get_credentials_file_path(&dir),
            get_gemini_key_file_path(&dir),
        ] {
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "{path:?}");
        }

        delete_refresh_token("acct", &dir).unwrap();
        assert!(get_refresh_token("acct", &dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn auth() -> GmailAuth {
        GmailAuth::new("client".into(), "secret".into())
    }

    #[tokio::test]
    async fn exchange_rejects_callback_without_state() {
        let auth = auth();
        auth.start_auth_flow().await.unwrap();
        let err = auth.exchange_code("code".into(), None).await.unwrap_err();
        assert!(err.to_string().contains("State"), "{}", err);
        assert!(auth.pending_auth.lock().await.is_some(), "flow must survive a bad callback");
    }

    #[tokio::test]
    async fn exchange_rejects_mismatched_state_and_keeps_flow() {
        let auth = auth();
        auth.start_auth_flow().await.unwrap();
        let err = auth.exchange_code("code".into(), Some("forged")).await.unwrap_err();
        assert!(err.to_string().contains("State"), "{}", err);
        assert!(auth.pending_auth.lock().await.is_some());
    }

    #[tokio::test]
    async fn exchange_without_pending_flow_fails() {
        let err = auth().exchange_code("code".into(), Some("x")).await.unwrap_err();
        assert!(err.to_string().contains("No pending"), "{}", err);
    }

    #[tokio::test]
    async fn auth_url_carries_pkce_and_state() {
        let auth = auth();
        let (url, state) = auth.start_auth_flow().await.unwrap();
        assert!(url.starts_with(GOOGLE_AUTH_URL));
        assert!(url.contains(&format!("state={}", state)));
        assert!(url.contains("code_challenge_method=S256"));

        let verifier = auth.pending_auth.lock().await.as_ref().unwrap().verifier.clone();
        assert!((43..=128).contains(&verifier.len()));
        use sha2::{Digest, Sha256};
        let challenge = base64_url_encode(&Sha256::digest(verifier.as_bytes()));
        assert!(url.contains(&format!("code_challenge={}&", challenge)));
    }

    /// Serve one canned HTTP response per connection on an ephemeral port;
    /// `None` accepts and never answers
    fn token_stub(response: Option<&'static str>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                match response {
                    Some(body) => {
                        let status = if body.contains("\"error\"") { "400 Bad Request" } else { "200 OK" };
                        let _ = write!(
                            stream,
                            "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            status,
                            body.len(),
                            body
                        );
                    }
                    None => std::thread::sleep(Duration::from_secs(30)),
                }
            }
        });
        url
    }

    fn auth_at(token_url: String, timeout: Duration) -> GmailAuth {
        GmailAuth::with_endpoint("client".into(), "secret".into(), token_url, timeout)
    }

    #[tokio::test]
    async fn hung_token_endpoint_times_out() {
        let auth = auth_at(token_stub(None), Duration::from_millis(300));
        let started = std::time::Instant::now();
        let result = tokio::time::timeout(Duration::from_secs(5), auth.refresh_access_token("rt")).await;
        let err = result.expect("refresh must not hang").unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(5), "{}", err);
    }

    #[tokio::test]
    async fn refresh_failure_keeps_google_error_and_single_prefix() {
        let auth = auth_at(
            token_stub(Some(r#"{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}"#)),
            Duration::from_secs(5),
        );
        let err = auth.refresh_access_token("rt").await.unwrap_err().to_string();
        assert!(err.contains("invalid_grant"), "{}", err);
        assert_eq!(err.matches("Token refresh failed").count(), 1, "{}", err);
    }

    #[tokio::test]
    async fn refresh_returns_token_and_expiry() {
        let auth = auth_at(
            token_stub(Some(r#"{"access_token": "at", "expires_in": 3599, "token_type": "Bearer"}"#)),
            Duration::from_secs(5),
        );
        assert_eq!(auth.refresh_access_token("rt").await.unwrap(), ("at".to_string(), Some(3599)));
    }

    #[tokio::test]
    async fn exchange_consumes_flow_and_returns_tokens() {
        let auth = auth_at(
            token_stub(Some(r#"{"access_token": "at", "refresh_token": "rt", "expires_in": 3599}"#)),
            Duration::from_secs(5),
        );
        let (_, state) = auth.start_auth_flow().await.unwrap();
        let tokens = auth.exchange_code("code".into(), Some(&state)).await.unwrap();
        assert_eq!(tokens, ("at".to_string(), "rt".to_string(), Some(3599)));
        assert!(auth.pending_auth.lock().await.is_none());
    }

    #[tokio::test]
    async fn exchange_without_refresh_token_fails() {
        let auth = auth_at(
            token_stub(Some(r#"{"access_token": "at", "expires_in": 3599}"#)),
            Duration::from_secs(5),
        );
        let (_, state) = auth.start_auth_flow().await.unwrap();
        let err = auth.exchange_code("code".into(), Some(&state)).await.unwrap_err();
        assert!(err.to_string().contains("No refresh token"), "{}", err);
    }
}
