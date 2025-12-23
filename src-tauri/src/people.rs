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
    #[serde(rename = "totalPeople")]
    total_people: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    person: Option<PeopleConnection>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Option<Vec<SearchResult>>,
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
        let mut url = format!(
            "{}/people/me/connections?personFields=names,emailAddresses,photos&pageSize={}",
            PEOPLE_API_BASE, page_size
        );

        if let Some(token) = page_token {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(token)));
        }

        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("People API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
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
            .filter_map(|c| self.connection_to_contact(c))
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

    /// Search contacts by query
    pub async fn search_contacts(&self, query: &str) -> Result<Vec<Contact>, String> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let url = format!(
            "{}/people:searchContacts?query={}&readMask=names,emailAddresses,photos&pageSize=10",
            PEOPLE_API_BASE,
            urlencoding::encode(query)
        );

        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("People search request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // If 403, the user might not have granted contacts scope
            if status.as_u16() == 403 {
                return Err("Contacts permission not granted. Please re-authenticate to enable contact search.".to_string());
            }
            return Err(format!("People search error ({}): {}", status, body));
        }

        let data: SearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse search response: {}", e))?;

        let contacts = data
            .results
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| r.person)
            .filter_map(|c| self.connection_to_contact(c))
            .collect();

        Ok(contacts)
    }

    fn connection_to_contact(&self, conn: PeopleConnection) -> Option<Contact> {
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
                    .or_else(|| None)
            })
            .and_then(|p| p.url);

        Some(Contact {
            resource_name: conn.resource_name,
            display_name,
            email_addresses,
            photo_url,
        })
    }
}
