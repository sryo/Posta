// OAuth callback server - listens for the OAuth redirect

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const CALLBACK_PORT: u16 = 8420;

/// OAuth callback result with code and state
pub struct CallbackResult {
    pub code: String,
    pub state: Option<String>,
}

/// Start listening for OAuth callback and return the authorization code and state
pub fn wait_for_callback(timeout_secs: u64) -> Result<CallbackResult, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
        .map_err(|e| format!("Failed to bind to port {}: {}", CALLBACK_PORT, e))?;

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

    let (tx, rx) = mpsc::channel();
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    // Spawn thread to handle incoming connection
    thread::spawn(move || {
        loop {
            if start.elapsed() > timeout {
                let _ = tx.send(Err("Timeout waiting for OAuth callback".to_string()));
                break;
            }

            match listener.accept() {
                Ok((mut stream, _)) => {
                    // Read HTTP request
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() {
                        continue;
                    }

                    // Parse the request to extract the code and state
                    if let Some((code, state)) = extract_code_and_state(&request_line) {
                        // Send success response
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
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                        let _ = tx.send(Ok(CallbackResult { code, state }));
                        break;
                    } else if request_line.contains("error=") {
                        // Handle OAuth error
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
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                        let _ = tx.send(Err(error));
                        break;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // No connection yet, sleep a bit
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Accept error: {}", e)));
                    break;
                }
            }
        }
    });

    // Wait for the result with timeout
    rx.recv_timeout(timeout + Duration::from_secs(1))
        .map_err(|_| "Timeout waiting for OAuth callback".to_string())?
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
