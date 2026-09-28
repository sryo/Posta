// OAuth callback server - listens for the OAuth redirect

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, Ipv6Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

const CALLBACK_PORT: u16 = 8420;

/// OAuth callback result; `state` has already been checked against the flow
pub struct CallbackResult {
    pub code: String,
    pub state: Option<String>,
}

/// One-shot HTTP server for the OAuth redirect. Bind before opening the
/// browser so the redirect can never race the bind.
pub struct CallbackServer {
    listeners: Vec<TcpListener>,
}

impl CallbackServer {
    pub fn bind() -> Result<Self, String> {
        Self::bind_on(CALLBACK_PORT)
    }

    /// Bind 127.0.0.1 and, where the host has it, [::1] on the same port: the
    /// redirect URI says `localhost`, which browsers may resolve to either.
    /// Owning both also stops another process from taking the IPv6 side and
    /// receiving the authorization code.
    fn bind_on(port: u16) -> Result<Self, String> {
        let v4 = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .map_err(|e| format!("Failed to bind to port {}: {}", port, e))?;
        let port = v4.local_addr().map_err(|e| e.to_string())?.port();
        let mut listeners = vec![v4];

        match TcpListener::bind((Ipv6Addr::LOCALHOST, port)) {
            Ok(v6) => listeners.push(v6),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                return Err(format!("Failed to bind to [::1]:{}: {}", port, e));
            }
            // IPv6 loopback unavailable on this host
            Err(_) => {}
        }

        // Non-blocking accept so the wait loop can poll the cancel flag
        for listener in &listeners {
            listener
                .set_nonblocking(true)
                .map_err(|e| format!("Failed to set non-blocking: {}", e))?;
        }

        Ok(Self { listeners })
    }

    #[cfg(test)]
    fn port(&self) -> u16 {
        self.listeners[0].local_addr().unwrap().port()
    }

    /// Block until the OAuth redirect for `expected_state` arrives, the timeout
    /// elapses, or the cancel flag is set. Redirects carrying any other state
    /// are answered with 400 and ignored. Consumes the server so the port is
    /// released on every exit path.
    pub fn wait_for_callback(
        self,
        timeout_secs: u64,
        cancel: Arc<AtomicBool>,
        expected_state: &str,
    ) -> Result<CallbackResult, String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(timeout_secs);
        // Each connection is read on its own thread so an idle browser
        // preconnect can't hold up a redirect arriving on another socket
        let (outcomes, results) = mpsc::channel();

        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("OAuth flow cancelled".to_string());
            }
            if start.elapsed() > timeout {
                return Err("Timed out waiting for sign-in in the browser. Try again.".to_string());
            }

            for listener in &self.listeners {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let outcomes = outcomes.clone();
                        let expected_state = expected_state.to_string();
                        thread::spawn(move || {
                            let _ = outcomes.send(handle_connection(stream, &expected_state));
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => return Err(format!("Accept error: {}", e)),
                }
            }

            match results.recv_timeout(Duration::from_millis(50)) {
                Ok(ConnectionOutcome::Success(result)) => return Ok(result),
                Ok(ConnectionOutcome::OAuthError(error)) => return Err(error),
                // Preconnects, unrelated requests, foreign state: keep listening
                Ok(ConnectionOutcome::Ignored) | Err(_) => {}
            }
        }
    }
}

enum ConnectionOutcome {
    Success(CallbackResult),
    OAuthError(String),
    Ignored,
}

fn handle_connection(stream: TcpStream, expected_state: &str) -> ConnectionOutcome {
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

    // Anything else (e.g. favicon) is unrelated; close it and keep waiting
    let Some(redirect) = parse_redirect(&request_line) else {
        return ConnectionOutcome::Ignored;
    };

    if redirect.state.as_deref() != Some(expected_state) {
        respond(stream, "400 Bad Request", "#d93025", "Sign In Failed",
            "This sign-in link does not belong to the current request.");
        return ConnectionOutcome::Ignored;
    }

    match redirect.outcome {
        Ok(code) => {
            respond(stream, "200 OK", "#4285f4", "\u{2713} Signed In",
                "You can close this window and return to Posta.");
            ConnectionOutcome::Success(CallbackResult { code, state: redirect.state })
        }
        Err(error) => {
            respond(stream, "200 OK", "#d93025", "Sign In Failed", &error);
            ConnectionOutcome::OAuthError(error)
        }
    }
}

fn respond(mut stream: TcpStream, status: &str, accent: &str, title: &str, message: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\n\
        Content-Type: text/html; charset=utf-8\r\n\
        Connection: close\r\n\r\n\
        <!DOCTYPE html>\
        <html><head><meta charset=\"utf-8\"><style>\
        body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; \
        display: flex; justify-content: center; align-items: center; \
        height: 100vh; margin: 0; background: #f5f5f5; color: #222; }}\
        @media (prefers-color-scheme: dark) {{ body {{ background: #1e1e1e; color: #e0e0e0; }} }}\
        .container {{ text-align: center; }}\
        h1 {{ color: {accent}; margin-bottom: 8px; }}\
        p {{ color: #666; }} @media (prefers-color-scheme: dark) {{ p {{ color: #999; }} }}\
        </style></head><body>\
        <div class=\"container\">\
        <h1>{title}</h1>\
        <p>{message}</p>\
        </div></body></html>",
        message = html_escape(message),
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Escape a string for safe interpolation into HTML; the error page reflects
/// attacker-controllable query parameters
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Extract query string from HTTP request line (e.g., "GET /callback?code=xxx HTTP/1.1")
fn extract_query_string(request: &str) -> Option<&str> {
    let parts: Vec<&str> = request.split_whitespace().collect();
    let path = parts.get(1)?;
    let query_start = path.find('?')?;
    Some(&path[query_start + 1..])
}

/// Get a form-urlencoded query parameter value by key
fn get_query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|param| {
        let (k, v) = param.split_once('=')?;
        if k != key {
            return None;
        }
        urlencoding::decode(&v.replace('+', " "))
            .ok()
            .map(|s| s.into_owned())
    })
}

struct Redirect {
    /// The authorization code, or the provider's error description
    outcome: Result<String, String>,
    state: Option<String>,
}

fn parse_redirect(request: &str) -> Option<Redirect> {
    let query = extract_query_string(request)?;
    let outcome = match get_query_param(query, "code") {
        Some(code) => Ok(code),
        None => {
            let error = get_query_param(query, "error");
            Err(if error.as_deref() == Some("access_denied") {
                "Access was denied in the browser. Sign in again and allow Posta access to continue.".to_string()
            } else {
                get_query_param(query, "error_description").or(error)?
            })
        }
    };
    Some(Redirect {
        outcome,
        state: get_query_param(query, "state"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_code_and_state_from_redirect() {
        let line = "GET /callback?state=abc123&code=4%2F0AbCd&scope=email HTTP/1.1\r\n";
        let redirect = parse_redirect(line).unwrap();
        assert_eq!(redirect.outcome.as_deref(), Ok("4/0AbCd"));
        assert_eq!(redirect.state.as_deref(), Some("abc123"));
    }

    #[test]
    fn ignores_requests_without_code() {
        assert!(parse_redirect("GET /favicon.ico HTTP/1.1\r\n").is_none());
        assert!(parse_redirect("GET /callback?state=x HTTP/1.1\r\n").is_none());
        assert!(parse_redirect("").is_none());
    }

    #[test]
    fn param_names_match_exactly() {
        let line = "GET /callback?xcode=bad&code=good HTTP/1.1";
        assert_eq!(parse_redirect(line).unwrap().outcome.as_deref(), Ok("good"));
    }

    #[test]
    fn error_description_is_form_decoded() {
        let line = "GET /callback?error=invalid_request&error_description=Missing+required%20parameter HTTP/1.1";
        assert_eq!(
            parse_redirect(line).unwrap().outcome.unwrap_err(),
            "Missing required parameter"
        );
        let line = "GET /callback?error=server_error HTTP/1.1";
        assert_eq!(parse_redirect(line).unwrap().outcome.unwrap_err(), "server_error");
    }

    #[test]
    fn declined_consent_is_explained_in_words() {
        let line = "GET /callback?error=access_denied&state=s HTTP/1.1";
        assert_eq!(
            parse_redirect(line).unwrap().outcome.unwrap_err(),
            "Access was denied in the browser. Sign in again and allow Posta access to continue."
        );
    }

    #[test]
    fn timeout_is_explained_in_words() {
        let server = bind_ephemeral();
        let err = server.wait_for_callback(0, Arc::new(AtomicBool::new(false)), "s").err().unwrap();
        assert_eq!(err, "Timed out waiting for sign-in in the browser. Try again.");
    }

    #[test]
    fn html_escape_neutralizes_markup() {
        assert_eq!(
            html_escape(r#"<img src=x onerror='a&b'>"#),
            "&lt;img src=x onerror=&#39;a&amp;b&#39;&gt;"
        );
    }

    fn send(addr: std::net::SocketAddr, request_line: &str) -> String {
        use std::io::Read;
        let mut stream = TcpStream::connect(addr).unwrap();
        stream.write_all(format!("{}\r\nHost: localhost\r\n\r\n", request_line).as_bytes()).unwrap();
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
    }

    /// The ephemeral port picked on 127.0.0.1 may already be taken on [::1]
    /// by an unrelated socket; pick another rather than fail the test
    fn bind_ephemeral() -> CallbackServer {
        let mut last_err = String::new();
        for _ in 0..20 {
            match CallbackServer::bind_on(0) {
                Ok(server) => return server,
                Err(e) => last_err = e,
            }
        }
        panic!("{}", last_err);
    }

    fn spawn_wait(
        server: CallbackServer,
        expected_state: &str,
    ) -> (Arc<AtomicBool>, thread::JoinHandle<Result<CallbackResult, String>>) {
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let expected_state = expected_state.to_string();
        let handle = thread::spawn(move || server.wait_for_callback(10, flag, &expected_state));
        (cancel, handle)
    }

    #[test]
    fn callback_with_foreign_state_is_rejected_and_flow_keeps_waiting() {
        let server = bind_ephemeral();
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], server.port()));
        let (_cancel, handle) = spawn_wait(server, "expected");

        let forged = send(addr, "GET /callback?code=evil&state=forged HTTP/1.1");
        assert!(forged.starts_with("HTTP/1.1 400"), "{}", forged);
        let missing = send(addr, "GET /callback?code=evil HTTP/1.1");
        assert!(missing.starts_with("HTTP/1.1 400"), "{}", missing);

        let ok = send(addr, "GET /callback?code=good&state=expected HTTP/1.1");
        assert!(ok.starts_with("HTTP/1.1 200"), "{}", ok);
        let result = handle.join().unwrap().unwrap();
        assert_eq!(result.code, "good");
    }

    #[test]
    fn oauth_error_only_ends_the_flow_with_matching_state() {
        let server = bind_ephemeral();
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], server.port()));
        let (_cancel, handle) = spawn_wait(server, "expected");

        send(addr, "GET /callback?error=access_denied&state=forged HTTP/1.1");
        send(addr, "GET /callback?error=access_denied HTTP/1.1");
        send(addr, "GET /callback?error=access_denied&state=expected HTTP/1.1");
        let err = handle.join().unwrap().err().unwrap();
        assert!(err.starts_with("Access was denied"), "{}", err);
    }

    #[test]
    fn idle_preconnect_does_not_delay_the_redirect() {
        let server = bind_ephemeral();
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], server.port()));
        let (_cancel, handle) = spawn_wait(server, "s");

        // Browsers open speculative sockets that may never send a byte
        let _idle = TcpStream::connect(addr).unwrap();
        thread::sleep(Duration::from_millis(200));

        let started = std::time::Instant::now();
        let ok = send(addr, "GET /callback?code=c&state=s HTTP/1.1");
        assert!(ok.starts_with("HTTP/1.1 200"), "{}", ok);
        assert_eq!(handle.join().unwrap().unwrap().code, "c");
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
    }

    #[test]
    fn cancel_flag_ends_the_wait() {
        let server = bind_ephemeral();
        let (cancel, handle) = spawn_wait(server, "expected");
        cancel.store(true, Ordering::SeqCst);
        assert!(handle.join().unwrap().is_err());
    }

    #[test]
    fn callback_over_ipv6_loopback_is_accepted() {
        if TcpListener::bind("[::1]:0").is_err() {
            return; // host without IPv6 loopback
        }
        let server = bind_ephemeral();
        let port = server.port();
        let (_cancel, handle) = spawn_wait(server, "s");
        let addr = std::net::SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, port));
        let ok = send(addr, "GET /callback?code=v6&state=s HTTP/1.1");
        assert!(ok.starts_with("HTTP/1.1 200"), "{}", ok);
        assert_eq!(handle.join().unwrap().unwrap().code, "v6");
    }
}
