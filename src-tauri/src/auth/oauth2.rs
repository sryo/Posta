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

/// Keychain operations behind the secret storage, so the fallback-file logic
/// can be exercised without the real keychain
trait SecretStore {
    fn get(&self, key: &str) -> Option<String>;
    /// Whether the secret was stored and reads back unchanged (keychain can
    /// silently fail in sandboxed apps)
    fn set(&self, key: &str, secret: &str) -> bool;
    fn delete(&self, key: &str);
}

struct Keychain;

impl SecretStore for Keychain {
    fn get(&self, key: &str) -> Option<String> {
        match keychain_entry(key)?.get_password() {
            Ok(secret) => Some(secret),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                tracing::warn!("Keychain get_password failed for {}: {:?}", key, e);
                None
            }
        }
    }

    fn set(&self, key: &str, secret: &str) -> bool {
        keychain_entry(key).is_some_and(|entry| {
            entry.set_password(secret).is_ok() && entry.get_password().is_ok_and(|s| s == secret)
        })
    }

    fn delete(&self, key: &str) {
        if let Some(entry) = keychain_entry(key) {
            let _ = entry.delete_credential();
        }
    }
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

fn token_keychain_key(account_id: &str) -> String {
    format!("token:{}", account_id)
}

const CREDENTIALS_KEYCHAIN_KEY: &str = "oauth:credentials";
const GEMINI_KEYCHAIN_KEY: &str = "gemini:api_key";

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

/// Keychain is the primary store; the plaintext file is only a fallback
fn store_secret(
    keychain: &dyn SecretStore,
    key: &str,
    secret: &str,
    path: &Path,
    what: &str,
) -> Result<(), AuthError> {
    if keychain.set(key, secret) {
        // Best-effort removal of any legacy plaintext copy
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
        return Ok(());
    }

    tracing::warn!("Keychain storage failed for {}, using file fallback", what);
    write_secret_file(path, secret, what)?;
    // An older keychain copy would otherwise be read instead of the file
    keychain.delete(key);
    Ok(())
}

/// The keychain copy if `valid`, else the fallback file's, which moves into
/// the keychain once the keychain copy is verified readable
fn load_secret(
    keychain: &dyn SecretStore,
    key: &str,
    path: &Path,
    valid: impl Fn(&str) -> bool,
) -> Option<String> {
    if let Some(secret) = keychain.get(key).filter(|s| valid(s)) {
        return Some(secret);
    }

    let secret = std::fs::read_to_string(path).ok()?.trim().to_string();
    if !valid(&secret) {
        return None;
    }
    if keychain.set(key, &secret) {
        let _ = std::fs::remove_file(path);
        tracing::info!("Moved {:?} into the keychain", path.file_name().unwrap_or_default());
    }
    Some(secret)
}

fn delete_secret(keychain: &dyn SecretStore, key: &str, path: &Path) {
    keychain.delete(key);
    let _ = std::fs::remove_file(path);
}

pub fn store_refresh_token(account_id: &str, token: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    tracing::info!("Storing refresh token for account: {}", account_id);
    let path = get_token_file_path(app_data_dir, account_id);
    store_secret(&Keychain, &token_keychain_key(account_id), token, &path, "token")
}

pub fn get_refresh_token(account_id: &str, app_data_dir: &Path) -> Result<String, AuthError> {
    let path = get_token_file_path(app_data_dir, account_id);
    load_secret(&Keychain, &token_keychain_key(account_id), &path, |s| !s.is_empty()).ok_or_else(|| {
        tracing::warn!("No token found for account: {}", account_id);
        AuthError::Keyring("No matching entry found in secure storage".to_string())
    })
}

pub fn delete_refresh_token(account_id: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    delete_secret(&Keychain, &token_keychain_key(account_id), &get_token_file_path(app_data_dir, account_id));
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
    store_secret(&Keychain, CREDENTIALS_KEYCHAIN_KEY, &json, &path, "credentials")
}

pub fn get_oauth_credentials(app_data_dir: &Path) -> Result<OAuthCredentials, AuthError> {
    let parse = |json: &str| serde_json::from_str::<OAuthCredentials>(json).ok();
    let path = get_credentials_file_path(app_data_dir);
    load_secret(&Keychain, CREDENTIALS_KEYCHAIN_KEY, &path, |json| parse(json).is_some())
        .and_then(|json| parse(&json))
        .ok_or(AuthError::NoCredentials)
}

/// Stores the Gemini API key used for smart replies; an empty key removes it
pub fn store_gemini_api_key(api_key: &str, app_data_dir: &Path) -> Result<(), AuthError> {
    let path = get_gemini_key_file_path(app_data_dir);
    let api_key = api_key.trim();

    if api_key.is_empty() {
        delete_secret(&Keychain, GEMINI_KEYCHAIN_KEY, &path);
        return Ok(());
    }

    store_secret(&Keychain, GEMINI_KEYCHAIN_KEY, api_key, &path, "Gemini API key")
}

pub fn get_gemini_api_key(app_data_dir: &Path) -> Option<String> {
    load_secret(&Keychain, GEMINI_KEYCHAIN_KEY, &get_gemini_key_file_path(app_data_dir), |key| !key.is_empty())
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

    /// In-memory keychain; with `writable` false every set fails while
    /// entries already there stay readable
    struct FakeKeychain {
        entries: std::sync::Mutex<std::collections::HashMap<String, String>>,
        writable: bool,
    }

    impl FakeKeychain {
        fn new(writable: bool, entries: &[(&str, &str)]) -> Self {
            let entries = entries.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            Self { entries: std::sync::Mutex::new(entries), writable }
        }
    }

    impl SecretStore for FakeKeychain {
        fn get(&self, key: &str) -> Option<String> {
            self.entries.lock().unwrap().get(key).cloned()
        }

        fn set(&self, key: &str, secret: &str) -> bool {
            if self.writable {
                self.entries.lock().unwrap().insert(key.to_string(), secret.to_string());
            }
            self.writable
        }

        fn delete(&self, key: &str) {
            self.entries.lock().unwrap().remove(key);
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("posta-{}-{}", name, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn fallback_file_moves_into_a_working_keychain() {
        let dir = temp_dir("migrate");
        let path = dir.join("secret");
        std::fs::write(&path, "legacy\n").unwrap();
        let keychain = FakeKeychain::new(true, &[]);

        assert_eq!(load_secret(&keychain, "k", &path, |s| !s.is_empty()).as_deref(), Some("legacy"));
        assert_eq!(keychain.get("k").as_deref(), Some("legacy"));
        assert!(!path.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stored_secret_in_a_working_keychain_removes_the_fallback_file() {
        let dir = temp_dir("store");
        let path = dir.join("secret");
        std::fs::write(&path, "old").unwrap();
        let keychain = FakeKeychain::new(true, &[]);

        store_secret(&keychain, "k", "new", &path, "token").unwrap();
        assert_eq!(keychain.get("k").as_deref(), Some("new"));
        assert!(!path.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn secret_written_to_the_file_is_not_shadowed_by_an_old_keychain_copy() {
        let dir = temp_dir("stale");
        let path = dir.join("secret");
        let keychain = FakeKeychain::new(false, &[("k", "old")]);

        store_secret(&keychain, "k", "new", &path, "token").unwrap();

        assert_eq!(load_secret(&keychain, "k", &path, |s| !s.is_empty()).as_deref(), Some("new"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_fallback_write_keeps_the_keychain_copy() {
        let dir = temp_dir("unwritable");
        // A directory where the file should be makes the write fail
        let path = dir.join("secret");
        std::fs::create_dir_all(&path).unwrap();
        let keychain = FakeKeychain::new(false, &[("k", "old")]);

        assert!(store_secret(&keychain, "k", "new", &path, "token").is_err());
        assert_eq!(keychain.get("k").as_deref(), Some("old"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn invalid_keychain_copy_falls_back_to_the_file() {
        let dir = temp_dir("invalid");
        let path = dir.join("secret");
        std::fs::write(&path, "{\"client_id\":\"id\",\"client_secret\":\"s\"}").unwrap();
        let keychain = FakeKeychain::new(false, &[("k", "not json")]);
        let parses = |s: &str| serde_json::from_str::<OAuthCredentials>(s).is_ok();

        let json = load_secret(&keychain, "k", &path, parses).unwrap();
        assert!(json.contains("\"s\""));
        assert!(path.exists(), "the file stays while the keychain can't take it");
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
