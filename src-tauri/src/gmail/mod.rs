// Gmail REST API client

use crate::models::{Attachment, CalendarEvent, DateBucket, SendAttachment, Thread, ThreadGroup};
use chrono::{DateTime, Datelike, Duration, Local, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const GMAIL_API_BASE: &str = "https://gmail.googleapis.com/gmail/v1";
const PAGE_SIZE: usize = 20;
const MAX_INLINE_IMAGE_SIZE: i32 = 100_000; // 100KB max for inline images

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub groups: Vec<ThreadGroup>,
    pub next_page_token: Option<String>,
    pub has_more: bool,
}

pub struct GmailClient {
    client: reqwest::Client,
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct ThreadListResponse {
    threads: Option<Vec<ThreadRef>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ThreadRef {
    id: String,
    #[serde(rename = "historyId")]
    history_id: Option<String>,
    snippet: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ThreadDetail {
    id: String,
    #[serde(rename = "historyId")]
    history_id: Option<String>,
    messages: Option<Vec<MessageDetail>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MessageDetail {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
    #[serde(rename = "labelIds")]
    label_ids: Option<Vec<String>>,
    snippet: Option<String>,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    payload: Option<MessagePayload>,
}

#[derive(Serialize)]
struct ModifyThreadRequest {
    #[serde(rename = "addLabelIds")]
    add_label_ids: Vec<String>,
    #[serde(rename = "removeLabelIds")]
    remove_label_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MessageBody {
    pub size: Option<i32>,
    pub data: Option<String>,
    #[serde(rename = "attachmentId")]
    pub attachment_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MessagePart {
    #[serde(rename = "partId")]
    pub part_id: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub filename: Option<String>,
    pub headers: Option<Vec<Header>>,
    pub body: Option<MessageBody>,
    pub parts: Option<Vec<MessagePart>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MessagePayload {
    pub headers: Option<Vec<Header>>,
    pub body: Option<MessageBody>,
    pub parts: Option<Vec<MessagePart>>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FullMessage {
    pub id: String,
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "labelIds")]
    pub label_ids: Option<Vec<String>>,
    pub snippet: Option<String>,
    #[serde(rename = "internalDate")]
    pub internal_date: Option<String>,
    pub payload: Option<MessagePayload>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FullThread {
    pub id: String,
    #[serde(rename = "historyId")]
    pub history_id: Option<String>,
    pub messages: Vec<FullMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GmailLabel {
    pub id: String,
    pub name: String,
    #[serde(rename = "messageListVisibility")]
    pub message_list_visibility: Option<String>,
    #[serde(rename = "labelListVisibility")]
    pub label_list_visibility: Option<String>,
    #[serde(rename = "type")]
    pub label_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListLabelsResponse {
    labels: Option<Vec<GmailLabel>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GmailDraft {
    pub id: String,
    pub message: Option<DraftMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DraftMessage {
    pub id: String,
    #[serde(rename = "threadId")]
    pub thread_id: Option<String>,
}

impl GmailClient {
    pub fn new(access_token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            access_token,
        }
    }

    pub async fn search_threads(&self, query: &str) -> Result<Vec<ThreadGroup>, String> {
        let result = self.search_threads_paginated(query, None).await?;
        Ok(result.groups)
    }

    /// Search threads with a custom limit (for preview)
    pub async fn search_threads_limited(&self, query: &str, max_results: usize) -> Result<Vec<ThreadGroup>, String> {
        let url = format!(
            "{}/users/me/threads?q={}&maxResults={}",
            GMAIL_API_BASE,
            urlencoding::encode(query),
            max_results
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let list: ThreadListResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let thread_refs = list.threads.unwrap_or_default();

        if thread_refs.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch details for each thread
        let mut threads = Vec::new();
        for thread_ref in thread_refs.iter() {
            match self.get_thread_detail(&thread_ref.id).await {
                Ok(thread) => threads.push(thread),
                Err(e) => {
                    tracing::warn!("Failed to fetch thread {}: {}", thread_ref.id, e);
                }
            }
        }

        Ok(group_threads_by_date(threads))
    }

    pub async fn search_threads_paginated(&self, query: &str, page_token: Option<&str>) -> Result<SearchResult, String> {
        // Search for threads
        let mut url = format!(
            "{}/users/me/threads?q={}&maxResults={}",
            GMAIL_API_BASE,
            urlencoding::encode(query),
            PAGE_SIZE
        );

        if let Some(token) = page_token {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(token)));
        }

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let list: ThreadListResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let thread_refs = list.threads.unwrap_or_default();
        let next_page_token = list.next_page_token.clone();
        let has_more = next_page_token.is_some();

        if thread_refs.is_empty() {
            return Ok(SearchResult {
                groups: Vec::new(),
                next_page_token: None,
                has_more: false,
            });
        }

        // Fetch details for each thread
        let mut threads = Vec::new();
        for thread_ref in thread_refs.iter() {
            match self.get_thread_detail(&thread_ref.id).await {
                Ok(thread) => threads.push(thread),
                Err(e) => {
                    tracing::warn!("Failed to fetch thread {}: {}", thread_ref.id, e);
                }
            }
        }

        // Group by date
        Ok(SearchResult {
            groups: group_threads_by_date(threads),
            next_page_token,
            has_more,
        })
    }

    pub async fn get_thread(&self, thread_id: &str) -> Result<FullThread, String> {
        let url = format!("{}/users/me/threads/{}?format=full", GMAIL_API_BASE, thread_id);

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let thread: FullThread = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse thread: {}", e))?;

        Ok(thread)
    }

    pub async fn modify_thread(
        &self,
        thread_id: &str,
        add_label_ids: Vec<String>,
        remove_label_ids: Vec<String>,
    ) -> Result<(), String> {
        let url = format!("{}/users/me/threads/{}/modify", GMAIL_API_BASE, thread_id);

        let body = ModifyThreadRequest {
            add_label_ids,
            remove_label_ids,
        };

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        Ok(())
    }

    pub async fn get_attachment(
        &self,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<String, String> {
        let url = format!(
            "{}/users/me/messages/{}/attachments/{}",
            GMAIL_API_BASE, message_id, attachment_id
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        #[derive(Deserialize)]
        struct AttachmentResponse {
            data: String,
        }

        let attachment: AttachmentResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse attachment: {}", e))?;

        Ok(attachment.data)
    }

    async fn get_thread_detail(&self, thread_id: &str) -> Result<Thread, String> {
        // Use format=full to get attachment info, but limit fields to avoid downloading bodies
        let url = format!(
            "{}/users/me/threads/{}?format=full&fields=id,messages(id,threadId,labelIds,snippet,internalDate,payload(headers,mimeType,parts(mimeType,filename,body(size,attachmentId),parts(mimeType,filename,body(size,attachmentId)))))",
            GMAIL_API_BASE, thread_id
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let detail: ThreadDetail = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse thread: {}", e))?;

        let messages = detail.messages.unwrap_or_default();

        // Get the latest message for subject/date
        let latest_msg = messages.last();

        let subject = latest_msg
            .and_then(|m| m.payload.as_ref())
            .and_then(|p| p.headers.as_ref())
            .and_then(|headers| {
                headers
                    .iter()
                    .find(|h| h.name.eq_ignore_ascii_case("Subject"))
                    .map(|h| h.value.clone())
            })
            .unwrap_or_else(|| "(No Subject)".to_string());

        let snippet = latest_msg
            .and_then(|m| m.snippet.clone())
            .unwrap_or_default();

        let last_date = latest_msg
            .and_then(|m| m.internal_date.as_ref())
            .and_then(|d| d.parse::<i64>().ok())
            .map(|ms| DateTime::from_timestamp_millis(ms).unwrap_or_else(Utc::now))
            .unwrap_or_else(Utc::now);

        // Count unread messages
        let unread_count = messages
            .iter()
            .filter(|m| {
                m.label_ids
                    .as_ref()
                    .map(|labels| labels.contains(&"UNREAD".to_string()))
                    .unwrap_or(false)
            })
            .count() as i32;

        // Get participants
        let mut participants: Vec<String> = messages
            .iter()
            .filter_map(|m| {
                m.payload.as_ref().and_then(|p| {
                    p.headers.as_ref().and_then(|headers| {
                        headers
                            .iter()
                            .find(|h| h.name.eq_ignore_ascii_case("From"))
                            .map(|h| extract_email_address(&h.value))
                    })
                })
            })
            .collect();
        participants.dedup();

        // Get labels
        let labels: Vec<String> = latest_msg
            .and_then(|m| m.label_ids.clone())
            .unwrap_or_default();

        // Extract attachments from all messages
        let mut attachments: Vec<Attachment> = Vec::new();
        for msg in &messages {
            if let Some(payload) = &msg.payload {
                let infos = extract_attachments_from_parts(&payload.parts);
                for info in infos {
                    attachments.push(Attachment {
                        message_id: msg.id.clone(),
                        attachment_id: info.attachment_id,
                        filename: info.filename,
                        mime_type: info.mime_type,
                        size: info.size,
                        inline_data: None,
                    });
                }
            }
        }

        // Fetch small image attachments inline (limit to first 3 images, < 100KB each)
        let image_attachments: Vec<&mut Attachment> = attachments
            .iter_mut()
            .filter(|a| a.mime_type.starts_with("image/") && a.size < MAX_INLINE_IMAGE_SIZE)
            .take(3)
            .collect();

        for attachment in image_attachments {
            match self.get_attachment(&attachment.message_id, &attachment.attachment_id).await {
                Ok(data) => {
                    attachment.inline_data = Some(data);
                }
                Err(e) => {
                    tracing::warn!("Failed to fetch attachment {}: {}", attachment.filename, e);
                }
            }
        }

        // Parse calendar events from ICS attachments
        let mut calendar_event: Option<CalendarEvent> = None;
        for attachment in attachments.iter() {
            if attachment.is_calendar() {
                match self.get_attachment(&attachment.message_id, &attachment.attachment_id).await {
                    Ok(data) => {
                        // Decode base64 URL-safe to regular base64, then decode to string
                        use base64::Engine;
                        let normalized = data.replace('-', "+").replace('_', "/");
                        if let Ok(decoded_bytes) = base64::engine::general_purpose::STANDARD.decode(&normalized) {
                            if let Ok(ics_content) = String::from_utf8(decoded_bytes) {
                                if let Some(event) = parse_ics_content(&ics_content) {
                                    calendar_event = Some(event);
                                    break; // Only use the first calendar event
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to fetch calendar attachment {}: {}", attachment.filename, e);
                    }
                }
            }
        }

        let has_attachment = !attachments.is_empty();

        Ok(Thread {
            gmail_thread_id: detail.id,
            account_id: String::new(), // Will be set by caller
            subject,
            snippet,
            last_message_date: last_date,
            unread_count,
            labels,
            participants,
            has_attachment,
            attachments,
            calendar_event,
        })
    }

    /// Send an email (with optional attachments)
    pub async fn send_email(
        &self,
        to: &str,
        cc: &str,
        bcc: &str,
        subject: &str,
        body: &str,
        attachments: &[SendAttachment],
    ) -> Result<(), String> {
        let url = format!("{}/users/me/messages/send", GMAIL_API_BASE);

        let message = self.build_mime_message(to, cc, bcc, subject, body, attachments, None)?;

        // Base64url encode
        use base64::Engine;
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(message.as_bytes());

        let request_body = serde_json::json!({
            "raw": encoded
        });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        Ok(())
    }

    /// Build a MIME message (plain text or multipart with attachments)
    fn build_mime_message(
        &self,
        to: &str,
        cc: &str,
        bcc: &str,
        subject: &str,
        body: &str,
        attachments: &[SendAttachment],
        reply_headers: Option<(&str, &str)>, // (In-Reply-To, References)
    ) -> Result<String, String> {
        let mut message = format!("To: {}\r\n", to);

        // Add CC if not empty
        if !cc.trim().is_empty() {
            message.push_str(&format!("Cc: {}\r\n", cc));
        }

        // Add BCC if not empty
        if !bcc.trim().is_empty() {
            message.push_str(&format!("Bcc: {}\r\n", bcc));
        }

        message.push_str(&format!("Subject: {}\r\n", subject));
        message.push_str("MIME-Version: 1.0\r\n");

        // Add threading headers if this is a reply
        if let Some((in_reply_to, references)) = reply_headers {
            message.push_str(&format!("In-Reply-To: {}\r\nReferences: {}\r\n", in_reply_to, references));
        }

        if attachments.is_empty() {
            // Simple plain text message
            message.push_str("Content-Type: text/plain; charset=utf-8\r\n\r\n");
            message.push_str(body);
        } else {
            // Multipart message with attachments
            let boundary = format!("----=_Part_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
            message.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n", boundary));

            // Text part
            message.push_str(&format!("--{}\r\n", boundary));
            message.push_str("Content-Type: text/plain; charset=utf-8\r\n");
            message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
            message.push_str(body);
            message.push_str("\r\n");

            // Attachment parts
            for attachment in attachments {
                message.push_str(&format!("--{}\r\n", boundary));
                message.push_str(&format!(
                    "Content-Type: {}; name=\"{}\"\r\n",
                    attachment.mime_type, attachment.filename
                ));
                message.push_str("Content-Transfer-Encoding: base64\r\n");
                message.push_str(&format!(
                    "Content-Disposition: attachment; filename=\"{}\"\r\n\r\n",
                    attachment.filename
                ));
                // The data is already base64-encoded from frontend, but Gmail expects standard base64
                // We need to normalize it (remove URL-safe chars if any)
                let normalized_data = attachment.data
                    .replace('-', "+")
                    .replace('_', "/");
                // Add line breaks every 76 chars for RFC compliance
                for chunk in normalized_data.as_bytes().chunks(76) {
                    message.push_str(std::str::from_utf8(chunk).unwrap_or(""));
                    message.push_str("\r\n");
                }
            }

            // Final boundary
            message.push_str(&format!("--{}--\r\n", boundary));
        }

        Ok(message)
    }

    /// Reply to a thread (with optional attachments)
    pub async fn reply_to_thread(
        &self,
        thread_id: &str,
        to: &str,
        cc: &str,
        bcc: &str,
        subject: &str,
        body: &str,
        message_id: Option<&str>,
        attachments: &[SendAttachment],
    ) -> Result<(), String> {
        let url = format!("{}/users/me/messages/send", GMAIL_API_BASE);

        // Build reply headers if message_id is present
        let reply_headers = message_id.map(|id| (id, id));

        let message = self.build_mime_message(to, cc, bcc, subject, body, attachments, reply_headers)?;

        // Base64url encode
        use base64::Engine;
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(message.as_bytes());

        let request_body = serde_json::json!({
            "raw": encoded,
            "threadId": thread_id
        });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        Ok(())
    }

    /// List all labels for the authenticated user
    pub async fn list_labels(&self) -> Result<Vec<GmailLabel>, String> {
        let url = format!("{}/users/me/labels", GMAIL_API_BASE);

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let response: ListLabelsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse labels: {}", e))?;

        Ok(response.labels.unwrap_or_default())
    }

    /// Create a new draft
    pub async fn create_draft(
        &self,
        to: &str,
        cc: &str,
        bcc: &str,
        subject: &str,
        body: &str,
        thread_id: Option<&str>,
    ) -> Result<GmailDraft, String> {
        let url = format!("{}/users/me/drafts", GMAIL_API_BASE);

        let message = self.build_mime_message(to, cc, bcc, subject, body, &[], None)?;

        use base64::Engine;
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(message.as_bytes());

        let mut request_body = serde_json::json!({
            "message": {
                "raw": encoded
            }
        });

        if let Some(tid) = thread_id {
            request_body["message"]["threadId"] = serde_json::json!(tid);
        }

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let draft: GmailDraft = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse draft: {}", e))?;

        Ok(draft)
    }

    /// Update an existing draft
    pub async fn update_draft(
        &self,
        draft_id: &str,
        to: &str,
        cc: &str,
        bcc: &str,
        subject: &str,
        body: &str,
        thread_id: Option<&str>,
    ) -> Result<GmailDraft, String> {
        let url = format!("{}/users/me/drafts/{}", GMAIL_API_BASE, draft_id);

        let message = self.build_mime_message(to, cc, bcc, subject, body, &[], None)?;

        use base64::Engine;
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(message.as_bytes());

        let mut request_body = serde_json::json!({
            "message": {
                "raw": encoded
            }
        });

        if let Some(tid) = thread_id {
            request_body["message"]["threadId"] = serde_json::json!(tid);
        }

        let resp = self
            .client
            .put(&url)
            .bearer_auth(&self.access_token)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let draft: GmailDraft = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse draft: {}", e))?;

        Ok(draft)
    }

    /// Delete a draft
    pub async fn delete_draft(&self, draft_id: &str) -> Result<(), String> {
        let url = format!("{}/users/me/drafts/{}", GMAIL_API_BASE, draft_id);

        let resp = self
            .client
            .delete(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        Ok(())
    }
}

fn extract_email_address(from: &str) -> String {
    // Parse "Name <email@example.com>" format - extract the email part
    if let Some(start) = from.find('<') {
        if let Some(end) = from.find('>') {
            return from[start + 1..end].trim().to_string();
        }
    }
    // Already just an email address
    from.trim().to_string()
}

/// Parse ICS calendar data and extract the first event
/// Uses simple text parsing since the icalendar crate has a complex API
fn parse_ics_content(ics_data: &str) -> Option<CalendarEvent> {
    // Check if this is a valid calendar
    if !ics_data.contains("BEGIN:VCALENDAR") || !ics_data.contains("BEGIN:VEVENT") {
        return None;
    }

    // Helper to extract a property value
    let get_property = |name: &str| -> Option<String> {
        for line in ics_data.lines() {
            let line = line.trim();
            // Handle properties with parameters like "DTSTART;TZID=..."
            if line.starts_with(name) {
                if let Some(colon_pos) = line.find(':') {
                    return Some(line[colon_pos + 1..].to_string());
                }
            }
        }
        None
    };

    // Get METHOD from calendar level
    let method = get_property("METHOD");

    // Extract VEVENT block
    let event_start = ics_data.find("BEGIN:VEVENT")?;
    let event_end = ics_data.find("END:VEVENT")?;
    let event_block = &ics_data[event_start..event_end];

    // Helper to get property from event block
    let get_event_property = |name: &str| -> Option<String> {
        for line in event_block.lines() {
            let line = line.trim();
            if line.starts_with(name) {
                if let Some(colon_pos) = line.find(':') {
                    return Some(line[colon_pos + 1..].to_string());
                }
            }
        }
        None
    };

    let title = get_event_property("SUMMARY").unwrap_or_else(|| "(No title)".to_string());
    let uid = get_event_property("UID");
    let location = get_event_property("LOCATION");
    let description = get_event_property("DESCRIPTION");
    let status = get_event_property("STATUS");

    // Parse DTSTART
    let dtstart = get_event_property("DTSTART")?;
    let (start_time, all_day) = parse_ics_datetime(&dtstart)?;

    // Parse DTEND (optional)
    let end_time = get_event_property("DTEND")
        .and_then(|s| parse_ics_datetime(&s))
        .map(|(ts, _)| ts);

    // Parse ORGANIZER (remove mailto: prefix)
    let organizer = get_event_property("ORGANIZER").map(|s| {
        s.strip_prefix("mailto:").unwrap_or(&s).to_string()
    });

    // Parse ATTENDEE lines
    let attendees: Vec<String> = event_block
        .lines()
        .filter(|line| line.trim().starts_with("ATTENDEE"))
        .filter_map(|line| {
            line.find(':').map(|pos| {
                line[pos + 1..].strip_prefix("mailto:").unwrap_or(&line[pos + 1..]).to_string()
            })
        })
        .collect();

    Some(CalendarEvent {
        uid,
        title,
        start_time,
        end_time,
        all_day,
        location,
        description,
        organizer,
        attendees,
        method,
        status,
        response_status: None, // Will be fetched from Calendar API
    })
}

/// Parse an ICS datetime string (e.g., "20240115T100000Z" or "20240115")
/// Returns (timestamp_millis, is_all_day)
fn parse_ics_datetime(s: &str) -> Option<(i64, bool)> {
    let s = s.trim();

    // All-day event (just date, no time)
    if s.len() == 8 && !s.contains('T') {
        // Format: YYYYMMDD
        let year: i32 = s[0..4].parse().ok()?;
        let month: u32 = s[4..6].parse().ok()?;
        let day: u32 = s[6..8].parse().ok()?;
        let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
        let datetime = date.and_hms_opt(0, 0, 0)?;
        let utc = DateTime::<Utc>::from_naive_utc_and_offset(datetime, Utc);
        return Some((utc.timestamp_millis(), true));
    }

    // Full datetime with T separator
    if s.contains('T') {
        // Format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
        let is_utc = s.ends_with('Z');
        let s = s.trim_end_matches('Z');

        if s.len() >= 15 {
            let year: i32 = s[0..4].parse().ok()?;
            let month: u32 = s[4..6].parse().ok()?;
            let day: u32 = s[6..8].parse().ok()?;
            let hour: u32 = s[9..11].parse().ok()?;
            let min: u32 = s[11..13].parse().ok()?;
            let sec: u32 = s[13..15].parse().ok()?;

            let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
            let time = chrono::NaiveTime::from_hms_opt(hour, min, sec)?;
            let datetime = chrono::NaiveDateTime::new(date, time);

            let utc = if is_utc {
                DateTime::<Utc>::from_naive_utc_and_offset(datetime, Utc)
            } else {
                // Assume local time, convert to UTC
                let local = chrono::Local::now().timezone();
                let local_dt = datetime.and_local_timezone(local).single()?;
                local_dt.with_timezone(&Utc)
            };

            return Some((utc.timestamp_millis(), false));
        }
    }

    None
}

/// Represents attachment metadata extracted from message parts
struct AttachmentInfo {
    attachment_id: String,
    filename: String,
    mime_type: String,
    size: i32,
}

fn extract_attachments_from_parts(parts: &Option<Vec<MessagePart>>) -> Vec<AttachmentInfo> {
    let mut attachments = Vec::new();
    if let Some(parts) = parts {
        for part in parts {
            // Check if this part has a filename and attachmentId (real attachment)
            if let Some(filename) = &part.filename {
                if !filename.is_empty() {
                    if let Some(body) = &part.body {
                        if let Some(attachment_id) = &body.attachment_id {
                            let size = body.size.unwrap_or(0);
                            if size > 0 {
                                attachments.push(AttachmentInfo {
                                    attachment_id: attachment_id.clone(),
                                    filename: filename.clone(),
                                    mime_type: part.mime_type.clone(),
                                    size,
                                });
                            }
                        }
                    }
                }
            }
            // Recursively check nested parts
            attachments.extend(extract_attachments_from_parts(&part.parts));
        }
    }
    attachments
}

fn classify_date(date: DateTime<Utc>) -> DateBucket {
    let now = Local::now();
    let local_date = date.with_timezone(&Local);

    let today = now.date_naive();
    let msg_date = local_date.date_naive();

    if msg_date == today {
        return DateBucket::Today;
    }

    let yesterday = today - Duration::days(1);
    if msg_date == yesterday {
        return DateBucket::Yesterday;
    }

    // Start of current week (Monday)
    let days_since_monday = now.weekday().num_days_from_monday() as i64;
    let week_start = today - Duration::days(days_since_monday);

    if msg_date >= week_start {
        return DateBucket::ThisWeek;
    }

    let thirty_days_ago = today - Duration::days(30);
    if msg_date >= thirty_days_ago {
        return DateBucket::Last30Days;
    }

    DateBucket::Older
}

fn group_threads_by_date(threads: Vec<Thread>) -> Vec<ThreadGroup> {
    let mut groups: HashMap<String, Vec<Thread>> = HashMap::new();

    for thread in threads {
        let bucket = classify_date(thread.last_message_date);
        let label = bucket.as_str().to_string();
        groups.entry(label).or_default().push(thread);
    }

    // Order: Today, Yesterday, This week, Last 30 days, Older
    let order = ["Today", "Yesterday", "This week", "Last 30 days", "Older"];

    order
        .iter()
        .filter_map(|&label| {
            groups.remove(label).map(|mut threads| {
                threads.sort_by(|a, b| b.last_message_date.cmp(&a.last_message_date));
                ThreadGroup {
                    label: label.to_string(),
                    threads,
                }
            })
        })
        .collect()
}

/// Get the user's RSVP status for a calendar event from Calendar API
/// Returns the response status: "accepted", "tentative", "declined", "needsAction", or None
pub async fn get_calendar_event_status(
    client: &GmailClient,
    user_email: &str,
    event_uid: &str,
) -> Option<String> {
    let search_url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?iCalUID={}",
        urlencoding::encode(event_uid)
    );

    let response = client
        .client
        .get(&search_url)
        .bearer_auth(&client.access_token)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct EventsResponse {
        items: Option<Vec<CalendarEventItem>>,
    }

    #[derive(Deserialize)]
    struct CalendarEventItem {
        attendees: Option<Vec<Attendee>>,
    }

    #[derive(Deserialize)]
    struct Attendee {
        email: String,
        #[serde(rename = "responseStatus")]
        response_status: Option<String>,
    }

    let events_response: EventsResponse = response.json().await.ok()?;
    let items = events_response.items?;
    let event = items.first()?;
    let attendees = event.attendees.as_ref()?;

    // Find the current user's response status
    for attendee in attendees {
        if attendee.email.to_lowercase() == user_email.to_lowercase() {
            return attendee.response_status.clone();
        }
    }

    None
}

/// Send RSVP response to a calendar event via Google Calendar API
/// status should be "accepted", "tentative", or "declined"
pub async fn rsvp_calendar_event(
    client: &GmailClient,
    user_email: &str,
    event_uid: &str,
    status: &str,
) -> Result<(), String> {
    // First, find the event by iCalUID
    let search_url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?iCalUID={}",
        urlencoding::encode(event_uid)
    );

    let response = client
        .client
        .get(&search_url)
        .bearer_auth(&client.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to find calendar event: {}", error_text));
    }

    #[derive(Deserialize)]
    struct EventsResponse {
        items: Option<Vec<CalendarEventItem>>,
    }

    #[derive(Deserialize)]
    struct CalendarEventItem {
        id: String,
        attendees: Option<Vec<Attendee>>,
    }

    #[derive(Deserialize, Serialize, Clone)]
    struct Attendee {
        email: String,
        #[serde(rename = "responseStatus", skip_serializing_if = "Option::is_none")]
        response_status: Option<String>,
        #[serde(rename = "self", skip_serializing_if = "Option::is_none")]
        is_self: Option<bool>,
    }

    let events_response: EventsResponse = response.json().await.map_err(|e| e.to_string())?;
    let items = events_response.items.unwrap_or_default();

    if items.is_empty() {
        return Err("Calendar event not found".to_string());
    }

    let event = &items[0];
    let event_id = &event.id;

    // Update attendee status
    let mut attendees: Vec<Attendee> = event.attendees.clone().unwrap_or_default();
    let mut found_self = false;

    for attendee in attendees.iter_mut() {
        if attendee.email.to_lowercase() == user_email.to_lowercase() {
            attendee.response_status = Some(status.to_string());
            found_self = true;
            break;
        }
    }

    if !found_self {
        // Add ourselves as an attendee
        attendees.push(Attendee {
            email: user_email.to_string(),
            response_status: Some(status.to_string()),
            is_self: Some(true),
        });
    }

    // Patch the event with updated attendees
    let patch_url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/{}?sendUpdates=all",
        event_id
    );

    #[derive(Serialize)]
    struct PatchRequest {
        attendees: Vec<Attendee>,
    }

    let patch_body = PatchRequest { attendees };

    let patch_response = client
        .client
        .patch(&patch_url)
        .bearer_auth(&client.access_token)
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !patch_response.status().is_success() {
        let error_text = patch_response.text().await.unwrap_or_default();
        return Err(format!("Failed to update RSVP: {}", error_text));
    }

    Ok(())
}
