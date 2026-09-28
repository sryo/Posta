// GmailClient against a local stub server

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

#[derive(Clone, Debug)]
pub(super) struct StubRequest {
    pub method: String,
    pub target: String,
    pub head: String,
    pub body: Vec<u8>,
}

impl StubRequest {
    fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }
}

pub(super) enum Reply {
    Json(u16, String),
    Raw { status: u16, content_type: String, body: String },
    /// Keep the connection open without ever answering
    Hang,
}

type Handler = dyn Fn(&StubRequest) -> Reply + Send + Sync;

/// A keep-alive HTTP/1.1 server answering each request with `handler`
pub(super) struct StubServer {
    pub base: String,
    requests: Arc<Mutex<Vec<StubRequest>>>,
    connections: Arc<AtomicUsize>,
}

impl StubServer {
    pub async fn start(handler: impl Fn(&StubRequest) -> Reply + Send + Sync + 'static) -> Self {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests: Arc<Mutex<Vec<StubRequest>>> = Default::default();
        let connections: Arc<AtomicUsize> = Default::default();
        let handler: Arc<Handler> = Arc::new(handler);
        let (log, accepted) = (requests.clone(), connections.clone());
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                accepted.fetch_add(1, Ordering::SeqCst);
                let handler = handler.clone();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buf: Vec<u8> = Vec::new();
                    let mut chunk = vec![0u8; 64 * 1024];
                    loop {
                        let header_end = loop {
                            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                                break i + 4;
                            }
                            match socket.read(&mut chunk).await {
                                Ok(0) | Err(_) => return,
                                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                            }
                        };
                        let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
                        let content_length = head
                            .lines()
                            .find_map(|l| {
                                let (k, v) = l.split_once(':')?;
                                k.eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<usize>().ok())?
                            })
                            .unwrap_or(0);
                        while buf.len() < header_end + content_length {
                            match socket.read(&mut chunk).await {
                                Ok(0) | Err(_) => return,
                                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                            }
                        }
                        let mut request_line = head.lines().next().unwrap_or_default().split(' ');
                        let request = StubRequest {
                            method: request_line.next().unwrap_or_default().to_string(),
                            target: request_line.next().unwrap_or_default().to_string(),
                            head: head.clone(),
                            body: buf[header_end..header_end + content_length].to_vec(),
                        };
                        buf.drain(..header_end + content_length);
                        let reply = handler(&request);
                        log.lock().unwrap().push(request);
                        let (status, content_type, body) = match reply {
                            Reply::Json(status, body) => (status, "application/json".to_string(), body),
                            Reply::Raw { status, content_type, body } => (status, content_type, body),
                            Reply::Hang => {
                                tokio::time::sleep(StdDuration::from_secs(3600)).await;
                                return;
                            }
                        };
                        let response = format!(
                            "HTTP/1.1 {} Stub\r\nContent-Type: {}\r\nContent-Length: {}\r\n\r\n{}",
                            status,
                            content_type,
                            body.len(),
                            body
                        );
                        if socket.write_all(response.as_bytes()).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        StubServer { base, requests, connections }
    }

    /// A client of this server, with its own connection pool
    pub fn client(&self) -> GmailClient {
        self.client_with(build_http_client(StdDuration::from_secs(5)))
    }

    pub fn client_with(&self, http: reqwest::Client) -> GmailClient {
        GmailClient {
            client: http,
            api_base: format!("{}/gmail/v1", self.base),
            batch_endpoint: format!("{}/batch/gmail/v1", self.base),
            ..GmailClient::new("token".into())
        }
    }

    pub fn requests(&self) -> Vec<StubRequest> {
        self.requests.lock().unwrap().clone()
    }

    pub fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }
}

/// Fail the test instead of hanging it when a call never returns
async fn within<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(StdDuration::from_secs(10), future)
        .await
        .expect("call did not return; the request has no timeout")
}

#[tokio::test]
async fn a_request_the_server_never_answers_fails_instead_of_hanging() {
    let server = StubServer::start(|_| Reply::Hang).await;
    let gmail = server.client_with(build_http_client(StdDuration::from_millis(300)));

    let err = within(gmail.get_current_history_id()).await.unwrap_err();
    assert!(err.contains("timed out"), "{}", err);
}

#[tokio::test]
async fn clients_share_one_connection_pool() {
    let server = StubServer::start(|_| Reply::Json(200, r#"{"historyId":"42"}"#.into())).await;
    let pointed_at_stub = || GmailClient {
        api_base: format!("{}/gmail/v1", server.base),
        ..GmailClient::new("token".into())
    };

    // Each command builds its own GmailClient; the second must reuse the
    // first one's connection rather than open (and TLS-handshake) a new one
    assert_eq!(within(pointed_at_stub().get_current_history_id()).await, Ok("42".to_string()));
    assert_eq!(within(pointed_at_stub().get_current_history_id()).await, Ok("42".to_string()));

    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|r| r.method == "GET" && r.target == "/gmail/v1/users/me/profile"));
    assert!(requests[0].head.to_ascii_lowercase().contains("authorization: bearer token"));
    assert_eq!(server.connections(), 1);
}

fn google_error(code: u16, status: &str, reason: &str, message: &str) -> String {
    serde_json::json!({
        "error": {
            "code": code,
            "message": message,
            "errors": [{ "message": message, "domain": "global", "reason": reason }],
            "status": status
        }
    })
    .to_string()
}

#[test]
fn api_errors_read_as_sentences_and_keep_their_status_prefix() {
    use reqwest::StatusCode;
    let disabled = serde_json::json!({
        "error": {
            "code": 403,
            "message": "Gmail API has not been used in project 123 before or it is disabled.",
            "status": "PERMISSION_DENIED",
            "details": [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "SERVICE_DISABLED" }]
        }
    })
    .to_string();
    let cases = [
        (StatusCode::FORBIDDEN, disabled, "Gmail API is not enabled"),
        (
            StatusCode::TOO_MANY_REQUESTS,
            google_error(429, "RESOURCE_EXHAUSTED", "rateLimitExceeded", "Too many concurrent requests for user"),
            "Too many requests",
        ),
        (
            StatusCode::FORBIDDEN,
            google_error(403, "PERMISSION_DENIED", "userRateLimitExceeded", "User-rate limit exceeded"),
            "Too many requests",
        ),
        (
            StatusCode::FORBIDDEN,
            google_error(403, "PERMISSION_DENIED", "insufficientPermissions", "Insufficient Permission"),
            "Sign in again",
        ),
        (
            StatusCode::UNAUTHORIZED,
            google_error(401, "UNAUTHENTICATED", "authError", "Invalid Credentials"),
            "Sign in again",
        ),
        (StatusCode::PAYLOAD_TOO_LARGE, "<html>Request Entity Too Large</html>".to_string(), "too large"),
        (
            StatusCode::NOT_FOUND,
            google_error(404, "NOT_FOUND", "notFound", "Requested entity was not found."),
            "Requested entity was not found.",
        ),
    ];
    for (status, body, expected) in cases {
        let message = friendly_gmail_error(status, &body);
        assert!(message.starts_with(&format!("API error {}: ", status)), "{}", message);
        assert!(message.to_lowercase().contains(&expected.to_lowercase()), "{} lacks {:?}", message, expected);
        assert!(!message.contains('{'), "raw JSON leaked: {}", message);
    }

    // Unrecognized bodies are cut short rather than dumped whole
    let long = friendly_gmail_error(StatusCode::BAD_GATEWAY, &"x".repeat(5000));
    assert!(long.starts_with("API error 502 Bad Gateway: "));
    assert!(long.len() < 400, "{}", long.len());
}

#[tokio::test]
async fn failed_calls_report_the_friendly_error() {
    let server = StubServer::start(|request| {
        if request.target.starts_with("/batch/") {
            Reply::Json(429, google_error(429, "RESOURCE_EXHAUSTED", "rateLimitExceeded", "slow down"))
        } else {
            Reply::Json(403, google_error(403, "PERMISSION_DENIED", "insufficientPermissions", "Insufficient Permission"))
        }
    })
    .await;
    let gmail = server.client();

    let err = within(gmail.list_labels()).await.unwrap_err();
    assert!(err.starts_with("API error 403 Forbidden: "), "{}", err);
    assert!(err.contains("Sign in again"), "{}", err);

    let err = within(gmail.execute_batch_get(&["/gmail/v1/users/me/threads/t1".to_string()]))
        .await
        .unwrap_err();
    assert!(err.contains("API error 429 Too Many Requests: Too many requests"), "{}", err);
}
