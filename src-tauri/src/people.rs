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

fn connections_url(page_size: i32, page_token: Option<&str>) -> String {
    let mut url = format!(
        "{}/people/me/connections?personFields=names,emailAddresses,photos&sortOrder=LAST_MODIFIED_DESCENDING&pageSize={}",
        PEOPLE_API_BASE, page_size
    );
    if let Some(token) = page_token {
        url.push_str(&format!("&pageToken={}", urlencoding::encode(token)));
    }
    url
}

pub struct PeopleClient {
    http_client: reqwest::Client,
    access_token: String,
}

impl PeopleClient {
    pub fn new(access_token: String) -> Self {
        Self {
            http_client: reqwest::Client::new(),
            access_token,
        }
    }

    /// Fetch user's connections (contacts) with pagination
    pub async fn list_contacts(
        &self,
        page_size: i32,
        page_token: Option<&str>,
    ) -> Result<(Vec<Contact>, Option<String>), String> {
        let url = connections_url(page_size, page_token);

        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("People API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            if status == reqwest::StatusCode::FORBIDDEN {
                return Err("Contacts permission not granted. Please re-authenticate to enable contact suggestions.".to_string());
            }
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("People API error ({}): {}", status, body));
        }

        let data: ConnectionsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse People API response: {}", e))?;

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
        let mut all_contacts = Vec::new();
        let mut page_token: Option<String> = None;
        let page_size = 100.min(max_contacts);

        loop {
            let (contacts, next_token) = self
                .list_contacts(page_size, page_token.as_deref())
                .await?;

            all_contacts.extend(contacts);

            if all_contacts.len() >= max_contacts as usize || next_token.is_none() {
                break;
            }

            page_token = next_token;
        }

        // Trim to max
        all_contacts.truncate(max_contacts as usize);
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

    #[test]
    fn connections_url_asks_for_most_recently_modified_first() {
        // The list is capped, so with the API's default (oldest first) a
        // large address book would only yield its stalest contacts
        let url = connections_url(100, None);
        assert!(url.starts_with("https://people.googleapis.com/v1/people/me/connections?"));
        assert!(url.contains("personFields=names,emailAddresses,photos"));
        assert!(url.contains("pageSize=100"));
        assert!(url.contains("sortOrder=LAST_MODIFIED_DESCENDING"));
        assert!(!url.contains("pageToken"));

        assert!(connections_url(100, Some("a+b/c")).contains("&pageToken=a%2Bb%2Fc"));
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
