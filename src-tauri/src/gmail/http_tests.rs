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
            upload_base: format!("{}/upload/gmail/v1", self.base),
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
async fn an_unreachable_server_is_reported_without_the_request_url() {
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    let gmail = GmailClient {
        client: build_http_client(StdDuration::from_secs(5)),
        api_base: format!("http://127.0.0.1:{}/gmail/v1", port),
        ..GmailClient::new("token".into())
    };

    let err = within(gmail.search_threads_limited("from:boss secret project", 5)).await.unwrap_err();
    assert!(err.contains("could not reach Gmail"), "{}", err);
    assert!(!err.contains("secret") && !err.contains("127.0.0.1"), "{}", err);
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

/// The paths of the GET sub-requests in a batch request body
fn batch_paths(request: &StubRequest) -> Vec<String> {
    request
        .body_text()
        .lines()
        .filter_map(|l| l.strip_prefix("GET ")?.strip_suffix(" HTTP/1.1").map(str::to_string))
        .collect()
}

/// A batch response answering each sub-request path with `answer(path)`
fn batch_reply(request: &StubRequest, answer: impl Fn(&str) -> (u16, String)) -> Reply {
    let boundary = "batch_stub";
    let mut body = String::new();
    for (i, path) in batch_paths(request).iter().enumerate() {
        let (status, json) = answer(path);
        body.push_str(&format!(
            "--{b}\r\nContent-Type: application/http\r\nContent-ID: <response-item{i}>\r\n\r\n\
             HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n\r\n{json}\r\n",
            b = boundary,
            i = i,
            status = status,
            json = json
        ));
    }
    body.push_str(&format!("--{}--\r\n", boundary));
    Reply::Raw {
        status: 200,
        content_type: format!("multipart/mixed; boundary={}", boundary),
        body,
    }
}

/// The thread id in a "/gmail/v1/users/me/threads/<id>?..." path or target
fn thread_id_of(path: &str) -> &str {
    let rest = path.split("/threads/").nth(1).unwrap_or_default();
    rest.split(['?', '/']).next().unwrap_or_default()
}

#[tokio::test]
async fn deletion_candidates_are_checked_in_batches() {
    let server = StubServer::start(|request| {
        if request.target.starts_with("/batch/") {
            return batch_reply(request, |path| match thread_id_of(path) {
                id if id.starts_with("gone") => (404, google_error(404, "NOT_FOUND", "notFound", "Not Found")),
                "flaky" => (500, google_error(500, "INTERNAL", "backendError", "Backend Error")),
                id => (200, serde_json::json!({ "id": id }).to_string()),
            });
        }
        // Sub-requests that failed for another reason are retried one by one
        match thread_id_of(&request.target) {
            "flaky" => Reply::Json(200, r#"{"id":"flaky"}"#.into()),
            _ => Reply::Json(500, "{}".into()),
        }
    })
    .await;
    let gmail = server.client();

    let mut ids: Vec<String> = (0..60).map(|i| format!("kept{}", i)).collect();
    ids.extend((0..50).map(|i| format!("gone{}", i)));
    ids.push("flaky".to_string());

    let (existing, deleted) = within(gmail.split_deleted_threads(&ids)).await.unwrap();

    let mut expected_existing: Vec<String> = (0..60).map(|i| format!("kept{}", i)).collect();
    expected_existing.push("flaky".to_string());
    assert_eq!(existing, expected_existing);
    assert_eq!(deleted, (0..50).map(|i| format!("gone{}", i)).collect::<Vec<_>>());

    let requests = server.requests();
    let batches: Vec<&StubRequest> = requests.iter().filter(|r| r.target.starts_with("/batch/")).collect();
    assert_eq!(batches.len(), 3, "111 ids fit in three batches of 50");
    assert!(batch_paths(batches[0]).iter().all(|p| p.contains("format=minimal") && p.contains("fields=id")));
    let singles: Vec<&str> = requests
        .iter()
        .filter(|r| !r.target.starts_with("/batch/"))
        .map(|r| thread_id_of(&r.target))
        .collect();
    assert_eq!(singles, ["flaky"]);
}

#[tokio::test]
async fn a_deletion_check_that_keeps_failing_fails_the_sync() {
    let server = StubServer::start(|request| {
        if request.target.starts_with("/batch/") {
            return batch_reply(request, |_| (503, "{}".into()));
        }
        Reply::Json(503, "{}".into())
    })
    .await;

    // Treating an unverified thread as deleted would drop it from the list
    let err = within(server.client().split_deleted_threads(&["t1".to_string()])).await.unwrap_err();
    assert!(err.contains("t1") && err.contains("503"), "{}", err);
}

/// The parts of a multipart request body as (headers, content)
fn multipart_parts(request: &StubRequest) -> Vec<(String, String)> {
    let content_type = request
        .head
        .lines()
        .find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.eq_ignore_ascii_case("content-type").then(|| v.trim().to_string())
        })
        .unwrap_or_default();
    assert!(content_type.starts_with("multipart/related"), "{}", content_type);
    let boundary = batch_boundary(&content_type).expect("boundary");
    let body = request.body_text();
    body.split(&format!("--{}", boundary))
        .skip(1)
        .filter(|part| !part.starts_with("--"))
        .map(|part| {
            let part = part.strip_prefix("\r\n").unwrap_or(part);
            let (headers, content) = part.split_once("\r\n\r\n").expect("part headers");
            (headers.to_string(), content.strip_suffix("\r\n").unwrap_or(content).to_string())
        })
        .collect()
}

#[tokio::test]
async fn messages_are_sent_through_the_upload_endpoint_as_rfc822() {
    let server = StubServer::start(|_| Reply::Json(200, r#"{"id":"sent1","threadId":"t9"}"#.into())).await;
    let gmail = server.client();

    // A few MB of attachment: the JSON endpoint would need it base64url'd
    // inside JSON and caps request bodies well below Gmail's 25MB limit
    let attachment = SendAttachment {
        filename: "big.bin".into(),
        mime_type: "application/octet-stream".into(),
        data: "A".repeat(4 * 1024 * 1024),
    };
    let attachments = [attachment];
    let message = OutgoingMessage {
        to: "bob@example.com",
        subject: "Files",
        body: "see attached",
        attachments: &attachments,
        ..Default::default()
    };
    within(gmail.send_email(&message)).await.unwrap();
    within(gmail.reply_to_thread("t9", Some("<parent@example.com>"), &message)).await.unwrap();

    let sends: Vec<StubRequest> = server
        .requests()
        .into_iter()
        .filter(|r| r.method == "POST")
        .collect();
    assert_eq!(sends.len(), 2);
    for (send, thread_id) in sends.iter().zip([None, Some("t9")]) {
        assert_eq!(send.target, "/upload/gmail/v1/users/me/messages/send?uploadType=multipart");
        let parts = multipart_parts(send);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].0.to_ascii_lowercase().contains("application/json"));
        let metadata: serde_json::Value = serde_json::from_str(&parts[0].1).unwrap();
        assert_eq!(metadata.get("threadId").and_then(|v| v.as_str()), thread_id);
        assert!(metadata.get("raw").is_none());
        assert!(parts[1].0.to_ascii_lowercase().contains("message/rfc822"));
        assert!(parts[1].1.starts_with("To: bob@example.com\r\n"), "{}", &parts[1].1[..40]);
        assert!(parts[1].1.contains("filename=\"big.bin\""));
    }
    assert!(sends[1].body_text().contains("In-Reply-To: <parent@example.com>"));
}

#[tokio::test]
async fn a_message_over_gmails_size_limit_is_refused_before_uploading() {
    let server = StubServer::start(|_| Reply::Json(200, "{}".into())).await;
    let attachments = [SendAttachment {
        filename: "huge.bin".into(),
        mime_type: "application/octet-stream".into(),
        data: "A".repeat(MAX_UPLOAD_BYTES + 1),
    }];
    let message = OutgoingMessage { to: "bob@example.com", attachments: &attachments, ..Default::default() };

    let err = within(server.client().send_email(&message)).await.unwrap_err();
    assert!(err.contains("too large"), "{}", err);
    let err = within(server.client().reply_to_thread("t1", None, &message)).await.unwrap_err();
    assert!(err.contains("too large"), "{}", err);
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn saving_over_a_draft_deleted_elsewhere_creates_a_new_one() {
    let server = StubServer::start(|request| match (request.method.as_str(), request.target.as_str()) {
        ("PUT", "/gmail/v1/users/me/drafts/gone") => {
            Reply::Json(404, google_error(404, "NOT_FOUND", "notFound", "Requested entity was not found."))
        }
        ("POST", "/gmail/v1/users/me/drafts") => Reply::Json(200, r#"{"id":"fresh","message":{"id":"m2"}}"#.into()),
        _ => Reply::Json(500, "{}".into()),
    })
    .await;
    let message = OutgoingMessage { to: "bob@example.com", body: "still writing", ..Default::default() };

    let draft = within(server.client().update_draft("gone", &message, None)).await.unwrap();

    assert_eq!(draft.id, "fresh");
    let requests = server.requests();
    let created = requests.iter().find(|r| r.method == "POST").expect("draft recreated");
    let raw = serde_json::from_slice::<serde_json::Value>(&created.body).unwrap()["message"]["raw"]
        .as_str()
        .map(|raw| decode_base64_body(raw).unwrap())
        .unwrap();
    assert!(raw.contains("still writing"));
}

#[tokio::test]
async fn other_draft_save_failures_are_not_retried_as_new_drafts() {
    let server = StubServer::start(|_| Reply::Json(500, "{}".into())).await;
    let message = OutgoingMessage { to: "bob@example.com", body: "text", ..Default::default() };

    assert!(within(server.client().update_draft("d1", &message, None)).await.is_err());
    assert!(server.requests().iter().all(|r| r.method == "PUT"));
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
