// OAuth callback server - listens for the OAuth redirect

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const CALLBACK_PORT: u16 = 8420;

/// OAuth callback result with code and state
pub struct CallbackResult {
    pub code: String,
    pub state: Option<String>,
}

/// One-shot HTTP server for the OAuth redirect. Bind before opening the
/// browser so the redirect can never race the bind.
pub struct CallbackServer {
    listener: TcpListener,
}

impl CallbackServer {
    pub fn bind() -> Result<Self, String> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
            .map_err(|e| format!("Failed to bind to port {}: {}", CALLBACK_PORT, e))?;

        // Non-blocking accept so the wait loop can poll the cancel flag
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

        Ok(Self { listener })
    }

    /// Block until the OAuth redirect arrives, the timeout elapses, or the
    /// cancel flag is set. Consumes the server so the port is released on
    /// every exit path.
    pub fn wait_for_callback(
        self,
        timeout_secs: u64,
        cancel: Arc<AtomicBool>,
    ) -> Result<CallbackResult, String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(timeout_secs);

        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("OAuth flow cancelled".to_string());
            }
            if start.elapsed() > timeout {
                return Err("Timeout waiting for OAuth callback".to_string());
            }

            match self.listener.accept() {
                Ok((stream, _)) => {
                    match handle_connection(stream) {
                        ConnectionOutcome::Success(result) => return Ok(result),
                        ConnectionOutcome::OAuthError(error) => return Err(error),
                        // Preconnects, unrelated requests, read errors: keep listening
                        ConnectionOutcome::Ignored => {}
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // No connection yet, sleep a bit
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("Accept error: {}", e)),
            }
        }
    }
}

enum ConnectionOutcome {
    Success(CallbackResult),
    OAuthError(String),
    Ignored,
}

fn handle_connection(stream: TcpStream) -> ConnectionOutcome {
    // Accepted sockets inherit the listener's non-blocking mode on macOS;
    // switch to blocking with a read timeout so read_line doesn't fail with
    // WouldBlock before the browser sends any bytes.
    if stream.set_nonblocking(false).is_err() {
        return ConnectionOutcome::Ignored;
    }
    if stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .is_err()
    {
        return ConnectionOutcome::Ignored;
    }

    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    match reader.read_line(&mut request_line) {
        // 0 bytes = browser preconnect or probe that closed without sending data
        Ok(0) => return ConnectionOutcome::Ignored,
        Ok(_) => {}
        Err(_) => return ConnectionOutcome::Ignored,
    }
    drop(reader);

    if let Some((code, state)) = extract_code_and_state(&request_line) {
        let response = "HTTP/1.1 200 OK\r\n\
            Content-Type: text/html; charset=utf-8\r\n\
            Connection: close\r\n\r\n\
            <!DOCTYPE html>\
            <html><head><meta charset=\"utf-8\"><style>\
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; \
            display: flex; justify-content: center; align-items: center; \
            height: 100vh; margin: 0; background: #f5f5f5; color: #222; }\
            @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #e0e0e0; } }\
            .container { text-align: center; }\
            h1 { color: #4285f4; margin-bottom: 8px; }\
            p { color: #666; } @media (prefers-color-scheme: dark) { p { color: #999; } }\
            </style></head><body>\
            <div class=\"container\">\
            <h1>✓ Signed In</h1>\
            <p>You can close this window and return to Posta.</p>\
            </div></body></html>";
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        ConnectionOutcome::Success(CallbackResult { code, state })
    } else if request_line.contains("error=") {
        let error = extract_error_from_request(&request_line)
            .unwrap_or_else(|| "Unknown error".to_string());
        let response = format!(
            "HTTP/1.1 200 OK\r\n\
            Content-Type: text/html; charset=utf-8\r\n\
            Connection: close\r\n\r\n\
            <!DOCTYPE html>\
            <html><head><meta charset=\"utf-8\"><style>\
            body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; \
            display: flex; justify-content: center; align-items: center; \
            height: 100vh; margin: 0; background: #f5f5f5; color: #222; }}\
            @media (prefers-color-scheme: dark) {{ body {{ background: #1e1e1e; color: #e0e0e0; }} }}\
            .container {{ text-align: center; }}\
            h1 {{ color: #d93025; margin-bottom: 8px; }}\
            p {{ color: #666; }} @media (prefers-color-scheme: dark) {{ p {{ color: #999; }} }}\
            </style></head><body>\
            <div class=\"container\">\
            <h1>Sign In Failed</h1>\
            <p>{}</p>\
            </div></body></html>",
            error
        );
        let mut stream = stream;
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        ConnectionOutcome::OAuthError(error)
    } else {
        // Unrelated request (e.g. favicon); close it and keep waiting
        ConnectionOutcome::Ignored
    }
}

/// Extract query string from HTTP request line (e.g., "GET /callback?code=xxx HTTP/1.1")
fn extract_query_string(request: &str) -> Option<&str> {
    let parts: Vec<&str> = request.split_whitespace().collect();
    let path = parts.get(1)?;
    let query_start = path.find('?')?;
    Some(&path[query_start + 1..])
}

/// Get a query parameter value by key
fn get_query_param(query: &str, key: &str) -> Option<String> {
    for param in query.split('&') {
        let kv: Vec<&str> = param.splitn(2, '=').collect();
        if kv.len() == 2 && kv[0] == key {
            return urlencoding::decode(kv[1]).ok().map(|s| s.to_string());
        }
    }
    None
}

fn extract_code_and_state(request: &str) -> Option<(String, Option<String>)> {
    let query = extract_query_string(request)?;
    let code = get_query_param(query, "code")?;
    let state = get_query_param(query, "state");
    Some((code, state))
}

fn extract_error_from_request(request: &str) -> Option<String> {
    let query = extract_query_string(request)?;
    get_query_param(query, "error_description")
        .or_else(|| get_query_param(query, "error"))
}
