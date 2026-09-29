// One-click unsubscribe from a mailing list (RFC 8058)

use std::time::Duration;

// Redirects are not followed: a redirected POST would turn into a GET of some
// other page, which is not the one-click request the sender asked for
pub(crate) static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

/// The List-Unsubscribe link to POST to; only https links qualify
pub fn one_click_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| format!("Invalid unsubscribe link: {}", e))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("The unsubscribe link is not a secure web address".to_string());
    }
    Ok(parsed)
}

/// Sends the one-click request; any 2xx or 3xx answer means the list took it
pub async fn post_one_click(client: &reqwest::Client, url: reqwest::Url) -> Result<(), String> {
    let response = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body("List-Unsubscribe=One-Click")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the list to unsubscribe: {}", e))?;
    let status = response.status();
    if status.is_success() || status.is_redirection() {
        Ok(())
    } else {
        Err(format!("The list refused the unsubscribe request ({})", status.as_u16()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn only_https_links_are_posted_to() {
        assert_eq!(one_click_url("https://list.test/u/1?x=2").unwrap().as_str(), "https://list.test/u/1?x=2");
        assert!(one_click_url("http://list.test/u").is_err());
        assert!(one_click_url("javascript:alert(1)").is_err());
        assert!(one_click_url("mailto:leave@list.test").is_err());
        assert!(one_click_url("not a url").is_err());
    }

    /// Serves one request, answering with `status`, and returns what it received
    async fn serve_once(status: u16) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = socket.read(&mut chunk).await.unwrap();
                received.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&received).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if received.len() >= end + 4 + length || n == 0 {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let reply = format!("HTTP/1.1 {} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", status);
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&received).to_string()
        });
        (base, handle)
    }

    #[tokio::test]
    async fn posts_the_one_click_form_body() {
        let (base, server) = serve_once(200).await;
        let url = reqwest::Url::parse(&format!("{}/u/123?token=a", base)).unwrap();
        post_one_click(&HTTP_CLIENT, url).await.unwrap();
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /u/123?token=a HTTP/1.1"), "{}", request);
        assert!(request.to_ascii_lowercase().contains("content-type: application/x-www-form-urlencoded"));
        assert!(request.ends_with("\r\n\r\nList-Unsubscribe=One-Click"), "{}", request);
    }

    #[tokio::test]
    async fn a_redirect_counts_as_accepted_and_is_not_followed() {
        let (base, server) = serve_once(302).await;
        post_one_click(&HTTP_CLIENT, reqwest::Url::parse(&base).unwrap()).await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn an_error_status_is_reported() {
        let (base, server) = serve_once(500).await;
        let err = post_one_click(&HTTP_CLIENT, reqwest::Url::parse(&base).unwrap()).await.unwrap_err();
        assert!(err.contains("500"), "{}", err);
        server.await.unwrap();
    }
}
