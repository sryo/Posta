// Google People API client for contacts

use serde::{Deserialize, Serialize};

const PEOPLE_API_BASE: &str = "https://people.googleapis.com/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub resource_name: String,
    pub display_name: Option<String>,
    pub email_addresses: Vec<String>,
    pub photo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PeopleConnection {
    #[serde(rename = "resourceName")]
    resource_name: String,
    names: Option<Vec<PersonName>>,
    #[serde(rename = "emailAddresses")]
    email_addresses: Option<Vec<EmailAddress>>,
    photos: Option<Vec<Photo>>,
}

#[derive(Debug, Deserialize)]
struct PersonName {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EmailAddress {
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Photo {
    url: Option<String>,
    default: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ConnectionsResponse {
    connections: Option<Vec<PeopleConnection>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

fn connections_url(api_base: &str, page_size: i32, page_token: Option<&str>) -> String {
    let mut url = format!(
        "{}/people/me/connections?personFields=names,emailAddresses,photos&sortOrder=LAST_MODIFIED_DESCENDING&pageSize={}",
        api_base, page_size
    );
    if let Some(token) = page_token {
        url.push_str(&format!("&pageToken={}", urlencoding::encode(token)));
    }
    url
}

fn people_error(status: reqwest::StatusCode, body: &str) -> String {
    if body.contains("SERVICE_DISABLED") || body.contains("has not been used in project") {
        return "People API not enabled. Please enable the Google People API in your Google Cloud Console to get contact suggestions.".to_string();
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return "Contacts permission not granted. Please re-authenticate to enable contact suggestions.".to_string();
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return "Too many requests to Google Contacts. Please try again later.".to_string();
    }
    // The status stays first: token eviction matches on "401 Unauthorized"
    match serde_json::from_str::<ApiErrorBody>(body).ok().and_then(|b| b.error.message) {
        Some(message) if !message.trim().is_empty() => format!("People API error ({}): {}", status, message),
        _ => format!("People API error ({})", status),
    }
}

#[derive(Deserialize)]
struct ApiErrorBody {
    error: ApiError,
}

#[derive(Deserialize)]
struct ApiError {
    message: Option<String>,
}

/// A transport failure in words the user can act on, without the request URL
fn people_request_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Google Contacts didn't respond. Check your connection and try again.".to_string()
    } else if e.is_connect() {
        "Couldn't reach Google Contacts. Check your connection and try again.".to_string()
    } else {
        format!("People API request failed: {}", e.without_url())
    }
}

pub struct PeopleClient {
    http_client: reqwest::Client,
    access_token: String,
    api_base: String,
}

impl PeopleClient {
    pub fn new(access_token: String) -> Self {
        Self {
            http_client: crate::calendar::HTTP_CLIENT.clone(),
            access_token,
            api_base: PEOPLE_API_BASE.to_string(),
        }
    }

    /// Fetch user's connections (contacts) with pagination
    async fn list_contacts(
        &self,
        page_size: i32,
        page_token: Option<&str>,
    ) -> Result<(Vec<Contact>, Option<String>), String> {
        let url = connections_url(&self.api_base, page_size, page_token);

        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(people_request_error)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(people_error(status, &body));
        }

        let data: ConnectionsResponse = resp
            .json()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    people_request_error(e)
                } else {
                    format!("Failed to parse People API response: {}", e.without_url())
                }
            })?;

        let contacts = data
            .connections
            .unwrap_or_default()
            .into_iter()
            .filter_map(connection_to_contact)
            .collect();

        Ok((contacts, data.next_page_token))
    }

    /// Fetch all contacts up to a limit (handles pagination internally)
    pub async fn fetch_all_contacts(&self, max_contacts: i32) -> Result<Vec<Contact>, String> {
        let Ok(max_contacts) = usize::try_from(max_contacts) else {
            return Ok(Vec::new());
        };
        if max_contacts == 0 {
            return Ok(Vec::new());
        }
        let mut all_contacts = Vec::new();
        let mut page_token: Option<String> = None;
        // The People API serves up to 1000 connections a page
        let page_size = max_contacts.min(1000) as i32;

        loop {
            let (contacts, next_token) = self
                .list_contacts(page_size, page_token.as_deref())
                .await?;

            all_contacts.extend(contacts);

            if all_contacts.len() >= max_contacts || next_token.is_none() || next_token == page_token {
                break;
            }

            page_token = next_token;
        }

        all_contacts.truncate(max_contacts);
        Ok(all_contacts)
    }
}

fn connection_to_contact(conn: PeopleConnection) -> Option<Contact> {
    let email_addresses: Vec<String> = conn
        .email_addresses
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| e.value)
        .filter(|e| !e.is_empty())
        .collect();

    // Skip contacts without email addresses
    if email_addresses.is_empty() {
        return None;
    }

    let display_name = conn
        .names
        .and_then(|names| names.into_iter().next())
        .and_then(|n| n.display_name);

    let photo_url = conn
        .photos
        .and_then(|photos| {
            photos
                .into_iter()
                .find(|p| p.default != Some(true)) // Prefer non-default photos
        })
        .and_then(|p| p.url);

    Some(Contact {
        resource_name: conn.resource_name,
        display_name,
        email_addresses,
        photo_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::stub_server::StubServer;

    #[test]
    fn connections_url_asks_for_most_recently_modified_first() {
        // The list is capped, so with the API's default (oldest first) a
        // large address book would only yield its stalest contacts
        let url = connections_url(PEOPLE_API_BASE, 100, None);
        assert!(url.starts_with("https://people.googleapis.com/v1/people/me/connections?"));
        assert!(url.contains("personFields=names,emailAddresses,photos"));
        assert!(url.contains("pageSize=100"));
        assert!(url.contains("sortOrder=LAST_MODIFIED_DESCENDING"));
        assert!(!url.contains("pageToken"));

        assert!(connections_url(PEOPLE_API_BASE, 100, Some("a+b/c")).contains("&pageToken=a%2Bb%2Fc"));
    }

    #[tokio::test]
    async fn fetch_all_contacts_with_no_budget_makes_no_request() {
        let server = StubServer::start(|_, _| (200, serde_json::json!({ "connections": [person(1)] }).to_string())).await;
        let client = stub_client(&server);
        assert!(client.fetch_all_contacts(0).await.unwrap().is_empty());
        assert!(client.fetch_all_contacts(-5).await.unwrap().is_empty());
        assert!(server.requests().is_empty());
    }

    #[test]
    fn a_disabled_people_api_is_not_reported_as_a_permissions_problem() {
        // Users bring their own Cloud project; re-authenticating can't enable an API
        let disabled = serde_json::json!({ "error": {
            "code": 403,
            "message": "People API has not been used in project 123 before or it is disabled.",
            "status": "PERMISSION_DENIED",
            "details": [{ "reason": "SERVICE_DISABLED" }],
        }})
        .to_string();
        let msg = people_error(reqwest::StatusCode::FORBIDDEN, &disabled);
        assert!(msg.contains("People API not enabled"), "{msg}");
        assert!(!msg.contains("re-authenticate"), "{msg}");

        let scope = people_error(reqwest::StatusCode::FORBIDDEN, r#"{"error":{"status":"PERMISSION_DENIED"}}"#);
        assert!(scope.contains("Contacts permission not granted"), "{scope}");

        // The token cache is evicted on this exact wording
        let expired = people_error(reqwest::StatusCode::UNAUTHORIZED, "{}");
        assert!(expired.contains("401 Unauthorized"), "{expired}");
    }

    #[test]
    fn people_errors_leave_out_the_raw_response_body() {
        let page = people_error(reqwest::StatusCode::BAD_GATEWAY, "<html><body>Bad gateway, a long page</body></html>");
        assert_eq!(page, "People API error (502 Bad Gateway)");

        let bad = people_error(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"code":400,"message":"Invalid personFields mask path.","status":"INVALID_ARGUMENT"}}"#,
        );
        assert_eq!(bad, "People API error (400 Bad Request): Invalid personFields mask path.");

        let limited = people_error(reqwest::StatusCode::TOO_MANY_REQUESTS, r#"{"error":{"status":"RESOURCE_EXHAUSTED"}}"#);
        assert!(limited.contains("Too many requests"), "{limited}");

        let expired = people_error(reqwest::StatusCode::UNAUTHORIZED, r#"{"error":{"message":"Request had invalid authentication credentials."}}"#);
        assert!(expired.starts_with("People API error (401 Unauthorized)"), "{expired}");
    }

    #[tokio::test]
    async fn connection_failures_are_explained_without_the_request_url() {
        let unreachable = PeopleClient { api_base: "http://127.0.0.1:9".into(), ..PeopleClient::new("token".into()) };
        let err = unreachable.fetch_all_contacts(10).await.unwrap_err();
        assert_eq!(err, "Couldn't reach Google Contacts. Check your connection and try again.");

        let server = StubServer::start(|_, _| (200, "not json".to_string())).await;
        let err = stub_client(&server).fetch_all_contacts(10).await.unwrap_err();
        assert!(err.starts_with("Failed to parse People API response"), "{err}");
        assert!(!err.contains("127.0.0.1") && !err.contains("connections"), "{err}");
    }

    fn stub_client(server: &StubServer) -> PeopleClient {
        PeopleClient { api_base: server.base.clone(), ..PeopleClient::new("token".into()) }
    }

    fn person(n: usize) -> serde_json::Value {
        serde_json::json!({ "resourceName": format!("people/{n}"), "emailAddresses": [{ "value": format!("p{n}@x.com") }] })
    }

    #[tokio::test]
    async fn contacts_follow_pages_up_to_the_limit() {
        let server = StubServer::start(|_, target| {
            let body = if target.contains("pageToken=2") {
                serde_json::json!({ "connections": [person(3), person(4)], "nextPageToken": "3" })
            } else {
                serde_json::json!({ "connections": [person(1), person(2)], "nextPageToken": "2" })
            };
            (200, body.to_string())
        })
        .await;
        let contacts = stub_client(&server).fetch_all_contacts(3).await.unwrap();
        let names: Vec<&str> = contacts.iter().map(|c| c.resource_name.as_str()).collect();
        assert_eq!(names, vec!["people/1", "people/2", "people/3"]);
        assert_eq!(server.requests().len(), 2);
    }

    #[tokio::test]
    async fn the_contacts_posta_suggests_come_in_one_request() {
        let server = StubServer::start(|_, _| (200, serde_json::json!({ "connections": [person(1)] }).to_string())).await;
        stub_client(&server).fetch_all_contacts(200).await.unwrap();
        let requests = server.requests();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].1.contains("pageSize=200"), "{}", requests[0].1);
    }

    #[tokio::test]
    async fn contacts_stop_paging_when_google_repeats_a_page_token() {
        let server = StubServer::start(|_, _| (200, serde_json::json!({ "connections": [], "nextPageToken": "again" }).to_string())).await;
        let contacts = tokio::time::timeout(std::time::Duration::from_secs(10), stub_client(&server).fetch_all_contacts(10))
            .await
            .expect("paged forever")
            .unwrap();
        assert!(contacts.is_empty());
        assert_eq!(server.requests().len(), 2);
    }

    #[tokio::test]
    async fn contact_fetches_reuse_connections() {
        // Clients share the pool (and request timeout) of the other Google
        // clients instead of opening a connection per fetch
        let server = StubServer::start(|_, _| (200, serde_json::json!({ "connections": [person(1)] }).to_string())).await;
        for _ in 0..3 {
            stub_client(&server).fetch_all_contacts(10).await.unwrap();
        }
        assert_eq!(server.requests().len(), 3);
        assert_eq!(server.connections(), 1);
    }

    fn connection(json: serde_json::Value) -> PeopleConnection {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn contact_conversion() {
        let contact = connection_to_contact(connection(serde_json::json!({
            "resourceName": "people/1",
            "names": [{ "displayName": "Ana" }, { "displayName": "Other" }],
            "emailAddresses": [{ "value": "ana@x.com" }, { "value": "" }, {}, { "value": "ana@y.com" }],
            "photos": [{ "url": "default.png", "default": true }, { "url": "real.png" }],
        })))
        .unwrap();
        assert_eq!(contact.resource_name, "people/1");
        assert_eq!(contact.display_name.as_deref(), Some("Ana"));
        assert_eq!(contact.email_addresses, vec!["ana@x.com", "ana@y.com"]);
        assert_eq!(contact.photo_url.as_deref(), Some("real.png"));

        let no_photo = connection_to_contact(connection(serde_json::json!({
            "resourceName": "people/2",
            "emailAddresses": [{ "value": "b@x.com" }],
            "photos": [{ "url": "default.png", "default": true }],
        })))
        .unwrap();
        assert_eq!(no_photo.display_name, None);
        assert_eq!(no_photo.photo_url, None);

        // Contacts without an address are useless for autocomplete
        let no_email = connection(serde_json::json!({
            "resourceName": "people/3",
            "names": [{ "displayName": "Phone only" }],
            "emailAddresses": [{ "value": "" }],
        }));
        assert!(connection_to_contact(no_email).is_none());
    }
}
