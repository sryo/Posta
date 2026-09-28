// Gmail REST API client

use crate::models::{Attachment, CalendarEvent, DateBucket, SendAttachment, Thread, ThreadGroup};
use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Error returned by get_history_changes when the start history ID is too old
pub const HISTORY_EXPIRED: &str = "History ID expired";
const GMAIL_API_BASE: &str = "https://gmail.googleapis.com/gmail/v1";
const BATCH_API_ENDPOINT: &str = "https://www.googleapis.com/batch/gmail/v1";
const PAGE_SIZE: usize = 20;
const MAX_BATCH_SIZE: usize = 50; // Gmail allows up to 100, but 50 is safer
const MAX_INLINE_IMAGE_SIZE: i32 = 100_000; // 100KB max for inline images
const MAX_INLINE_IMAGES: usize = 3;
/// Threads of a batch whose attachments are loaded at the same time
const THREAD_LOAD_CONCURRENCY: usize = 5;

/// Partial-response fields for thread list entries: message headers and the
/// part tree (with part headers, for Content-ID) three levels deep, without bodies
const THREAD_SUMMARY_FIELDS: &str = concat!(
    "id,messages(id,labelIds,snippet,internalDate,payload(headers,mimeType,",
    "parts(mimeType,filename,headers,body(size,attachmentId),",
    "parts(mimeType,filename,headers,body(size,attachmentId),",
    "parts(mimeType,filename,headers,body(size,attachmentId))))))"
);

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
struct ThreadRef {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ThreadDetail {
    id: String,
    messages: Option<Vec<MessageDetail>>,
}

#[derive(Debug, Deserialize)]
struct MessageDetail {
    id: String,
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
    /// Set when this message is an emoji reaction to another message
    #[serde(default)]
    pub reaction: Option<ParsedReaction>,
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
    #[serde(rename(deserialize = "type"))]
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

/// Turn a non-2xx response into an "API error <status>: <body>" error.
/// Callers match on that text (e.g. "API error 404", "401").
async fn ensure_success(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(format!("API error {}: {}", status, body))
}

impl GmailClient {
    pub fn new(access_token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            access_token,
        }
    }

    /// Search threads with a custom limit (for preview)
    pub async fn search_threads_limited(&self, query: &str, max_results: usize) -> Result<Vec<ThreadGroup>, String> {
        Ok(self.search_threads(query, max_results, None).await?.groups)
    }

    pub async fn search_threads_paginated(&self, query: &str, page_token: Option<&str>) -> Result<SearchResult, String> {
        self.search_threads(query, PAGE_SIZE, page_token).await
    }

    async fn search_threads(
        &self,
        query: &str,
        max_results: usize,
        page_token: Option<&str>,
    ) -> Result<SearchResult, String> {
        let mut url = format!(
            "{}/users/me/threads?q={}&maxResults={}",
            GMAIL_API_BASE,
            urlencoding::encode(query),
            max_results
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

        let list: ThreadListResponse = ensure_success(resp)
            .await?
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let thread_ids: Vec<String> = list.threads.unwrap_or_default().into_iter().map(|t| t.id).collect();
        if thread_ids.is_empty() {
            return Ok(SearchResult {
                groups: Vec::new(),
                next_page_token: None,
                has_more: false,
            });
        }

        let threads = self.batch_get_thread_details(&thread_ids).await?;
        Ok(SearchResult {
            groups: group_threads_by_date(threads, &Local::now()),
            has_more: list.next_page_token.is_some(),
            next_page_token: list.next_page_token,
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

        let resp = ensure_success(resp).await?;

        let mut thread: FullThread = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse thread: {}", e))?;

        for message in &mut thread.messages {
            message.reaction = parse_reaction_from_message(message);
        }

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

        ensure_success(resp).await?;

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

        let resp = ensure_success(resp).await?;

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
        let url = format!(
            "{}/users/me/threads/{}?format=full&fields={}",
            GMAIL_API_BASE, thread_id, THREAD_SUMMARY_FIELDS
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let resp = ensure_success(resp).await?;

        let detail: ThreadDetail = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse thread: {}", e))?;

        Ok(self.thread_detail_to_thread(detail).await)
    }

    /// Batch fetch thread details for multiple thread IDs
    /// This is much more efficient than fetching one at a time
    pub async fn batch_get_thread_details(&self, thread_ids: &[String]) -> Result<Vec<Thread>, String> {
        if thread_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut all_threads = Vec::new();

        // Process in chunks of MAX_BATCH_SIZE
        for chunk in thread_ids.chunks(MAX_BATCH_SIZE) {
            let missing: Vec<String> = match self.execute_batch_thread_fetch(chunk).await {
                Ok(threads) => {
                    // Individual sub-responses can fail (429/5xx) even when the
                    // batch itself succeeds; retry those threads sequentially
                    let fetched: HashSet<&str> =
                        threads.iter().map(|t| t.gmail_thread_id.as_str()).collect();
                    let missing = chunk
                        .iter()
                        .filter(|id| !fetched.contains(id.as_str()))
                        .cloned()
                        .collect();
                    all_threads.extend(threads);
                    missing
                }
                Err(e) => {
                    tracing::warn!("Batch fetch failed, falling back to sequential: {}", e);
                    chunk.to_vec()
                }
            };

            for thread_id in &missing {
                match self.get_thread_detail(thread_id).await {
                    Ok(thread) => all_threads.push(thread),
                    // 404 means the thread was deleted after being listed; anything
                    // else must fail the whole call so callers don't treat the
                    // result as complete (incremental sync would otherwise advance
                    // the history ID past a change it never fetched)
                    Err(e) if e.contains("API error 404") => {
                        tracing::warn!("Thread {} no longer exists, skipping", thread_id);
                    }
                    Err(e) => return Err(format!("Failed to fetch thread {}: {}", thread_id, e)),
                }
            }
        }

        Ok(all_threads)
    }

    /// Execute a single batch request for thread details
    async fn execute_batch_thread_fetch(&self, thread_ids: &[String]) -> Result<Vec<Thread>, String> {
        let boundary = format!("batch_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));

        // Build multipart request body
        let mut body = String::new();

        for (i, thread_id) in thread_ids.iter().enumerate() {
            body.push_str(&format!("--{}\r\n", boundary));
            body.push_str("Content-Type: application/http\r\n");
            body.push_str(&format!("Content-ID: <item{}>\r\n\r\n", i));
            body.push_str(&format!(
                "GET /gmail/v1/users/me/threads/{}?format=full&fields={} HTTP/1.1\r\n\r\n",
                thread_id, THREAD_SUMMARY_FIELDS
            ));
        }
        body.push_str(&format!("--{}--\r\n", boundary));

        let resp = self
            .client
            .post(BATCH_API_ENDPOINT)
            .bearer_auth(&self.access_token)
            .header("Content-Type", format!("multipart/mixed; boundary={}", boundary))
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Batch request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Batch API error {}: {}", status, body));
        }

        // Get the response boundary from Content-Type header (must extract before consuming body)
        let resp_boundary = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .and_then(batch_boundary)
            .ok_or("Missing boundary in response")?;

        let resp_body = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

        use futures::StreamExt;
        let threads = futures::stream::iter(parse_batch_body(&resp_body, &resp_boundary))
            .map(|detail| self.thread_detail_to_thread(detail))
            .buffered(THREAD_LOAD_CONCURRENCY)
            .collect()
            .await;
        Ok(threads)
    }

    async fn thread_detail_to_thread(&self, detail: ThreadDetail) -> Thread {
        let mut thread = thread_summary(detail);
        let calendar_attachments: Vec<Attachment> =
            thread.attachments.iter().filter(|a| a.is_calendar()).cloned().collect();
        let (_, calendar_event) = futures::join!(
            self.load_inline_images(&mut thread.attachments),
            self.load_calendar_event(&calendar_attachments)
        );
        thread.calendar_event = calendar_event;
        thread
    }

    /// Fetch the data of the first few small images so the list can show them
    async fn load_inline_images(&self, attachments: &mut [Attachment]) {
        let images = attachments
            .iter_mut()
            .filter(|a| a.mime_type.starts_with("image/") && a.size < MAX_INLINE_IMAGE_SIZE)
            .take(MAX_INLINE_IMAGES);
        futures::future::join_all(images.map(|attachment| async move {
            match self.get_attachment(&attachment.message_id, &attachment.attachment_id).await {
                Ok(data) => attachment.inline_data = Some(data),
                Err(e) => tracing::warn!("Failed to fetch attachment {}: {}", attachment.filename, e),
            }
        }))
        .await;
    }

    /// The event of the first calendar attachment that parses
    async fn load_calendar_event(&self, attachments: &[Attachment]) -> Option<CalendarEvent> {
        for attachment in attachments {
            match self.get_attachment(&attachment.message_id, &attachment.attachment_id).await {
                Ok(data) => {
                    if let Some(event) = decode_base64_body(&data).and_then(|ics| parse_ics_content(&ics)) {
                        return Some(event);
                    }
                }
                Err(e) => tracing::warn!("Failed to fetch calendar attachment: {}", e),
            }
        }
        None
    }

    pub async fn send_email(&self, message: &OutgoingMessage<'_>) -> Result<(), String> {
        self.send_raw(&build_mime_message(message, None), None).await
    }

    /// Reply in `thread_id`; `message_id` is the message replied to, as its
    /// Message-ID header value or Gmail id (the latest message when absent)
    pub async fn reply_to_thread(
        &self,
        thread_id: &str,
        message_id: Option<&str>,
        message: &OutgoingMessage<'_>,
    ) -> Result<(), String> {
        let reply_headers = self.resolve_reply_headers(thread_id, message_id).await;
        let raw = build_mime_message(message, reply_headers.as_ref());
        self.send_raw(&raw, Some(thread_id)).await
    }

    async fn send_raw(&self, message: &str, thread_id: Option<&str>) -> Result<(), String> {
        let url = format!("{}/users/me/messages/send", GMAIL_API_BASE);

        let mut request_body = serde_json::json!({ "raw": encode_raw_message(message) });
        if let Some(tid) = thread_id {
            request_body["threadId"] = serde_json::json!(tid);
        }

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        ensure_success(resp).await?;

        Ok(())
    }

    /// Resolve RFC 5322 threading headers (In-Reply-To, References) for a reply.
    ///
    /// `message_id` may be a real Message-ID header value or a Gmail API hex id;
    /// for the latter (or when absent) the parent's headers are fetched from the
    /// thread. Returns None when no usable Message-ID can be found - Gmail-side
    /// threading still works via the threadId field.
    async fn resolve_reply_headers(
        &self,
        thread_id: &str,
        message_id: Option<&str>,
    ) -> Option<(String, String)> {
        if let Some(id) = message_id {
            if id.contains('@') {
                let bracketed = ensure_angle_brackets(id);
                return Some((bracketed.clone(), bracketed));
            }
        }

        let thread = self.get_thread_metadata(&thread_reply_metadata_url(thread_id)).await.ok()?;
        reply_headers_from_thread(&thread, message_id)
    }

    /// A thread fetched with a thread_metadata_url
    async fn get_thread_metadata(&self, url: &str) -> Result<FullThread, String> {
        let resp = self
            .client
            .get(url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;
        ensure_success(resp)
            .await?
            .json()
            .await
            .map_err(|e| format!("Failed to parse thread: {}", e))
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

        let resp = ensure_success(resp).await?;

        let response: ListLabelsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse labels: {}", e))?;

        Ok(response.labels.unwrap_or_default())
    }

    pub async fn create_draft(
        &self,
        message: &OutgoingMessage<'_>,
        thread_id: Option<&str>,
    ) -> Result<GmailDraft, String> {
        let url = format!("{}/users/me/drafts", GMAIL_API_BASE);
        self.upsert_draft(self.client.post(&url), message, thread_id).await
    }

    pub async fn update_draft(
        &self,
        draft_id: &str,
        message: &OutgoingMessage<'_>,
        thread_id: Option<&str>,
    ) -> Result<GmailDraft, String> {
        let url = format!("{}/users/me/drafts/{}", GMAIL_API_BASE, draft_id);
        self.upsert_draft(self.client.put(&url), message, thread_id).await
    }

    async fn upsert_draft(
        &self,
        request: reqwest::RequestBuilder,
        message: &OutgoingMessage<'_>,
        thread_id: Option<&str>,
    ) -> Result<GmailDraft, String> {
        // Gmail only files a draft into a thread when it carries the RFC 2822
        // threading headers, not just the threadId
        let reply_headers = match thread_id {
            Some(tid) => self.resolve_reply_headers(tid, None).await,
            None => None,
        };

        let mut request_body = serde_json::json!({
            "message": {
                "raw": encode_raw_message(&build_mime_message(message, reply_headers.as_ref()))
            }
        });

        if let Some(tid) = thread_id {
            request_body["message"]["threadId"] = serde_json::json!(tid);
        }

        let resp = request
            .bearer_auth(&self.access_token)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let resp = ensure_success(resp).await?;

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse draft: {}", e))
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

        ensure_success(resp).await?;

        Ok(())
    }

    // ============ History API for Incremental Sync ============

    /// Get the current history ID from the user's profile
    pub async fn get_current_history_id(&self) -> Result<String, String> {
        let url = format!("{}/users/me/profile", GMAIL_API_BASE);

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let resp = ensure_success(resp).await?;

        #[derive(Deserialize)]
        struct Profile {
            #[serde(rename = "historyId")]
            history_id: String,
        }

        let profile: Profile = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse profile: {}", e))?;

        Ok(profile.history_id)
    }

    /// Get changes since a given history ID
    /// Returns thread IDs that were modified or deleted
    pub async fn get_history_changes(&self, start_history_id: &str) -> Result<HistoryChanges, String> {
        let mut all_modified_thread_ids = HashSet::new();
        let mut deleted_candidate_thread_ids = HashSet::new();
        let mut all_deleted_message_ids = HashSet::new();
        let mut new_history_id;
        let mut page_token: Option<String> = None;

        loop {
            let mut url = format!(
                "{}/users/me/history?startHistoryId={}&historyTypes=messageAdded&historyTypes=messageDeleted&historyTypes=labelAdded&historyTypes=labelRemoved",
                GMAIL_API_BASE,
                start_history_id
            );

            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={}", urlencoding::encode(token)));
            }

            let resp = self
                .client
                .get(&url)
                .bearer_auth(&self.access_token)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            if resp.status().as_u16() == 404 {
                // History ID is too old or invalid - caller should do full sync
                return Err(HISTORY_EXPIRED.to_string());
            }

            let resp = ensure_success(resp).await?;

            let history_resp: HistoryListResponse = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse history: {}", e))?;

            new_history_id = history_resp.history_id;

            if let Some(history_items) = history_resp.history {
                for item in history_items {
                    // Messages added - track their thread IDs
                    if let Some(messages_added) = item.messages_added {
                        for msg in messages_added {
                            if let Some(thread_id) = msg.message.thread_id {
                                all_modified_thread_ids.insert(thread_id);
                            }
                        }
                    }

                    // Messages deleted - the thread is only a deletion *candidate*:
                    // it may still exist if it has other messages
                    if let Some(messages_deleted) = item.messages_deleted {
                        for msg in messages_deleted {
                            all_deleted_message_ids.insert(msg.message.id);
                            if let Some(thread_id) = msg.message.thread_id {
                                deleted_candidate_thread_ids.insert(thread_id);
                            }
                        }
                    }

                    // Labels added/removed - these affect thread state
                    if let Some(labels_added) = item.labels_added {
                        for event in labels_added {
                            if let Some(thread_id) = event.message.thread_id {
                                all_modified_thread_ids.insert(thread_id);
                            }
                        }
                    }

                    if let Some(labels_removed) = item.labels_removed {
                        for event in labels_removed {
                            if let Some(thread_id) = event.message.thread_id {
                                all_modified_thread_ids.insert(thread_id);
                            }
                        }
                    }
                }
            }

            match history_resp.next_page_token {
                Some(token) => page_token = Some(token),
                None => break,
            }
        }

        // A thread that also saw additions or label changes still exists - keep it
        // in the modified set only
        let deleted_thread_ids: Vec<String> = deleted_candidate_thread_ids
            .difference(&all_modified_thread_ids)
            .cloned()
            .collect();

        Ok(HistoryChanges {
            modified_thread_ids: all_modified_thread_ids.into_iter().collect(),
            deleted_thread_ids,
            deleted_message_ids: all_deleted_message_ids.into_iter().collect(),
            new_history_id,
        })
    }

    /// Check whether a thread still exists (false when the API returns 404)
    pub async fn thread_exists(&self, thread_id: &str) -> Result<bool, String> {
        let url = format!(
            "{}/users/me/threads/{}?format=minimal&fields=id",
            GMAIL_API_BASE, thread_id
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.status().as_u16() == 404 {
            return Ok(false);
        }

        ensure_success(resp).await?;

        Ok(true)
    }
}

// History API response types
#[derive(Debug, Deserialize)]
struct HistoryListResponse {
    history: Option<Vec<HistoryItem>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(rename = "historyId")]
    history_id: String,
}

#[derive(Debug, Deserialize)]
struct HistoryItem {
    #[serde(rename = "messagesAdded")]
    messages_added: Option<Vec<MessageAddedEvent>>,
    #[serde(rename = "messagesDeleted")]
    messages_deleted: Option<Vec<MessageDeletedEvent>>,
    #[serde(rename = "labelsAdded")]
    labels_added: Option<Vec<LabelEvent>>,
    #[serde(rename = "labelsRemoved")]
    labels_removed: Option<Vec<LabelEvent>>,
}

#[derive(Debug, Deserialize)]
struct MessageAddedEvent {
    message: HistoryMessage,
}

#[derive(Debug, Deserialize)]
struct MessageDeletedEvent {
    message: HistoryMessage,
}

#[derive(Debug, Deserialize)]
struct LabelEvent {
    message: HistoryMessage,
}

#[derive(Debug, Deserialize)]
struct HistoryMessage {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
}

/// Result of getting history changes
#[derive(Debug, Serialize)]
pub struct HistoryChanges {
    pub modified_thread_ids: Vec<String>,
    /// Threads whose messages were deleted with no other activity; existence
    /// must still be verified before treating them as gone
    pub deleted_thread_ids: Vec<String>,
    pub deleted_message_ids: Vec<String>,
    pub new_history_id: String,
}

/// The `boundary` parameter of a multipart Content-Type header value
fn batch_boundary(content_type: &str) -> Option<String> {
    content_type.split(';').find_map(|param| {
        let (key, value) = param.split_once('=')?;
        key.trim()
            .eq_ignore_ascii_case("boundary")
            .then(|| value.trim().trim_matches('"').to_string())
    })
}

/// Thread details from a Gmail batch response. Each part wraps an HTTP
/// response whose JSON body follows the first blank line after the status
/// line; sub-requests that failed (e.g. 429) carry an error body and are
/// skipped so the caller can retry them.
fn parse_batch_body(body: &str, boundary: &str) -> Vec<ThreadDetail> {
    let delimiter = format!("--{}", boundary);
    body.split(&delimiter)
        .skip(1)
        .filter_map(|part| {
            let json_start = part.find("\r\n\r\n{").map(|i| i + 4)
                .or_else(|| part.find("\n\n{").map(|i| i + 2))?;
            let json_part = &part[json_start..];
            let json_str = &json_part[..=json_part.rfind('}')?];
            serde_json::from_str::<ThreadDetail>(json_str)
                .map_err(|e| tracing::warn!("Failed to parse thread from batch: {}", e))
                .ok()
        })
        .collect()
}

fn extract_email_address(from: &str) -> String {
    // Parse "Name <email@example.com>" format - extract the email part. The
    // address is the last bracketed group; the display name may contain '<' or '>'
    if let Some(start) = from.rfind('<') {
        if let Some(len) = from[start..].find('>') {
            return from[start + 1..start + len].trim().to_string();
        }
    }
    // Already just an email address
    from.trim().to_string()
}

/// A thread list entry built from a summary fetch, before any attachment data
/// (inline images, calendar invites) is loaded
fn thread_summary(detail: ThreadDetail) -> Thread {
    let messages = detail.messages.unwrap_or_default();
    let latest = messages.last();
    // A reaction's subject is "Re: <emoji>" and its snippet "Reacted with ..."
    let latest_content = messages.iter().rev().find(|m| !is_reaction_summary(m)).or(latest);

    let subject = latest_content
        .and_then(|m| m.payload.as_ref())
        .and_then(|p| find_header(p.headers.as_deref(), "Subject"))
        .map(str::to_string)
        .unwrap_or_else(|| "(No Subject)".to_string());

    let snippet = latest_content.and_then(|m| m.snippet.clone()).unwrap_or_default();

    let last_message_date = latest
        .and_then(|m| m.internal_date.as_ref())
        .and_then(|d| d.parse::<i64>().ok())
        .and_then(DateTime::from_timestamp_millis)
        .unwrap_or_else(Utc::now);

    let unread_count = messages
        .iter()
        .filter(|m| m.label_ids.as_ref().is_some_and(|labels| labels.iter().any(|l| l == "UNREAD")))
        .count() as i32;

    let attachments: Vec<Attachment> = messages
        .iter()
        .flat_map(|msg| {
            let parts = msg.payload.as_ref().map(|p| &p.parts).unwrap_or(&None);
            extract_attachments_from_parts(parts).into_iter().map(|info| Attachment {
                message_id: msg.id.clone(),
                attachment_id: info.attachment_id,
                filename: info.filename,
                mime_type: info.mime_type,
                size: info.size,
                inline_data: None,
                content_id: info.content_id,
            })
        })
        .collect();

    Thread {
        gmail_thread_id: detail.id,
        account_id: String::new(),
        subject,
        snippet,
        last_message_date,
        unread_count,
        labels: thread_labels(&messages),
        participants: thread_participants(&messages),
        has_attachment: !attachments.is_empty(),
        attachments,
        calendar_event: None,
    }
}

fn is_reaction_summary(message: &MessageDetail) -> bool {
    fn has_reaction_part(parts: &[MessagePart]) -> bool {
        parts.iter().any(|p| {
            p.mime_type == REACTION_MIME_TYPE || p.parts.as_deref().is_some_and(has_reaction_part)
        })
    }
    message.payload.as_ref().is_some_and(|p| {
        p.mime_type.as_deref() == Some(REACTION_MIME_TYPE)
            || p.parts.as_deref().is_some_and(has_reaction_part)
    })
}

/// Thread-level labels as Gmail defines them: a thread carries a label when any
/// of its messages does (the latest message alone may be a reply with only SENT)
fn thread_labels(messages: &[MessageDetail]) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    for label in messages.iter().filter_map(|m| m.label_ids.as_ref()).flatten() {
        if !labels.contains(label) {
            labels.push(label.clone());
        }
    }
    labels
}

/// Sender addresses in first-seen order, without duplicates
fn thread_participants(messages: &[MessageDetail]) -> Vec<String> {
    let mut participants: Vec<String> = Vec::new();
    for message in messages {
        let from = message
            .payload
            .as_ref()
            .and_then(|p| find_header(p.headers.as_deref(), "From"));
        if let Some(from) = from {
            let email = extract_email_address(from);
            if !participants.iter().any(|p| p.eq_ignore_ascii_case(&email)) {
                participants.push(email);
            }
        }
    }
    participants
}

/// A thread's messages with only the headers `header_names`, without bodies
fn thread_metadata_url(thread_id: &str, header_names: &[&str]) -> String {
    let headers: String = header_names
        .iter()
        .map(|name| format!("&metadataHeaders={}", name))
        .collect();
    format!(
        "{}/users/me/threads/{}?format=metadata{}&fields=id,messages(id,threadId,labelIds,payload/headers)",
        GMAIL_API_BASE, thread_id, headers
    )
}

/// The headers reply_headers_from_thread needs, so resolving them (on every
/// draft autosave) does not download bodies
fn thread_reply_metadata_url(thread_id: &str) -> String {
    thread_metadata_url(thread_id, &["Message-ID", "References"])
}

/// The headers that find, vet (check_can_react) and thread a reaction's target
fn reaction_metadata_url(thread_id: &str) -> String {
    thread_metadata_url(
        thread_id,
        &["Message-ID", "References", "To", "Cc", "List-Id", "List-Unsubscribe", "Precedence"],
    )
}

/// Threading headers (In-Reply-To, References) for a reply to `thread`.
/// The parent is the message with Gmail id `message_id`, or else the latest
/// message that is not a draft (the reply's own saved draft is in the thread).
fn reply_headers_from_thread(
    thread: &FullThread,
    message_id: Option<&str>,
) -> Option<(String, String)> {
    let is_draft = |m: &FullMessage| {
        m.label_ids
            .as_ref()
            .is_some_and(|labels| labels.iter().any(|l| l == "DRAFT"))
    };
    let parent = message_id
        .and_then(|id| thread.messages.iter().find(|m| m.id == id))
        .or_else(|| thread.messages.iter().rev().find(|m| !is_draft(m)))?;
    let headers = parent.payload.as_ref()?.headers.as_deref();

    let parent_message_id = ensure_angle_brackets(find_header(headers, "Message-ID")?);
    let references = match find_header(headers, "References").map(str::trim) {
        Some(parent_references) if !parent_references.is_empty() => {
            format!("{} {}", parent_references, parent_message_id)
        }
        _ => parent_message_id.clone(),
    };

    Some((parent_message_id, references))
}

fn find_header<'a>(headers: Option<&'a [Header]>, name: &str) -> Option<&'a str> {
    headers?
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

/// Check that `line` is property `name`, i.e. the name is followed by ':' or ';'
/// (a bare prefix match would let DTSTART match DTSTAMP and vice versa)
fn ics_property_matches(line: &str, name: &str) -> bool {
    line.starts_with(name)
        && matches!(line.as_bytes().get(name.len()), Some(b':') | Some(b';'))
}

/// Join RFC 5545 folded lines (a CRLF followed by a space or tab continues the
/// previous line) and return the logical content lines
fn unfold_ics_lines(ics_data: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in ics_data.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        match (raw.strip_prefix([' ', '\t']), lines.last_mut()) {
            (Some(continuation), Some(last)) => last.push_str(continuation),
            _ => lines.push(raw.to_string()),
        }
    }
    lines
}

/// Find property `name` among `lines` and return its (parameters, value).
/// For "DTSTART;TZID=America/New_York:20240115T100000" that is
/// ("TZID=America/New_York", "20240115T100000"); parameters are empty when absent.
fn find_ics_property(lines: &[&str], name: &str) -> Option<(String, String)> {
    lines.iter().find_map(|line| {
        if !ics_property_matches(line, name) {
            return None;
        }
        // Parameter values may be quoted and contain ':' (e.g. CN="Doe: Jane")
        let mut in_quotes = false;
        let colon_pos = line.char_indices().find_map(|(i, c)| match c {
            '"' => {
                in_quotes = !in_quotes;
                None
            }
            ':' if !in_quotes => Some(i),
            _ => None,
        })?;
        let params = line[name.len()..colon_pos].trim_start_matches(';').to_string();
        Some((params, line[colon_pos + 1..].to_string()))
    })
}

fn find_ics_value(lines: &[&str], name: &str) -> Option<String> {
    find_ics_property(lines, name).map(|(_, value)| value)
}

/// Decode RFC 5545 TEXT escapes (\n, \, \; \\)
fn unescape_ics_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

fn strip_mailto(value: &str) -> String {
    match value.get(..7) {
        Some(prefix) if prefix.eq_ignore_ascii_case("mailto:") => value[7..].to_string(),
        _ => value.to_string(),
    }
}

/// Parse ICS calendar data and extract the first event
fn parse_ics_content(ics_data: &str) -> Option<CalendarEvent> {
    let unfolded = unfold_ics_lines(ics_data);
    let lines: Vec<&str> = unfolded.iter().map(|l| l.trim()).collect();

    let event_start = lines.iter().position(|l| *l == "BEGIN:VEVENT")?;
    let event_len = lines[event_start..].iter().position(|l| *l == "END:VEVENT")?;

    // Properties of the event itself, excluding nested components such as
    // VALARM whose DESCRIPTION would otherwise be taken for the event's
    let mut event_lines = Vec::new();
    let mut depth = 0usize;
    for line in &lines[event_start + 1..event_start + event_len] {
        if line.starts_with("BEGIN:") {
            depth += 1;
        } else if line.starts_with("END:") {
            depth = depth.saturating_sub(1);
        } else if depth == 0 {
            event_lines.push(*line);
        }
    }

    let method = find_ics_value(&lines[..event_start], "METHOD");
    let text = |name: &str| find_ics_value(&event_lines, name).map(|v| unescape_ics_text(&v));

    let title = text("SUMMARY").unwrap_or_else(|| "(No title)".to_string());
    let uid = find_ics_value(&event_lines, "UID");
    let location = text("LOCATION");
    let description = text("DESCRIPTION");
    let status = find_ics_value(&event_lines, "STATUS");

    let (dtstart_params, dtstart) = find_ics_property(&event_lines, "DTSTART")?;
    let (start_time, all_day) = parse_ics_datetime(&dtstart, &dtstart_params, &lines)?;

    let end_time = find_ics_property(&event_lines, "DTEND")
        .and_then(|(params, s)| parse_ics_datetime(&s, &params, &lines))
        .map(|(ts, _)| ts);

    let organizer = find_ics_value(&event_lines, "ORGANIZER").map(|s| strip_mailto(&s));

    let attendees: Vec<String> = event_lines
        .iter()
        .filter_map(|line| find_ics_value(&[*line], "ATTENDEE"))
        .map(|value| strip_mailto(&value))
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

/// Parse an ICS datetime string (e.g., "20240115T100000Z" or "20240115").
/// `params` are the property parameters (e.g. "TZID=America/New_York"); a
/// naive datetime is resolved in that zone (see resolve_ics_wall_time), and
/// `calendar` is every line of the calendar, for its VTIMEZONE definitions.
/// Returns (timestamp_millis, is_all_day)
fn parse_ics_datetime(s: &str, params: &str, calendar: &[&str]) -> Option<(i64, bool)> {
    let s = s.trim();
    // Byte-offset slicing below is only safe on ASCII
    if !s.is_ascii() {
        return None;
    }

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

    let is_utc = s.ends_with('Z');
    let datetime = parse_ics_naive_datetime(s.trim_end_matches('Z'))?;
    let utc = if is_utc {
        DateTime::<Utc>::from_naive_utc_and_offset(datetime, Utc)
    } else {
        let tzid = params
            .split(';')
            .find_map(|p| p.strip_prefix("TZID="))
            .map(|v| v.trim_matches('"'));
        resolve_ics_wall_time(datetime, tzid, calendar)?
    };
    Some((utc.timestamp_millis(), false))
}

/// "YYYYMMDDTHHMMSS" as a naive datetime
fn parse_ics_naive_datetime(s: &str) -> Option<chrono::NaiveDateTime> {
    if !s.is_ascii() || s.len() < 15 || s.as_bytes()[8] != b'T' {
        return None;
    }
    let date = chrono::NaiveDate::from_ymd_opt(s[0..4].parse().ok()?, s[4..6].parse().ok()?, s[6..8].parse().ok()?)?;
    let time = chrono::NaiveTime::from_hms_opt(s[9..11].parse().ok()?, s[11..13].parse().ok()?, s[13..15].parse().ok()?)?;
    Some(chrono::NaiveDateTime::new(date, time))
}

/// The instant a wall-clock time in the zone named `tzid` denotes. The name is
/// tried as an IANA zone, then as a Windows zone name (Outlook, Exchange), then
/// against the calendar's own VTIMEZONE rules; without a usable zone the time
/// is taken as machine-local.
fn resolve_ics_wall_time(
    datetime: chrono::NaiveDateTime,
    tzid: Option<&str>,
    calendar: &[&str],
) -> Option<DateTime<Utc>> {
    if let Some(tzid) = tzid {
        if let Some(tz) = named_zone(tzid) {
            return resolve_wall_time(&tz, datetime);
        }
        if let Some(offset) = vtimezone_offset(calendar, tzid, datetime) {
            let utc = datetime.checked_sub_signed(Duration::seconds(offset.into()))?;
            return Some(DateTime::from_naive_utc_and_offset(utc, Utc));
        }
    }
    resolve_wall_time(&Local, datetime)
}

fn named_zone(tzid: &str) -> Option<chrono_tz::Tz> {
    let tzid = tzid.trim();
    if let Ok(tz) = tzid.parse() {
        return Some(tz);
    }
    if let Some((_, iana)) = WINDOWS_ZONES.iter().find(|(windows, _)| windows.eq_ignore_ascii_case(tzid)) {
        return iana.parse().ok();
    }
    // Prefixed IANA ids such as "/mozilla.org/20050126_1/America/New_York"
    let segments: Vec<&str> = tzid.split('/').collect();
    (1..segments.len()).find_map(|i| segments[i..].join("/").parse().ok())
}

/// The instant a wall-clock time in `tz` denotes. A time repeated when clocks go
/// back is its first occurrence; a time skipped when they go forward is read
/// with the offset in force before the change (02:30 becomes 03:30).
fn resolve_wall_time<Tz: TimeZone>(tz: &Tz, datetime: chrono::NaiveDateTime) -> Option<DateTime<Utc>> {
    use chrono::Offset;
    if let Some(resolved) = tz.from_local_datetime(&datetime).earliest() {
        return Some(resolved.with_timezone(&Utc));
    }
    // Zones change offset at most once a day, so a day earlier is before the gap
    let offset_before = tz
        .offset_from_utc_datetime(&(datetime - Duration::days(1)))
        .fix()
        .local_minus_utc();
    let utc = datetime.checked_sub_signed(Duration::seconds(offset_before.into()))?;
    Some(DateTime::from_naive_utc_and_offset(utc, Utc))
}

/// The UTC offset in seconds that the VTIMEZONE `tzid` of `calendar` gives
/// wall-clock time `datetime`: the TZOFFSETTO of the observance (STANDARD or
/// DAYLIGHT) that began most recently. Yearly rules of the "nth weekday of a
/// month" kind are followed; other rules count only their first onset.
fn vtimezone_offset(calendar: &[&str], tzid: &str, datetime: chrono::NaiveDateTime) -> Option<i32> {
    let zone = ics_components(calendar, "VTIMEZONE")
        .into_iter()
        .find(|zone| find_ics_value(zone, "TZID").is_some_and(|id| id.trim_matches('"') == tzid))?;
    let observances: Vec<&[&str]> = ["STANDARD", "DAYLIGHT"]
        .iter()
        .flat_map(|kind| ics_components(zone, kind))
        .collect();

    let mut latest: Option<(chrono::NaiveDateTime, i32)> = None;
    let mut earliest: Option<(chrono::NaiveDateTime, i32)> = None;
    for observance in observances {
        let Some(start) = find_ics_value(observance, "DTSTART").and_then(|s| parse_ics_naive_datetime(&s)) else {
            continue;
        };
        let Some(offset_to) = find_ics_value(observance, "TZOFFSETTO").and_then(|s| parse_utc_offset(&s)) else {
            continue;
        };
        let offset_from = find_ics_value(observance, "TZOFFSETFROM")
            .and_then(|s| parse_utc_offset(&s))
            .unwrap_or(offset_to);
        let rule = find_ics_value(observance, "RRULE").and_then(|r| YearlyRule::parse(&r));
        let onsets: Vec<chrono::NaiveDateTime> = match &rule {
            Some(rule) => (datetime.year() - 1..=datetime.year())
                .filter_map(|year| rule.onset(year, start))
                .collect(),
            None => vec![start],
        };
        for onset in onsets {
            if onset <= datetime && latest.is_none_or(|(at, _)| onset > at) {
                latest = Some((onset, offset_to));
            }
        }
        if earliest.is_none_or(|(at, _)| start < at) {
            earliest = Some((start, offset_from));
        }
    }
    latest.or(earliest).map(|(_, offset)| offset)
}

/// The line ranges of each `kind` component directly inside `lines`
fn ics_components<'a, 'b>(lines: &'b [&'a str], kind: &str) -> Vec<&'b [&'a str]> {
    let begin = format!("BEGIN:{}", kind);
    let end = format!("END:{}", kind);
    let mut components = Vec::new();
    let mut rest = lines;
    while let Some(start) = rest.iter().position(|l| *l == begin) {
        let Some(len) = rest[start..].iter().position(|l| *l == end) else {
            break;
        };
        components.push(&rest[start + 1..start + len]);
        rest = &rest[start + len + 1..];
    }
    components
}

/// "+0530", "-0800" or "+053000" as seconds east of UTC
fn parse_utc_offset(value: &str) -> Option<i32> {
    let value = value.trim();
    let (sign, digits) = match value.as_bytes().first()? {
        b'+' => (1, &value[1..]),
        b'-' => (-1, &value[1..]),
        _ => return None,
    };
    if !(digits.len() == 4 || digits.len() == 6) || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let hours: i32 = digits[0..2].parse().ok()?;
    let minutes: i32 = digits[2..4].parse().ok()?;
    let seconds: i32 = digits.get(4..6).map_or(Some(0), |s| s.parse().ok())?;
    Some(sign * (hours * 3600 + minutes * 60 + seconds))
}

/// A VTIMEZONE recurrence "FREQ=YEARLY;BYMONTH=m;BYDAY=nDD", e.g. the second
/// Sunday of March (n = 2) or the last Sunday of October (n = -1)
struct YearlyRule {
    month: u32,
    weekday: chrono::Weekday,
    nth: i32,
    until: Option<chrono::NaiveDateTime>,
}

impl YearlyRule {
    fn parse(rrule: &str) -> Option<Self> {
        let parts: HashMap<String, &str> = rrule
            .split(';')
            .filter_map(|p| p.split_once('='))
            .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim()))
            .collect();
        if !parts.get("FREQ")?.eq_ignore_ascii_case("YEARLY") {
            return None;
        }
        let month: u32 = parts.get("BYMONTH")?.parse().ok()?;
        let byday = parts.get("BYDAY")?;
        if !byday.is_ascii() || byday.len() < 2 {
            return None;
        }
        let (nth, day) = byday.split_at(byday.len() - 2);
        let nth: i32 = if nth.is_empty() { 1 } else { nth.trim_start_matches('+').parse().ok()? };
        let weekday = match day.to_ascii_uppercase().as_str() {
            "MO" => chrono::Weekday::Mon,
            "TU" => chrono::Weekday::Tue,
            "WE" => chrono::Weekday::Wed,
            "TH" => chrono::Weekday::Thu,
            "FR" => chrono::Weekday::Fri,
            "SA" => chrono::Weekday::Sat,
            "SU" => chrono::Weekday::Sun,
            _ => return None,
        };
        let until = parts
            .get("UNTIL")
            .and_then(|u| parse_ics_naive_datetime(u.trim_end_matches('Z')));
        Some(Self { month, weekday, nth, until })
    }

    /// When the observance starts in `year`, at the time of day of `start`
    fn onset(&self, year: i32, start: chrono::NaiveDateTime) -> Option<chrono::NaiveDateTime> {
        let date = match self.nth {
            1..=5 => chrono::NaiveDate::from_weekday_of_month_opt(year, self.month, self.weekday, self.nth as u8),
            -1 => {
                let first_of_next = if self.month == 12 {
                    chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
                } else {
                    chrono::NaiveDate::from_ymd_opt(year, self.month + 1, 1)
                }?;
                let last = first_of_next.pred_opt()?;
                let back = (7 + last.weekday().num_days_from_monday() - self.weekday.num_days_from_monday()) % 7;
                last.checked_sub_signed(Duration::days(back.into()))
            }
            _ => None,
        }?;
        let onset = date.and_time(start.time());
        let in_range = onset >= start && self.until.is_none_or(|until| onset <= until);
        in_range.then_some(onset)
    }
}

/// Windows time zone names (as Outlook and Exchange write TZIDs) and the IANA
/// zone CLDR maps each one to
const WINDOWS_ZONES: &[(&str, &str)] = &[
    ("Dateline Standard Time", "Etc/GMT+12"),
    ("UTC-11", "Etc/GMT+11"),
    ("Aleutian Standard Time", "America/Adak"),
    ("Hawaiian Standard Time", "Pacific/Honolulu"),
    ("Marquesas Standard Time", "Pacific/Marquesas"),
    ("Alaskan Standard Time", "America/Anchorage"),
    ("UTC-09", "Etc/GMT+9"),
    ("Pacific Standard Time (Mexico)", "America/Tijuana"),
    ("UTC-08", "Etc/GMT+8"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("US Mountain Standard Time", "America/Phoenix"),
    ("Mountain Standard Time (Mexico)", "America/Mazatlan"),
    ("Mountain Standard Time", "America/Denver"),
    ("Yukon Standard Time", "America/Whitehorse"),
    ("Central America Standard Time", "America/Guatemala"),
    ("Central Standard Time", "America/Chicago"),
    ("Easter Island Standard Time", "Pacific/Easter"),
    ("Central Standard Time (Mexico)", "America/Mexico_City"),
    ("Canada Central Standard Time", "America/Regina"),
    ("SA Pacific Standard Time", "America/Bogota"),
    ("Eastern Standard Time (Mexico)", "America/Cancun"),
    ("Eastern Standard Time", "America/New_York"),
    ("Haiti Standard Time", "America/Port-au-Prince"),
    ("Cuba Standard Time", "America/Havana"),
    ("US Eastern Standard Time", "America/Indiana/Indianapolis"),
    ("Turks And Caicos Standard Time", "America/Grand_Turk"),
    ("Paraguay Standard Time", "America/Asuncion"),
    ("Atlantic Standard Time", "America/Halifax"),
    ("Venezuela Standard Time", "America/Caracas"),
    ("Central Brazilian Standard Time", "America/Cuiaba"),
    ("SA Western Standard Time", "America/La_Paz"),
    ("Pacific SA Standard Time", "America/Santiago"),
    ("Newfoundland Standard Time", "America/St_Johns"),
    ("Tocantins Standard Time", "America/Araguaina"),
    ("E. South America Standard Time", "America/Sao_Paulo"),
    ("SA Eastern Standard Time", "America/Cayenne"),
    ("Argentina Standard Time", "America/Argentina/Buenos_Aires"),
    ("Greenland Standard Time", "America/Nuuk"),
    ("Montevideo Standard Time", "America/Montevideo"),
    ("Magallanes Standard Time", "America/Punta_Arenas"),
    ("Saint Pierre Standard Time", "America/Miquelon"),
    ("Bahia Standard Time", "America/Bahia"),
    ("UTC-02", "Etc/GMT+2"),
    ("Azores Standard Time", "Atlantic/Azores"),
    ("Cape Verde Standard Time", "Atlantic/Cape_Verde"),
    ("UTC", "Etc/UTC"),
    ("GMT Standard Time", "Europe/London"),
    ("Greenwich Standard Time", "Atlantic/Reykjavik"),
    ("Sao Tome Standard Time", "Africa/Sao_Tome"),
    ("Morocco Standard Time", "Africa/Casablanca"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("Central Europe Standard Time", "Europe/Budapest"),
    ("Romance Standard Time", "Europe/Paris"),
    ("Central European Standard Time", "Europe/Warsaw"),
    ("W. Central Africa Standard Time", "Africa/Lagos"),
    ("Jordan Standard Time", "Asia/Amman"),
    ("GTB Standard Time", "Europe/Bucharest"),
    ("Middle East Standard Time", "Asia/Beirut"),
    ("Egypt Standard Time", "Africa/Cairo"),
    ("E. Europe Standard Time", "Europe/Chisinau"),
    ("Syria Standard Time", "Asia/Damascus"),
    ("West Bank Standard Time", "Asia/Hebron"),
    ("South Africa Standard Time", "Africa/Johannesburg"),
    ("FLE Standard Time", "Europe/Kyiv"),
    ("Israel Standard Time", "Asia/Jerusalem"),
    ("South Sudan Standard Time", "Africa/Juba"),
    ("Kaliningrad Standard Time", "Europe/Kaliningrad"),
    ("Sudan Standard Time", "Africa/Khartoum"),
    ("Libya Standard Time", "Africa/Tripoli"),
    ("Namibia Standard Time", "Africa/Windhoek"),
    ("Arabic Standard Time", "Asia/Baghdad"),
    ("Turkey Standard Time", "Europe/Istanbul"),
    ("Arab Standard Time", "Asia/Riyadh"),
    ("Belarus Standard Time", "Europe/Minsk"),
    ("Russian Standard Time", "Europe/Moscow"),
    ("E. Africa Standard Time", "Africa/Nairobi"),
    ("Volgograd Standard Time", "Europe/Volgograd"),
    ("Iran Standard Time", "Asia/Tehran"),
    ("Arabian Standard Time", "Asia/Dubai"),
    ("Astrakhan Standard Time", "Europe/Astrakhan"),
    ("Azerbaijan Standard Time", "Asia/Baku"),
    ("Russia Time Zone 3", "Europe/Samara"),
    ("Mauritius Standard Time", "Indian/Mauritius"),
    ("Saratov Standard Time", "Europe/Saratov"),
    ("Georgian Standard Time", "Asia/Tbilisi"),
    ("Caucasus Standard Time", "Asia/Yerevan"),
    ("Afghanistan Standard Time", "Asia/Kabul"),
    ("West Asia Standard Time", "Asia/Tashkent"),
    ("Ekaterinburg Standard Time", "Asia/Yekaterinburg"),
    ("Pakistan Standard Time", "Asia/Karachi"),
    ("Qyzylorda Standard Time", "Asia/Qyzylorda"),
    ("India Standard Time", "Asia/Kolkata"),
    ("Sri Lanka Standard Time", "Asia/Colombo"),
    ("Nepal Standard Time", "Asia/Kathmandu"),
    ("Central Asia Standard Time", "Asia/Bishkek"),
    ("Bangladesh Standard Time", "Asia/Dhaka"),
    ("Omsk Standard Time", "Asia/Omsk"),
    ("Myanmar Standard Time", "Asia/Yangon"),
    ("SE Asia Standard Time", "Asia/Bangkok"),
    ("Altai Standard Time", "Asia/Barnaul"),
    ("W. Mongolia Standard Time", "Asia/Hovd"),
    ("North Asia Standard Time", "Asia/Krasnoyarsk"),
    ("N. Central Asia Standard Time", "Asia/Novosibirsk"),
    ("Tomsk Standard Time", "Asia/Tomsk"),
    ("China Standard Time", "Asia/Shanghai"),
    ("North Asia East Standard Time", "Asia/Irkutsk"),
    ("Singapore Standard Time", "Asia/Singapore"),
    ("W. Australia Standard Time", "Australia/Perth"),
    ("Taipei Standard Time", "Asia/Taipei"),
    ("Ulaanbaatar Standard Time", "Asia/Ulaanbaatar"),
    ("Aus Central W. Standard Time", "Australia/Eucla"),
    ("Transbaikal Standard Time", "Asia/Chita"),
    ("Tokyo Standard Time", "Asia/Tokyo"),
    ("North Korea Standard Time", "Asia/Pyongyang"),
    ("Korea Standard Time", "Asia/Seoul"),
    ("Yakutsk Standard Time", "Asia/Yakutsk"),
    ("Cen. Australia Standard Time", "Australia/Adelaide"),
    ("AUS Central Standard Time", "Australia/Darwin"),
    ("E. Australia Standard Time", "Australia/Brisbane"),
    ("AUS Eastern Standard Time", "Australia/Sydney"),
    ("West Pacific Standard Time", "Pacific/Port_Moresby"),
    ("Tasmania Standard Time", "Australia/Hobart"),
    ("Vladivostok Standard Time", "Asia/Vladivostok"),
    ("Lord Howe Standard Time", "Australia/Lord_Howe"),
    ("Bougainville Standard Time", "Pacific/Bougainville"),
    ("Russia Time Zone 10", "Asia/Srednekolymsk"),
    ("Magadan Standard Time", "Asia/Magadan"),
    ("Norfolk Standard Time", "Pacific/Norfolk"),
    ("Sakhalin Standard Time", "Asia/Sakhalin"),
    ("Central Pacific Standard Time", "Pacific/Guadalcanal"),
    ("Russia Time Zone 11", "Asia/Kamchatka"),
    ("New Zealand Standard Time", "Pacific/Auckland"),
    ("UTC+12", "Etc/GMT-12"),
    ("Fiji Standard Time", "Pacific/Fiji"),
    ("Chatham Islands Standard Time", "Pacific/Chatham"),
    ("UTC+13", "Etc/GMT-13"),
    ("Tonga Standard Time", "Pacific/Tongatapu"),
    ("Samoa Standard Time", "Pacific/Apia"),
    ("Line Islands Standard Time", "Pacific/Kiritimati"),
];

/// Represents attachment metadata extracted from message parts
struct AttachmentInfo {
    attachment_id: String,
    filename: String,
    mime_type: String,
    size: i32,
    content_id: Option<String>,
}

fn extract_attachments_from_parts(parts: &Option<Vec<MessagePart>>) -> Vec<AttachmentInfo> {
    let mut attachments = Vec::new();
    if let Some(parts) = parts {
        for part in parts {
            // Extract Content-ID header if present (for inline images)
            let content_id = part.headers.as_ref().and_then(|headers| {
                headers.iter()
                    .find(|h| h.name.eq_ignore_ascii_case("Content-ID"))
                    .map(|h| h.value.trim_matches(|c| c == '<' || c == '>').to_string())
            });

            // Check if this part has an attachmentId (required for fetching)
            if let Some(body) = &part.body {
                if let Some(attachment_id) = &body.attachment_id {
                    let size = body.size.unwrap_or(0);
                    if size > 0 {
                        // Use filename if available, otherwise generate one for inline images
                        let filename = part.filename.clone()
                            .filter(|f| !f.is_empty())
                            .unwrap_or_else(|| {
                                let stem = content_id.as_deref().unwrap_or("attachment");
                                let extension = part.mime_type.rsplit('/').next().unwrap_or("bin");
                                format!("{}.{}", stem, extension)
                            });
                        attachments.push(AttachmentInfo {
                            attachment_id: attachment_id.clone(),
                            filename,
                            mime_type: part.mime_type.clone(),
                            size,
                            content_id,
                        });
                    }
                }
            }
            // Recursively check nested parts
            attachments.extend(extract_attachments_from_parts(&part.parts));
        }
    }
    attachments
}

/// Date bucket of `date` relative to `now`, compared as calendar days in
/// `now`'s time zone
fn classify_date<Tz: TimeZone>(date: DateTime<Utc>, now: &DateTime<Tz>) -> DateBucket {
    let today = now.date_naive();
    let msg_date = date.with_timezone(&now.timezone()).date_naive();

    if msg_date == today {
        return DateBucket::Today;
    }
    if msg_date == today - Duration::days(1) {
        return DateBucket::Yesterday;
    }

    let days_since_monday = now.weekday().num_days_from_monday() as i64;
    if msg_date >= today - Duration::days(days_since_monday) {
        return DateBucket::ThisWeek;
    }

    if msg_date >= today - Duration::days(30) {
        return DateBucket::Last30Days;
    }

    DateBucket::Older
}

fn group_threads_by_date<Tz: TimeZone>(threads: Vec<Thread>, now: &DateTime<Tz>) -> Vec<ThreadGroup> {
    let mut groups: HashMap<&'static str, Vec<Thread>> = HashMap::new();
    for thread in threads {
        let label = classify_date(thread.last_message_date, now).as_str();
        groups.entry(label).or_default().push(thread);
    }

    [
        DateBucket::Today,
        DateBucket::Yesterday,
        DateBucket::ThisWeek,
        DateBucket::Last30Days,
        DateBucket::Older,
    ]
    .iter()
    .map(DateBucket::as_str)
    .filter_map(|label| {
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

/// Extract the first text/plain body from a FullMessage, searching nested
/// multipart parts depth-first
pub fn extract_body_text_from_message(message: &FullMessage) -> Option<String> {
    let payload = message.payload.as_ref()?;
    if payload.mime_type.as_deref() == Some("text/plain") {
        if let Some(text) = payload.body.as_ref().and_then(decode_part_text) {
            return Some(text);
        }
    }
    payload.parts.as_deref().and_then(find_text_in_parts)
}

fn find_text_in_parts(parts: &[MessagePart]) -> Option<String> {
    parts.iter().find_map(|part| {
        if part.mime_type == "text/plain" {
            let is_attached_file = part.filename.as_deref().is_some_and(|f| !f.is_empty());
            if is_attached_file {
                return None;
            }
            part.body.as_ref().and_then(decode_part_text)
        } else {
            part.parts.as_deref().and_then(find_text_in_parts)
        }
    })
}

fn decode_part_text(body: &MessageBody) -> Option<String> {
    decode_base64_body(body.data.as_deref()?)
}

/// Decode Gmail's base64url data, with or without padding. Bodies in a legacy
/// charset are decoded lossily rather than dropped.
fn decode_base64_body(data: &str) -> Option<String> {
    decode_base64_lenient(data).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn decode_base64_lenient(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let normalized: String = data
        .chars()
        .filter(|c| !c.is_ascii_whitespace() && *c != '=')
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            c => c,
        })
        .collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(normalized)
        .ok()
}

/// Strip HTML tags to create plain text fallback
fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut tag = String::new();
    let mut in_tag = false;
    // Element whose content is not text (style, script, head) until it closes
    let mut hidden_element: Option<String> = None;

    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let is_closing = tag.starts_with('/');
                let name = tag
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_end_matches('/')
                    .to_ascii_lowercase();
                if let Some(hidden) = &hidden_element {
                    // </head> may be omitted; <body> then ends the head
                    if (is_closing && *hidden == name) || (hidden == "head" && name == "body") {
                        hidden_element = None;
                    }
                } else if !is_closing && matches!(name.as_str(), "style" | "script" | "head") {
                    hidden_element = Some(name);
                } else if name == "br" || name == "p" {
                    // Line-breaking tags become newlines instead of vanishing
                    result.push('\n');
                }
            }
            _ if in_tag => tag.push(c),
            _ if hidden_element.is_some() => {}
            _ => result.push(c),
        }
    }

    // Decode common HTML entities; &amp; last so "&amp;lt;" decodes to "&lt;"
    // rather than being double-decoded
    result
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The user-written fields of an outgoing message or draft
#[derive(Default)]
pub struct OutgoingMessage<'a> {
    pub to: &'a str,
    pub cc: &'a str,
    pub bcc: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
    pub attachments: &'a [SendAttachment],
    pub is_html: bool,
}

/// Base64url encoding the Gmail API expects in a message's `raw` field
fn encode_raw_message(message: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(message.as_bytes())
}

fn new_boundary(kind: &str) -> String {
    format!("----=_{}_{}", kind, uuid::Uuid::new_v4().simple())
}

fn push_part(message: &mut String, boundary: &str, content_type: &str, content: &str) {
    message.push_str(&format!("--{}\r\n", boundary));
    message.push_str(&format!("Content-Type: {}\r\n\r\n", content_type));
    message.push_str(content);
    message.push_str("\r\n");
}

/// Content headers and quoted-printable body of a UTF-8 text part (the part's
/// Content-Type is `mime_type`)
fn text_part_content(mime_type: &str, text: &str) -> String {
    format!(
        "Content-Type: {}; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n{}",
        mime_type,
        encode_quoted_printable(text)
    )
}

fn push_text_part(message: &mut String, boundary: &str, mime_type: &str, text: &str) {
    message.push_str(&format!("--{}\r\n", boundary));
    message.push_str(&text_part_content(mime_type, text));
    message.push_str("\r\n");
}

/// RFC 2045 quoted-printable: 7-bit output in lines of at most 76 characters
/// (SMTP rejects lines over 998), with line breaks normalized to CRLF
fn encode_quoted_printable(text: &str) -> String {
    const MAX_LINE: usize = 76;
    let mut out = String::with_capacity(text.len() + text.len() / 8);
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push_str("\r\n");
        }
        let bytes = line.strip_suffix('\r').unwrap_or(line).as_bytes();
        let mut line_len = 0;
        for (j, &b) in bytes.iter().enumerate() {
            let is_last = j + 1 == bytes.len();
            let literal = (b'!'..=b'~').contains(&b) && b != b'='
                || (matches!(b, b' ' | b'\t') && !is_last);
            let token = if literal {
                (b as char).to_string()
            } else {
                format!("={:02X}", b)
            };
            // Leave room for the '=' of a soft line break
            if line_len + token.len() > MAX_LINE - 1 {
                out.push_str("=\r\n");
                line_len = 0;
            }
            out.push_str(&token);
            line_len += token.len();
        }
    }
    out
}

/// multipart/alternative body with a plain text fallback for an HTML body
fn push_html_alternative(message: &mut String, html: &str) {
    let alt_boundary = new_boundary("Alt");
    message.push_str(&format!(
        "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
        alt_boundary
    ));
    push_text_part(message, &alt_boundary, "text/plain", &strip_html_tags(html));
    push_text_part(message, &alt_boundary, "text/html", html);
    message.push_str(&format!("--{}--\r\n", alt_boundary));
}

/// Build a raw RFC 5322 message: plain text, HTML with a plain text
/// alternative, or multipart/mixed when there are attachments.
/// `reply_headers` are (In-Reply-To, References).
fn build_mime_message(msg: &OutgoingMessage, reply_headers: Option<&(String, String)>) -> String {
    let mut message = format!("To: {}\r\n", encode_address_header(msg.to));

    if !msg.cc.trim().is_empty() {
        message.push_str(&format!("Cc: {}\r\n", encode_address_header(msg.cc)));
    }
    if !msg.bcc.trim().is_empty() {
        message.push_str(&format!("Bcc: {}\r\n", encode_address_header(msg.bcc)));
    }

    message.push_str(&format!("Subject: {}\r\n", encode_header_value(msg.subject)));
    message.push_str("MIME-Version: 1.0\r\n");

    if let Some((in_reply_to, references)) = reply_headers {
        message.push_str(&format!(
            "In-Reply-To: {}\r\nReferences: {}\r\n",
            sanitize_header_value(in_reply_to),
            sanitize_header_value(references)
        ));
    }

    if msg.attachments.is_empty() {
        if msg.is_html {
            push_html_alternative(&mut message, msg.body);
        } else {
            message.push_str(&text_part_content("text/plain", msg.body));
        }
        return message;
    }

    let boundary = new_boundary("Part");
    message.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
        boundary
    ));

    if msg.is_html {
        message.push_str(&format!("--{}\r\n", boundary));
        push_html_alternative(&mut message, msg.body);
    } else {
        push_text_part(&mut message, &boundary, "text/plain", msg.body);
    }

    for attachment in msg.attachments {
        let quoted_name = quoted_filename_param(&attachment.filename);
        message.push_str(&format!("--{}\r\n", boundary));
        message.push_str(&format!(
            "Content-Type: {}; name={}\r\n",
            sanitize_header_value(&attachment.mime_type),
            quoted_name
        ));
        message.push_str("Content-Transfer-Encoding: base64\r\n");
        message.push_str(&format!("Content-Disposition: attachment; filename={}", quoted_name));
        let filename = sanitize_header_value(&attachment.filename);
        if !filename.is_ascii() {
            message.push_str(&format!("; filename*=UTF-8''{}", rfc2231_encode(&filename)));
        }
        message.push_str("\r\n\r\n");
        // The frontend may send URL-safe base64; MIME needs the standard
        // alphabet in lines of at most 76 characters
        let normalized_data: String = attachment
            .data
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .map(|c| match c {
                '-' => '+',
                '_' => '/',
                c => c,
            })
            .collect();
        for chunk in normalized_data.as_bytes().chunks(76) {
            message.push_str(std::str::from_utf8(chunk).unwrap_or(""));
            message.push_str("\r\n");
        }
    }

    message.push_str(&format!("--{}--\r\n", boundary));
    message
}

/// Quoted-string for a `name`/`filename` parameter: RFC 2047 encoded when
/// non-ASCII (widely understood even though not strictly allowed in parameters)
fn quoted_filename_param(filename: &str) -> String {
    let value = sanitize_header_value(filename);
    let value = if value.is_ascii() { value } else { encoded_word(&value) };
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// RFC 2231 percent-encoding for an extended parameter value
fn rfc2231_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect()
}

/// Normalize an RFC Message-ID so it is wrapped in exactly one pair of angle brackets
fn ensure_angle_brackets(id: &str) -> String {
    let trimmed = id.trim().trim_start_matches('<').trim_end_matches('>');
    format!("<{}>", trimmed)
}

/// Replace CR/LF with spaces so a crafted value cannot terminate its header
/// line and inject extra headers (e.g. a hidden Bcc) into the raw message
fn sanitize_header_value(value: &str) -> String {
    value.replace("\r\n", " ").replace(['\r', '\n'], " ")
}

/// RFC 2047 encode a header value when it contains non-ASCII characters, as
/// folded encoded-words short enough to keep "Subject: <word>" within 78 columns
fn encode_header_value(value: &str) -> String {
    let value = sanitize_header_value(value);
    if value.is_ascii() {
        return value;
    }
    encoded_words(&value).join("\r\n ")
}

/// UTF-8 "B" encoded-words, each holding whole characters
fn encoded_words(value: &str) -> Vec<String> {
    const MAX_WORD_BYTES: usize = 42;
    let mut words = Vec::new();
    let mut chunk_start = 0;
    for (i, c) in value.char_indices() {
        if i + c.len_utf8() - chunk_start > MAX_WORD_BYTES {
            words.push(&value[chunk_start..i]);
            chunk_start = i;
        }
    }
    words.push(&value[chunk_start..]);
    words.into_iter().map(encoded_word).collect()
}

fn encoded_word(value: &str) -> String {
    use base64::Engine;
    format!(
        "=?UTF-8?B?{}?=",
        base64::engine::general_purpose::STANDARD.encode(value.as_bytes())
    )
}

/// RFC 2047 encode display names in an address list header, leaving emails untouched
fn encode_address_header(addresses: &str) -> String {
    split_address_list(&sanitize_header_value(addresses))
        .iter()
        .map(|addr| encode_single_address(addr))
        .collect::<Vec<_>>()
        .join(", ")
}

fn encode_single_address(addr: &str) -> String {
    let Some(pos) = addr.find('<') else {
        // Bare email address - nothing to encode
        return addr.to_string();
    };
    let name = addr[..pos].trim().trim_matches('"').trim();
    if name.is_empty() || name.is_ascii() {
        return addr.to_string();
    }
    format!("{} {}", encode_header_value(name), &addr[pos..])
}

/// Split an address list on commas, respecting quoted display names
fn split_address_list(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in input.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                current.push(c);
            }
            ',' if !in_quotes => {
                let part = current.trim();
                if !part.is_empty() {
                    parts.push(part.to_string());
                }
                current.clear();
            }
            _ => current.push(c),
        }
    }
    let last = current.trim();
    if !last.is_empty() {
        parts.push(last.to_string());
    }
    parts
}

// ============ Email Reactions ============

const REACTION_MIME_TYPE: &str = "text/vnd.google.email-reaction+json";

/// Google's limit on To + Cc recipients for a message to accept reactions
const MAX_REACTION_RECIPIENTS: usize = 20;

/// Reaction data parsed from email
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedReaction {
    pub emoji: String,
    pub from_addr: String,
    /// Message-ID of the message reacted to
    pub in_reply_to: String,
    /// Gmail id of the reaction message itself
    pub message_id: String,
}

/// Parse reaction from a message if it contains a valid reaction part
fn parse_reaction_from_message(message: &FullMessage) -> Option<ParsedReaction> {
    let payload = message.payload.as_ref()?;
    let headers = payload.headers.as_deref();
    let from = extract_email_address(find_header(headers, "From")?);
    let in_reply_to = find_header(headers, "In-Reply-To")?.trim().to_string();

    let emoji = if payload.mime_type.as_deref() == Some(REACTION_MIME_TYPE) {
        parse_reaction_json(payload.body.as_ref()?.data.as_deref()?)
    } else {
        payload.parts.as_deref().and_then(find_reaction_in_parts)
    }?;

    Some(ParsedReaction {
        emoji,
        from_addr: from,
        in_reply_to,
        message_id: message.id.clone(),
    })
}

fn find_reaction_in_parts(parts: &[MessagePart]) -> Option<String> {
    parts.iter().find_map(|part| {
        if part.mime_type != REACTION_MIME_TYPE {
            return part.parts.as_deref().and_then(find_reaction_in_parts);
        }
        let is_attachment = find_header(part.headers.as_deref(), "Content-Disposition")
            .is_some_and(|v| v.to_ascii_lowercase().contains("attachment"));
        if is_attachment {
            return None;
        }
        parse_reaction_json(part.body.as_ref()?.data.as_deref()?)
    })
}

/// Parse the reaction JSON and validate it
fn parse_reaction_json(base64_data: &str) -> Option<String> {
    let decoded = decode_base64_body(base64_data)?;

    #[derive(Deserialize)]
    struct ReactionJson {
        version: i32,
        emoji: String,
    }

    let reaction: ReactionJson = serde_json::from_str(&decoded).ok()?;
    if reaction.version != 1 || reaction.emoji.is_empty() {
        return None;
    }
    Some(reaction.emoji)
}

impl GmailClient {
    /// Send an emoji reaction to a message. `message_id` is the target's
    /// Message-ID header value or its Gmail id.
    pub async fn send_reaction(
        &self,
        thread_id: &str,
        message_id: &str,
        emoji: &str,
        from_email: &str,
        to_email: &str,
    ) -> Result<(), String> {
        let thread = self.get_thread_metadata(&reaction_metadata_url(thread_id)).await?;
        let wanted_header = ensure_angle_brackets(message_id);
        let target = thread
            .messages
            .iter()
            .find(|m| {
                m.id == message_id
                    || m.payload
                        .as_ref()
                        .and_then(|p| find_header(p.headers.as_deref(), "Message-ID"))
                        .is_some_and(|h| ensure_angle_brackets(h) == wanted_header)
            })
            .ok_or("Message to react to was not found in the thread")?;

        check_can_react(target, from_email)?;

        let (in_reply_to, references) = reply_headers_from_thread(&thread, Some(&target.id))
            .ok_or("Message to react to has no Message-ID")?;
        let message = build_reaction_message(emoji, from_email, to_email, &in_reply_to, &references)?;
        self.send_raw(&message, Some(thread_id)).await
    }
}

/// Build a reaction MIME message per Google's spec
fn build_reaction_message(
    emoji: &str,
    from_email: &str,
    to_email: &str,
    in_reply_to: &str,
    references: &str,
) -> Result<String, String> {
    let boundary = new_boundary("React");

    let reaction_json = serde_json::to_string(&serde_json::json!({
        "version": 1,
        "emoji": emoji
    }))
    .map_err(|e| format!("Failed to serialize reaction: {}", e))?;

    // Fallback text for clients that don't support reactions
    let plain_text = format!("Reacted with {}", emoji);
    let html_text = format!(
        "<html><body><p>Reacted with <span style=\"font-size: 24px\">{}</span></p></body></html>",
        emoji
    );

    let mut message = String::new();
    message.push_str(&format!("From: {}\r\n", encode_address_header(from_email)));
    message.push_str(&format!("To: {}\r\n", encode_address_header(to_email)));
    message.push_str(&format!(
        "Subject: {}\r\n",
        encode_header_value(&format!("Re: {}", emoji))
    ));
    message.push_str("MIME-Version: 1.0\r\n");
    message.push_str(&format!("In-Reply-To: {}\r\n", sanitize_header_value(in_reply_to)));
    message.push_str(&format!("References: {}\r\n", sanitize_header_value(references)));
    message.push_str(&format!(
        "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
        boundary
    ));

    // Google's recommended order: plain text, reaction JSON, then HTML (last,
    // for clients that show the last alternative)
    push_part(&mut message, &boundary, "text/plain; charset=utf-8", &plain_text);
    push_part(
        &mut message,
        &boundary,
        &format!("{}; charset=utf-8", REACTION_MIME_TYPE),
        &reaction_json,
    );
    push_part(&mut message, &boundary, "text/html; charset=utf-8", &html_text);
    message.push_str(&format!("--{}--\r\n", boundary));

    Ok(message)
}

/// Google's eligibility rules for reacting to a message: not from a mailing
/// list, at most 20 To + Cc recipients, and the user is one of them
fn check_can_react(message: &FullMessage, user_email: &str) -> Result<(), String> {
    let headers = message.payload.as_ref().and_then(|p| p.headers.as_deref());

    if is_mailing_list_message(headers.unwrap_or_default()) {
        return Err("Cannot react to mailing list messages".to_string());
    }

    let recipients: Vec<String> = ["To", "Cc"]
        .iter()
        .filter_map(|name| find_header(headers, name))
        .flat_map(split_address_list)
        .map(|addr| extract_email_address(&addr))
        .collect();

    if recipients.len() > MAX_REACTION_RECIPIENTS {
        return Err(format!("Too many recipients (max {})", MAX_REACTION_RECIPIENTS));
    }

    if !recipients.iter().any(|a| a.eq_ignore_ascii_case(user_email.trim())) {
        return Err("You must be a recipient to react".to_string());
    }

    Ok(())
}

fn is_mailing_list_message(headers: &[Header]) -> bool {
    headers.iter().any(|h| {
        h.name.eq_ignore_ascii_case("List-Unsubscribe")
            || h.name.eq_ignore_ascii_case("List-Id")
            || (h.name.eq_ignore_ascii_case("Precedence") && h.value.trim().eq_ignore_ascii_case("list"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_html_converts_breaks_and_paragraphs_to_newlines() {
        assert_eq!(strip_html_tags("line1<br>line2"), "line1\nline2");
        assert_eq!(strip_html_tags("line1<br/>line2"), "line1\nline2");
        assert_eq!(strip_html_tags("line1<br />line2"), "line1\nline2");
        assert_eq!(strip_html_tags("line1<BR>line2"), "line1\nline2");
        assert_eq!(strip_html_tags("<p>one</p><p>two</p>"), "\none\n\ntwo\n");
    }

    #[test]
    fn strip_html_removes_other_tags() {
        assert_eq!(strip_html_tags("<b>bold</b> and <i>italic</i>"), "bold and italic");
        assert_eq!(strip_html_tags("<a href=\"http://x\">link</a>"), "link");
    }

    #[test]
    fn strip_html_drops_style_script_and_head_contents() {
        // A reply quoting an HTML newsletter carries its <head> and <style>
        let html = "<html><head><title>Promo</title><style>p { color: red; }</style></head>\
                    <body><STYLE type=\"text/css\">.x{}</STYLE>Hi<script>alert(1)</script> there</body></html>";
        assert_eq!(strip_html_tags(html), "Hi there");
        assert_eq!(strip_html_tags("<head><title>Promo</title><body>Hi</body>"), "Hi");
    }

    #[test]
    fn strip_html_decodes_entities_without_double_decoding() {
        assert_eq!(strip_html_tags("a &amp; b"), "a & b");
        assert_eq!(strip_html_tags("&lt;tag&gt;"), "<tag>");
        // "&amp;lt;" is the escaped text "&lt;" - it must NOT become "<"
        assert_eq!(strip_html_tags("&amp;lt;"), "&lt;");
        assert_eq!(strip_html_tags("&quot;hi&quot; &#39;there&#39;&nbsp;!"), "\"hi\" 'there' !");
    }

    #[test]
    fn ensure_angle_brackets_normalizes() {
        assert_eq!(ensure_angle_brackets("abc@example.com"), "<abc@example.com>");
        assert_eq!(ensure_angle_brackets("<abc@example.com>"), "<abc@example.com>");
        assert_eq!(ensure_angle_brackets("  <abc@example.com>  "), "<abc@example.com>");
    }

    #[test]
    fn encode_header_value_leaves_ascii_unchanged() {
        assert_eq!(encode_header_value("Hello world"), "Hello world");
    }

    #[test]
    fn header_values_strip_crlf() {
        assert_eq!(
            encode_header_value("Test\r\nBcc: evil@example.com"),
            "Test Bcc: evil@example.com"
        );
        assert_eq!(
            encode_address_header("a@example.com\r\nBcc: evil@example.com"),
            "a@example.com Bcc: evil@example.com"
        );
    }

    #[test]
    fn build_mime_message_rejects_header_injection() {
        let message = build_mime_message(&OutgoingMessage {
            to: "victim@example.com\r\nBcc: evil@example.com",
            subject: "Hi\r\nX-Injected: 1",
            body: "body",
            ..Default::default()
        }, None);

        assert!(!message.contains("\r\nBcc: evil@example.com"));
        assert!(!message.contains("\r\nX-Injected: 1"));
        assert!(message.starts_with("To: victim@example.com Bcc: evil@example.com\r\n"));
        assert!(message.contains("Subject: Hi X-Injected: 1\r\n"));

        let reply_headers = ("<a@x>\r\nBcc: evil@example.com".to_string(), "<r@x> <a@x>".to_string());
        let reply = build_mime_message(
            &OutgoingMessage { to: "a@example.com", body: "body", ..Default::default() },
            Some(&reply_headers),
        );
        assert!(reply.contains("\r\nIn-Reply-To: <a@x> Bcc: evil@example.com\r\nReferences: <r@x> <a@x>\r\n"));
    }

    #[test]
    fn encode_header_value_encodes_non_ascii() {
        let encoded = encode_header_value("Café ☕");
        assert!(encoded.starts_with("=?UTF-8?B?"));
        assert!(encoded.ends_with("?="));
        use base64::Engine;
        let b64 = &encoded["=?UTF-8?B?".len()..encoded.len() - 2];
        let decoded = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "Café ☕");
    }

    fn decode_encoded_words(value: &str) -> String {
        use base64::Engine;
        let mut bytes = Vec::new();
        for word in value.split("\r\n ") {
            let b64 = word.strip_prefix("=?UTF-8?B?").and_then(|w| w.strip_suffix("?=")).expect("encoded word");
            let chunk = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
            // Each word must hold whole characters (RFC 2047 section 5)
            assert!(std::str::from_utf8(&chunk).is_ok(), "word splits a character");
            bytes.extend(chunk);
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn long_non_ascii_header_values_fold_into_short_encoded_words() {
        let subject = "Reunión de planificación del año próximo — revisión del presupuesto ☕ y más";
        let encoded = encode_header_value(subject);
        for word in encoded.split("\r\n ") {
            assert!(word.len() <= 75, "encoded word of {} chars", word.len());
        }
        assert!(encoded.contains("\r\n "));
        assert_eq!(decode_encoded_words(&encoded), subject);

        let message = build_mime_message(&OutgoingMessage { to: "x@example.com", subject, body: "b", ..Default::default() }, None);
        assert!(message.contains("\r\nSubject: =?UTF-8?B?"));
        assert!(message.lines().all(|l| l.len() <= 78));
    }

    #[test]
    fn encode_address_header_encodes_only_display_names() {
        assert_eq!(
            encode_address_header("plain@example.com"),
            "plain@example.com"
        );
        assert_eq!(
            encode_address_header("John Doe <jd@example.com>"),
            "John Doe <jd@example.com>"
        );
        let encoded = encode_address_header("José García <jg@example.com>");
        assert!(encoded.starts_with("=?UTF-8?B?"));
        assert!(encoded.ends_with(" <jg@example.com>"));
    }

    #[test]
    fn encode_address_header_handles_lists_and_quoted_commas() {
        assert_eq!(
            encode_address_header("a@example.com, b@example.com"),
            "a@example.com, b@example.com"
        );
        // Comma inside a quoted display name must not split the address
        assert_eq!(
            encode_address_header("\"Doe, John\" <jd@example.com>, x@example.com"),
            "\"Doe, John\" <jd@example.com>, x@example.com"
        );
        let quoted = encode_address_header("\"Müller, J\" <m@example.com>, x@example.com");
        assert!(quoted.starts_with("=?UTF-8?B?"));
        assert!(quoted.ends_with(" <m@example.com>, x@example.com"));
        let mixed = encode_address_header("Müller <m@example.com>, plain@example.com");
        assert!(mixed.contains("=?UTF-8?B?"));
        assert!(mixed.ends_with(", plain@example.com"));
    }

    #[test]
    fn extract_email_address_handles_angle_bracket_in_display_name() {
        assert_eq!(extract_email_address("\"a>b\" <x@example.com>"), "x@example.com");
        assert_eq!(extract_email_address("Jane <jane@example.com>"), "jane@example.com");
        assert_eq!(extract_email_address("  bare@example.com "), "bare@example.com");
        assert_eq!(extract_email_address("Broken <x@example.com"), "Broken <x@example.com");
    }

    #[test]
    fn parse_ics_datetime_rejects_non_ascii_without_panicking() {
        assert_eq!(parse_ics_datetime("202é115", "", &[]), None);
        assert_eq!(parse_ics_datetime("20240115T1é0000", "", &[]), None);
        assert_eq!(parse_ics_datetime("é0240115T100000Z", "", &[]), None);
    }

    fn ics_utc(s: &str, params: &str) -> Option<(String, bool)> {
        parse_ics_datetime(s, params, &[]).map(|(ms, all_day)| {
            (DateTime::from_timestamp_millis(ms).unwrap().to_rfc3339(), all_day)
        })
    }

    #[test]
    fn parse_ics_all_day_is_utc_midnight_of_that_date() {
        // The frontend reads all-day dates back with getUTC*, so the stored
        // instant must be midnight UTC regardless of the machine's zone
        assert_eq!(
            ics_utc("20240115", "VALUE=DATE"),
            Some(("2024-01-15T00:00:00+00:00".to_string(), true))
        );
    }

    #[test]
    fn parse_ics_resolves_tzid_times_across_dst_changes() {
        let ny = "TZID=America/New_York";
        assert_eq!(
            ics_utc("20240115T100000", ny),
            Some(("2024-01-15T15:00:00+00:00".to_string(), false))
        );
        // 01:30 happens twice on 2024-11-03; take the first (EDT)
        assert_eq!(
            ics_utc("20241103T013000", ny),
            Some(("2024-11-03T05:30:00+00:00".to_string(), false))
        );
        // 02:30 is skipped on 2024-03-10; it means 03:30 EDT
        assert_eq!(
            ics_utc("20240310T023000", ny),
            Some(("2024-03-10T07:30:00+00:00".to_string(), false))
        );
    }

    #[test]
    fn parse_ics_skipped_time_uses_the_actual_dst_shift() {
        // Lord Howe moves from +10:30 to +11:00 at 02:00 on 2024-10-06, so
        // 02:00-02:29 do not exist; 02:15 read at +10:30 is 02:45 daylight time
        assert_eq!(
            ics_utc("20241006T021500", "TZID=Australia/Lord_Howe"),
            Some(("2024-10-05T15:45:00+00:00".to_string(), false))
        );
    }

    /// An invite whose event starts at `dtstart` (with its parameters) after
    /// the given VTIMEZONE lines, CRLF-joined
    fn invite_with_zone(zone: &[&str], dtstart: &str) -> String {
        let mut lines = vec!["BEGIN:VCALENDAR", "METHOD:REQUEST"];
        lines.extend_from_slice(zone);
        lines.extend_from_slice(&["BEGIN:VEVENT", dtstart, "SUMMARY:Sync", "END:VEVENT", "END:VCALENDAR"]);
        lines.join("\r\n")
    }

    fn invite_start_utc(ics: &str) -> String {
        let event = parse_ics_content(ics).expect("invite parses");
        DateTime::from_timestamp_millis(event.start_time).unwrap().to_rfc3339()
    }

    #[test]
    fn parse_ics_maps_windows_zone_names_to_iana() {
        // Outlook and Exchange name zones the Windows way
        let pacific = invite_with_zone(&[], "DTSTART;TZID=Pacific Standard Time:20240715T100000");
        assert_eq!(invite_start_utc(&pacific), "2024-07-15T17:00:00+00:00");
        let quoted = invite_with_zone(&[], "DTSTART;TZID=\"W. Europe Standard Time\":20240115T100000");
        assert_eq!(invite_start_utc(&quoted), "2024-01-15T09:00:00+00:00");
        let india = invite_with_zone(&[], "DTSTART;TZID=India Standard Time:20240115T100000");
        assert_eq!(invite_start_utc(&india), "2024-01-15T04:30:00+00:00");
    }

    #[test]
    fn windows_zone_table_names_only_known_iana_zones() {
        assert!(WINDOWS_ZONES.len() > 50);
        for (windows, iana) in WINDOWS_ZONES {
            assert!(iana.parse::<chrono_tz::Tz>().is_ok(), "{} maps to unknown {}", windows, iana);
        }
    }

    #[test]
    fn parse_ics_accepts_prefixed_iana_zone_ids() {
        let ics = invite_with_zone(
            &[],
            "DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20240115T100000",
        );
        assert_eq!(invite_start_utc(&ics), "2024-01-15T15:00:00+00:00");
    }

    const CUSTOM_EUROPE_ZONE: &[&str] = &[
        "BEGIN:VTIMEZONE",
        "TZID:Customized Time Zone",
        "BEGIN:STANDARD",
        "DTSTART:16010101T030000",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:16010101T020000",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
    ];

    #[test]
    fn parse_ics_follows_vtimezone_rules_for_unknown_zone_names() {
        let at = |dtstart: &str| {
            invite_start_utc(&invite_with_zone(
                CUSTOM_EUROPE_ZONE,
                &format!("DTSTART;TZID=Customized Time Zone:{}", dtstart),
            ))
        };
        // January follows the previous October's switch to standard time
        assert_eq!(at("20240115T100000"), "2024-01-15T09:00:00+00:00");
        // Daylight time starts on the last Sunday of March (the 31st in 2024)
        assert_eq!(at("20240330T120000"), "2024-03-30T11:00:00+00:00");
        assert_eq!(at("20240331T120000"), "2024-03-31T10:00:00+00:00");
        // ...and ends on the last Sunday of October (the 27th)
        assert_eq!(at("20241026T120000"), "2024-10-26T10:00:00+00:00");
        assert_eq!(at("20241027T120000"), "2024-10-27T11:00:00+00:00");
    }

    #[test]
    fn parse_ics_vtimezone_nth_weekday_rules() {
        let zone = [
            "BEGIN:VTIMEZONE",
            "TZID:Customized Time Zone 1",
            "BEGIN:STANDARD",
            "DTSTART:16010101T020000",
            "TZOFFSETFROM:-0700",
            "TZOFFSETTO:-0800",
            "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
            "END:STANDARD",
            "BEGIN:DAYLIGHT",
            "DTSTART:16010101T020000",
            "TZOFFSETFROM:-0800",
            "TZOFFSETTO:-0700",
            "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
            "END:DAYLIGHT",
            "END:VTIMEZONE",
        ];
        let at = |dtstart: &str| {
            invite_start_utc(&invite_with_zone(
                &zone,
                &format!("DTSTART;TZID=\"Customized Time Zone 1\":{}", dtstart),
            ))
        };
        // Second Sunday of March 2024 is the 10th, first Sunday of November the 3rd
        assert_eq!(at("20240309T120000"), "2024-03-09T20:00:00+00:00");
        assert_eq!(at("20240310T120000"), "2024-03-10T19:00:00+00:00");
        assert_eq!(at("20241102T120000"), "2024-11-02T19:00:00+00:00");
        assert_eq!(at("20241103T120000"), "2024-11-03T20:00:00+00:00");
    }

    #[test]
    fn parse_ics_vtimezone_without_rules_is_a_fixed_offset() {
        let zone = [
            "BEGIN:VTIMEZONE",
            "TZID:Office",
            "BEGIN:STANDARD",
            "DTSTART:16010101T000000",
            "TZOFFSETFROM:+0530",
            "TZOFFSETTO:+0530",
            "END:STANDARD",
            "END:VTIMEZONE",
        ];
        let ics = invite_with_zone(&zone, "DTSTART;TZID=Office:20240715T100000");
        assert_eq!(invite_start_utc(&ics), "2024-07-15T04:30:00+00:00");
    }

    const FOLDED_INVITE: &str = concat!(
        "BEGIN:VCALENDAR\r\n",
        "METHOD:REQUEST\r\n",
        "BEGIN:VEVENT\r\n",
        "DTSTART:20240115T150000Z\r\n",
        "DTEND:20240115T160000Z\r\n",
        "DTSTAMP:20240110T120000Z\r\n",
        "ORGANIZER;CN=\"Doe: Jane\":MAILTO:jane@example.com\r\n",
        "UID:abc123@google.com\r\n",
        "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=\r\n",
        " TRUE;CN=bob@example.com;X-NUM-GUESTS=0:mailto:bob@example.com\r\n",
        "ATTENDEE;CN=carol@example.com:mailto:carol@example.com\r\n",
        "SUMMARY:Quarterly planning\\, budget and a very long title that the server fo\r\n",
        " lded\r\n",
        "LOCATION:Room 1\\; Floor 2\r\n",
        "STATUS:CONFIRMED\r\n",
        "BEGIN:VALARM\r\n",
        "ACTION:DISPLAY\r\n",
        "DESCRIPTION:This is an event reminder\r\n",
        "TRIGGER:-P0DT0H30M0S\r\n",
        "END:VALARM\r\n",
        "END:VEVENT\r\n",
        "END:VCALENDAR\r\n",
    );

    #[test]
    fn parse_ics_unfolds_long_lines_and_unescapes_text() {
        let event = parse_ics_content(FOLDED_INVITE).expect("invite parses");
        assert_eq!(
            event.title,
            "Quarterly planning, budget and a very long title that the server folded"
        );
        assert_eq!(event.location.as_deref(), Some("Room 1; Floor 2"));
        assert_eq!(event.method.as_deref(), Some("REQUEST"));
        assert_eq!(event.uid.as_deref(), Some("abc123@google.com"));
    }

    #[test]
    fn parse_ics_reads_folded_attendees_and_quoted_params() {
        let event = parse_ics_content(FOLDED_INVITE).expect("invite parses");
        assert_eq!(event.attendees, vec!["bob@example.com", "carol@example.com"]);
        assert_eq!(event.organizer.as_deref(), Some("jane@example.com"));
    }

    #[test]
    fn parse_ics_ignores_alarm_description() {
        let event = parse_ics_content(FOLDED_INVITE).expect("invite parses");
        assert_eq!(event.description, None);
        assert_eq!(event.start_time, 1705330800000);
        assert_eq!(event.end_time, Some(1705334400000));
    }

    fn header(name: &str, value: &str) -> Header {
        Header { name: name.to_string(), value: value.to_string() }
    }

    fn detail(id: &str, labels: &[&str], from: &str) -> MessageDetail {
        MessageDetail {
            id: id.to_string(),
            label_ids: Some(labels.iter().map(|l| l.to_string()).collect()),
            snippet: None,
            internal_date: None,
            payload: Some(MessagePayload {
                headers: Some(vec![header("From", from)]),
                body: None,
                parts: None,
                mime_type: None,
            }),
        }
    }

    #[test]
    fn thread_labels_are_the_union_of_all_message_labels() {
        // Replying to an inbox thread leaves the latest message with only SENT;
        // the thread is still in the inbox and still starred
        let messages = vec![
            detail("1", &["INBOX", "STARRED", "IMPORTANT"], "a@example.com"),
            detail("2", &["INBOX", "UNREAD"], "b@example.com"),
            detail("3", &["SENT"], "me@example.com"),
        ];
        assert_eq!(
            thread_labels(&messages),
            vec!["INBOX", "STARRED", "IMPORTANT", "UNREAD", "SENT"]
        );
    }

    #[test]
    fn thread_participants_are_unique_in_first_seen_order() {
        let messages = vec![
            detail("1", &[], "Alice <a@example.com>"),
            detail("2", &[], "me@example.com"),
            detail("3", &[], "Alice <A@example.com>"),
            detail("4", &[], "me@example.com"),
        ];
        assert_eq!(thread_participants(&messages), vec!["a@example.com", "me@example.com"]);
    }

    fn full_message(id: &str, labels: &[&str], headers: Vec<Header>) -> FullMessage {
        FullMessage {
            id: id.to_string(),
            thread_id: "t1".to_string(),
            label_ids: Some(labels.iter().map(|l| l.to_string()).collect()),
            snippet: None,
            internal_date: None,
            payload: Some(MessagePayload {
                headers: Some(headers),
                body: None,
                parts: None,
                mime_type: Some("text/plain".to_string()),
            }),
            reaction: None,
        }
    }

    fn thread_of(messages: Vec<FullMessage>) -> FullThread {
        FullThread { id: "t1".to_string(), history_id: None, messages }
    }

    #[test]
    fn reply_headers_skip_drafts_when_falling_back_to_last_message() {
        let thread = thread_of(vec![
            full_message("m1", &["INBOX"], vec![
                header("Message-Id", "<one@example.com>"),
            ]),
            full_message("m2", &["INBOX"], vec![
                header("Message-ID", "<two@example.com>"),
                header("References", "<one@example.com>"),
            ]),
            full_message("d1", &["DRAFT"], vec![
                header("Message-ID", "<draft@example.com>"),
                header("References", "<one@example.com> <two@example.com>"),
            ]),
        ]);
        assert_eq!(
            reply_headers_from_thread(&thread, None),
            Some((
                "<two@example.com>".to_string(),
                "<one@example.com> <two@example.com>".to_string()
            ))
        );
        // An explicit Gmail id still wins
        assert_eq!(
            reply_headers_from_thread(&thread, Some("m1")),
            Some(("<one@example.com>".to_string(), "<one@example.com>".to_string()))
        );
    }

    #[test]
    fn reply_headers_come_from_a_metadata_fetch() {
        let url = thread_reply_metadata_url("t1");
        assert!(url.starts_with(&format!("{}/users/me/threads/t1?", GMAIL_API_BASE)));
        assert!(url.contains("format=metadata"));
        assert!(!url.contains("format=full"));
        assert!(url.contains("metadataHeaders=Message-ID"));
        assert!(url.contains("metadataHeaders=References"));

        // What Gmail returns for that request: headers only, no bodies or parts
        let response = r#"{
            "id": "t1",
            "messages": [
                {"id": "m1", "threadId": "t1", "labelIds": ["INBOX"],
                 "payload": {"headers": [{"name": "Message-Id", "value": "<one@example.com>"}]}},
                {"id": "d1", "threadId": "t1", "labelIds": ["DRAFT"],
                 "payload": {"headers": [{"name": "Message-ID", "value": "<draft@example.com>"},
                                         {"name": "References", "value": "<one@example.com>"}]}}
            ]
        }"#;
        let thread: FullThread = serde_json::from_str(response).expect("metadata thread parses");
        assert_eq!(
            reply_headers_from_thread(&thread, None),
            Some(("<one@example.com>".to_string(), "<one@example.com>".to_string()))
        );
    }

    #[test]
    fn reaction_target_comes_from_a_metadata_fetch_with_eligibility_headers() {
        let url = reaction_metadata_url("t1");
        assert!(url.starts_with(&format!("{}/users/me/threads/t1?", GMAIL_API_BASE)));
        assert!(url.contains("format=metadata"));
        assert!(!url.contains("format=full"));
        let requested: Vec<&str> = url
            .split(['?', '&'])
            .filter_map(|p| p.strip_prefix("metadataHeaders="))
            .collect();
        for name in ["Message-ID", "References", "To", "Cc", "List-Id", "List-Unsubscribe", "Precedence"] {
            assert!(requested.contains(&name), "missing {}", name);
        }

        // A mailing-list target is still refused from the trimmed response
        let response = r#"{
            "id": "t1",
            "messages": [
                {"id": "m1", "threadId": "t1", "labelIds": ["INBOX"],
                 "payload": {"headers": [{"name": "Message-ID", "value": "<one@example.com>"},
                                         {"name": "To", "value": "me@example.com"},
                                         {"name": "List-Id", "value": "<dev.example.com>"}]}}
            ]
        }"#;
        let thread: FullThread = serde_json::from_str(response).expect("metadata thread parses");
        assert!(check_can_react(&thread.messages[0], "me@example.com").is_err());
    }

    fn b64url(s: &[u8]) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s)
    }

    fn part(mime: &str, data: Option<String>, parts: Option<Vec<MessagePart>>) -> MessagePart {
        MessagePart {
            part_id: None,
            mime_type: mime.to_string(),
            filename: None,
            headers: None,
            body: Some(MessageBody { size: None, data, attachment_id: None }),
            parts,
        }
    }

    fn message_with_parts(parts: Vec<MessagePart>) -> FullMessage {
        let mut msg = full_message("m1", &[], vec![]);
        msg.payload = Some(MessagePayload {
            headers: Some(vec![]),
            body: None,
            parts: Some(parts),
            mime_type: Some("multipart/mixed".to_string()),
        });
        msg
    }

    #[test]
    fn body_text_found_in_deeply_nested_multipart() {
        // mixed > related > alternative > text/plain, as sent by Apple Mail
        // with inline images and an attachment
        let msg = message_with_parts(vec![part(
            "multipart/related",
            None,
            Some(vec![part(
                "multipart/alternative",
                None,
                Some(vec![
                    part("text/plain", Some(b64url("hello there".as_bytes())), None),
                    part("text/html", Some(b64url(b"<p>hello there</p>")), None),
                ]),
            )]),
        )]);
        assert_eq!(extract_body_text_from_message(&msg).as_deref(), Some("hello there"));
    }

    #[test]
    fn body_text_decodes_unpadded_base64_and_non_utf8() {
        let msg = message_with_parts(vec![part("text/plain", Some(b64url(b"ab")), None)]);
        assert_eq!(extract_body_text_from_message(&msg).as_deref(), Some("ab"));
        let msg = message_with_parts(vec![part("text/plain", Some("YWI=".to_string()), None)]);
        assert_eq!(extract_body_text_from_message(&msg).as_deref(), Some("ab"));

        // ISO-8859-1 "caf\xe9" must not make the whole body disappear
        let msg = message_with_parts(vec![part("text/plain", Some(b64url(b"caf\xe9 ok")), None)]);
        let text = extract_body_text_from_message(&msg).expect("body present");
        assert!(text.starts_with("caf") && text.ends_with(" ok"));
    }

    #[test]
    fn attachment_filenames_are_escaped_and_encoded() {
        let attachment = SendAttachment {
            filename: "año \"final\"\r\n.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            data: "QUJD".to_string(),
        };
        let message = build_mime_message(&OutgoingMessage {
            to: "x@example.com",
            body: "hi",
            attachments: std::slice::from_ref(&attachment),
            ..Default::default()
        }, None);
        assert!(message.is_ascii(), "raw non-ASCII in headers");
        assert!(message.contains("filename*=UTF-8''a%C3%B1o%20%22final%22%20.pdf\r\n"));
        assert!(message.contains("Content-Disposition: attachment; filename=\"=?UTF-8?B?"));
        assert!(message.contains("Content-Type: application/pdf; name=\"=?UTF-8?B?"));
        assert!(!message.contains("\r\n.pdf"));

        let ascii = SendAttachment {
            filename: "say \"hi\".txt".to_string(),
            mime_type: "text/plain".to_string(),
            data: "QUJD".to_string(),
        };
        let message = build_mime_message(&OutgoingMessage {
            to: "x@example.com",
            body: "hi",
            attachments: std::slice::from_ref(&ascii),
            ..Default::default()
        }, None);
        assert!(message.contains("Content-Type: text/plain; name=\"say \\\"hi\\\".txt\"\r\n"));
        assert!(message.contains("Content-Disposition: attachment; filename=\"say \\\"hi\\\".txt\"\r\n"));
    }

    #[test]
    fn attachment_data_with_whitespace_is_rewrapped_cleanly() {
        use base64::Engine;
        let bytes: Vec<u8> = (0..200u8).collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        // Data URLs copied from elsewhere may carry line breaks every 60 chars
        let wrapped: String = encoded
            .as_bytes()
            .chunks(60)
            .map(|c| std::str::from_utf8(c).unwrap())
            .collect::<Vec<_>>()
            .join("\r\n ");
        let attachment = SendAttachment {
            filename: "bytes.bin".to_string(),
            mime_type: "application/octet-stream".to_string(),
            data: wrapped,
        };
        let message = build_mime_message(&OutgoingMessage {
            to: "x@example.com",
            body: "hi",
            attachments: std::slice::from_ref(&attachment),
            ..Default::default()
        }, None);
        let data = part_body(&message, "Content-Type: application/octet-stream;");
        let lines: Vec<&str> = data.split("\r\n").filter(|l| !l.is_empty()).collect();
        for line in &lines {
            assert!(line.len() <= 76 && !line.contains(' '), "bad base64 line {:?}", line);
        }
        let lines_before_last = &lines[..lines.len() - 1];
        assert!(lines_before_last.iter().all(|l| l.len() == 76), "short line mid-body");
        let decoded = base64::engine::general_purpose::STANDARD.decode(lines.concat()).unwrap();
        assert_eq!(decoded, bytes);
    }

    /// Independent RFC 2045 quoted-printable decoder for checking encoded bodies
    fn decode_qp(encoded: &str) -> String {
        let joined = encoded.replace("=\r\n", "");
        let bytes = joined.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'=' {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap();
                out.push(u8::from_str_radix(hex, 16).unwrap());
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out).unwrap()
    }

    /// The body of the part declared by `content_type_line`, up to the next boundary
    fn part_body<'a>(message: &'a str, content_type_line: &str) -> &'a str {
        let start = message.find(content_type_line).expect("part present");
        let headers_end = start + message[start..].find("\r\n\r\n").unwrap() + 4;
        let rest = &message[headers_end..];
        let end = rest.find("\r\n--").unwrap_or(rest.len());
        &rest[..end]
    }

    fn assert_lines_within_limit(message: &str, limit: usize) {
        for line in message.split("\r\n") {
            assert!(line.len() <= limit, "line of {} chars: {:.40}...", line.len(), line);
        }
    }

    #[test]
    fn text_bodies_are_quoted_printable_with_short_lines() {
        let long_line = "word ".repeat(400);
        let body = format!("Hola, ¿qué tal? ☕\n{}\nend = 1 \n", long_line.trim_end());

        let plain = build_mime_message(&OutgoingMessage { to: "x@example.com", body: &body, ..Default::default() }, None);
        assert!(plain.is_ascii(), "raw 8-bit text in the message");
        assert_lines_within_limit(&plain, 998);
        assert!(plain.contains("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"));
        let encoded = &plain[plain.find("\r\n\r\n").unwrap() + 4..];
        assert_lines_within_limit(encoded, 76);
        assert_eq!(decode_qp(encoded), body.replace('\n', "\r\n"));

        let html = format!("<p>{}</p><p>Café</p>", long_line);
        let attachment = SendAttachment {
            filename: "a.txt".to_string(),
            mime_type: "text/plain".to_string(),
            data: "QUJD".to_string(),
        };
        for attachments in [&[][..], std::slice::from_ref(&attachment)] {
            let message = build_mime_message(&OutgoingMessage {
                to: "x@example.com",
                body: &html,
                is_html: true,
                attachments,
                ..Default::default()
            }, None);
            assert!(message.is_ascii());
            assert_lines_within_limit(&message, 998);
            let html_part = part_body(&message, "Content-Type: text/html; charset=utf-8\r\n");
            assert_lines_within_limit(html_part, 76);
            assert_eq!(decode_qp(html_part), html);
            let text_part = part_body(&message, "Content-Type: text/plain; charset=utf-8\r\n");
            assert!(decode_qp(text_part).ends_with("\r\nCafé\r\n"));
        }
    }

    #[test]
    fn batch_body_parses_crlf_and_lf_parts_and_skips_errors() {
        let body = concat!(
            "--batch_x\r\n",
            "Content-Type: application/http\r\n",
            "Content-ID: <response-item0>\r\n\r\n",
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: application/json; charset=UTF-8\r\n\r\n",
            "{\"id\": \"t1\", \"messages\": []}\r\n",
            "--batch_x\n",
            "Content-Type: application/http\n\n",
            "HTTP/1.1 200 OK\n",
            "Content-Type: application/json\n\n",
            "{\"id\": \"t2\"}\n",
            "--batch_x\r\n",
            "Content-Type: application/http\r\n\r\n",
            "HTTP/1.1 429 Too Many Requests\r\n\r\n",
            "{\"error\": {\"code\": 429}}\r\n",
            "--batch_x--\r\n",
        );
        let ids: Vec<String> = parse_batch_body(body, "batch_x").into_iter().map(|d| d.id).collect();
        assert_eq!(ids, vec!["t1", "t2"]);
    }

    #[test]
    fn thread_summary_fields_request_part_headers_at_every_level() {
        // Each nesting level of the mask must ask for the part headers (for
        // Content-ID) and the attachment id, or inline images deeper down lose them
        let level = "parts(mimeType,filename,headers,body(size,attachmentId)";
        assert_eq!(THREAD_SUMMARY_FIELDS.matches(level).count(), 3);
        assert_eq!(THREAD_SUMMARY_FIELDS.matches('(').count(), THREAD_SUMMARY_FIELDS.matches(')').count());
    }

    #[test]
    fn thread_summary_with_image_three_levels_deep_parses() {
        // mixed > alternative > related > image, as trimmed by THREAD_SUMMARY_FIELDS
        let response = r#"{
            "id": "t1",
            "messages": [{
                "id": "m1",
                "labelIds": ["INBOX", "UNREAD"],
                "snippet": "See attached",
                "internalDate": "1705330800000",
                "payload": {
                    "mimeType": "multipart/mixed",
                    "headers": [{"name": "From", "value": "Ann <ann@example.com>"},
                                {"name": "Subject", "value": "Plans"}],
                    "parts": [
                        {"mimeType": "multipart/alternative", "filename": "", "headers": [], "body": {"size": 0},
                         "parts": [
                            {"mimeType": "text/plain", "filename": "", "body": {"size": 12}},
                            {"mimeType": "multipart/related", "filename": "", "body": {"size": 0},
                             "parts": [
                                {"mimeType": "text/html", "filename": "", "body": {"size": 40}},
                                {"mimeType": "image/png", "filename": "",
                                 "headers": [{"name": "Content-Id", "value": "<logo@x>"}],
                                 "body": {"size": 2048, "attachmentId": "att-img"}}
                             ]}
                         ]},
                        {"mimeType": "application/pdf", "filename": "plan.pdf",
                         "headers": [{"name": "Content-Disposition", "value": "attachment"}],
                         "body": {"size": 90000, "attachmentId": "att-pdf"}}
                    ]
                }
            }]
        }"#;
        let detail: ThreadDetail = serde_json::from_str(response).expect("summary parses");
        let messages = detail.messages.expect("messages");
        let attachments = extract_attachments_from_parts(&messages[0].payload.as_ref().unwrap().parts);
        let summary: Vec<(&str, &str, Option<&str>)> = attachments
            .iter()
            .map(|a| (a.attachment_id.as_str(), a.filename.as_str(), a.content_id.as_deref()))
            .collect();
        assert_eq!(
            summary,
            vec![("att-img", "logo@x.png", Some("logo@x")), ("att-pdf", "plan.pdf", None)]
        );
        assert_eq!(thread_participants(&messages), vec!["ann@example.com"]);
    }

    #[test]
    fn thread_summary_takes_subject_from_latest_message_that_is_not_a_reaction() {
        let response = r#"{
            "id": "t1",
            "messages": [
                {"id": "m1", "labelIds": ["INBOX", "UNREAD"], "snippet": "Lunch at noon?",
                 "internalDate": "1705330800000",
                 "payload": {"mimeType": "text/plain",
                             "headers": [{"name": "From", "value": "ann@example.com"},
                                         {"name": "Subject", "value": "Plans"}]}},
                {"id": "m2", "labelIds": ["INBOX", "UNREAD"], "snippet": "Reacted with 👍",
                 "internalDate": "1705334400000",
                 "payload": {"mimeType": "multipart/alternative",
                             "headers": [{"name": "From", "value": "bob@example.com"},
                                         {"name": "Subject", "value": "Re: 👍"}],
                             "parts": [{"mimeType": "text/plain", "body": {"size": 5}},
                                       {"mimeType": "text/vnd.google.email-reaction+json", "body": {"size": 30}}]}}
            ]
        }"#;
        let thread = thread_summary(serde_json::from_str(response).unwrap());
        assert_eq!(thread.gmail_thread_id, "t1");
        assert_eq!(thread.subject, "Plans");
        assert_eq!(thread.snippet, "Lunch at noon?");
        // Ordering still follows the newest activity
        assert_eq!(thread.last_message_date.timestamp_millis(), 1705334400000);
        assert_eq!(thread.unread_count, 2);
        assert_eq!(thread.participants, vec!["ann@example.com", "bob@example.com"]);
        assert!(!thread.has_attachment);
        assert!(thread.calendar_event.is_none());
    }

    #[test]
    fn thread_summary_defaults_when_headers_are_missing() {
        let thread = thread_summary(serde_json::from_str(r#"{"id": "t2"}"#).unwrap());
        assert_eq!(thread.subject, "(No Subject)");
        assert_eq!(thread.snippet, "");
        assert_eq!(thread.unread_count, 0);
    }

    #[test]
    fn batch_boundary_ignores_trailing_parameters() {
        assert_eq!(
            batch_boundary("multipart/mixed; boundary=batch_abc; charset=UTF-8").as_deref(),
            Some("batch_abc")
        );
        assert_eq!(batch_boundary("multipart/mixed; boundary=\"batch_q\"").as_deref(), Some("batch_q"));
        assert_eq!(batch_boundary("application/json"), None);
    }

    fn at(rfc3339: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc3339).unwrap().with_timezone(&Utc)
    }

    fn bucket(date: &str, now: &str) -> &'static str {
        classify_date(at(date), &DateTime::parse_from_rfc3339(now).unwrap()).as_str()
    }

    #[test]
    fn classify_date_buckets_by_local_calendar_day() {
        // Wednesday 2024-01-17, 10:00 in Buenos Aires (UTC-3)
        let now = "2024-01-17T10:00:00-03:00";
        assert_eq!(bucket("2024-01-17T04:00:00Z", now), "Today"); // 01:00 local
        assert_eq!(bucket("2024-01-17T02:00:00Z", now), "Yesterday"); // 23:00 local on the 16th
        assert_eq!(bucket("2024-01-15T12:00:00-03:00", now), "This week"); // Monday
        assert_eq!(bucket("2024-01-14T23:59:00-03:00", now), "Last 30 days"); // Sunday before
        assert_eq!(bucket("2023-12-18T00:00:00-03:00", now), "Last 30 days");
        assert_eq!(bucket("2023-12-17T23:59:00-03:00", now), "Older");
    }

    #[test]
    fn classify_date_on_monday_keeps_sunday_as_yesterday() {
        let now = "2024-01-15T09:00:00+09:00";
        assert_eq!(bucket("2024-01-14T12:00:00+09:00", now), "Yesterday");
        assert_eq!(bucket("2024-01-13T12:00:00+09:00", now), "Last 30 days");
    }

    fn thread_at(id: &str, date: &str) -> Thread {
        Thread {
            gmail_thread_id: id.to_string(),
            account_id: String::new(),
            subject: String::new(),
            snippet: String::new(),
            last_message_date: at(date),
            unread_count: 0,
            labels: Vec::new(),
            participants: Vec::new(),
            has_attachment: false,
            attachments: Vec::new(),
            calendar_event: None,
        }
    }

    #[test]
    fn group_threads_orders_buckets_and_sorts_newest_first() {
        let now = DateTime::parse_from_rfc3339("2024-01-17T10:00:00Z").unwrap();
        let groups = group_threads_by_date(
            vec![
                thread_at("old", "2023-01-01T00:00:00Z"),
                thread_at("today-early", "2024-01-17T01:00:00Z"),
                thread_at("yesterday", "2024-01-16T12:00:00Z"),
                thread_at("today-late", "2024-01-17T09:00:00Z"),
            ],
            &now,
        );
        let shape: Vec<(String, Vec<String>)> = groups
            .into_iter()
            .map(|g| (g.label, g.threads.into_iter().map(|t| t.gmail_thread_id).collect()))
            .collect();
        let expected: Vec<(String, Vec<String>)> = [
            ("Today", vec!["today-late", "today-early"]),
            ("Yesterday", vec!["yesterday"]),
            ("Older", vec!["old"]),
        ]
        .into_iter()
        .map(|(l, ids)| (l.to_string(), ids.into_iter().map(String::from).collect()))
        .collect();
        assert_eq!(shape, expected);
    }

    fn reaction_part(json: &str) -> MessagePart {
        part("text/vnd.google.email-reaction+json", Some(b64url(json.as_bytes())), None)
    }

    #[test]
    fn parse_reaction_finds_nested_reaction_part() {
        // mixed > related > alternative > reaction
        let mut msg = message_with_parts(vec![part(
            "multipart/related",
            None,
            Some(vec![part(
                "multipart/alternative",
                None,
                Some(vec![
                    part("text/plain", Some(b64url(b"Reacted with x")), None),
                    reaction_part("{\"version\":1,\"emoji\":\"\u{1F44D}\"}"),
                ]),
            )]),
        )]);
        msg.payload.as_mut().unwrap().headers = Some(vec![
            header("From", "Bob <bob@example.com>"),
            header("In-Reply-To", "<orig@example.com>"),
        ]);
        let reaction = parse_reaction_from_message(&msg).expect("reaction parsed");
        assert_eq!(reaction.emoji, "\u{1F44D}");
        assert_eq!(reaction.from_addr, "bob@example.com");
        assert_eq!(reaction.in_reply_to, "<orig@example.com>");
    }

    #[test]
    fn parse_reaction_rejects_wrong_version_and_plain_mail() {
        let mut msg = message_with_parts(vec![reaction_part("{\"version\":2,\"emoji\":\"x\"}")]);
        msg.payload.as_mut().unwrap().headers = Some(vec![
            header("From", "bob@example.com"),
            header("In-Reply-To", "<orig@example.com>"),
        ]);
        assert!(parse_reaction_from_message(&msg).is_none());

        let mut plain = message_with_parts(vec![part("text/plain", Some(b64url(b"hi")), None)]);
        plain.payload.as_mut().unwrap().headers = msg.payload.as_ref().unwrap().headers.clone();
        assert!(parse_reaction_from_message(&plain).is_none());
    }

    #[test]
    fn reaction_eligibility_follows_google_limits() {
        let target = full_message("m1", &["INBOX"], vec![
            header("From", "bob@example.com"),
            header("To", "Me <ME@example.com>, \"Doe, J\" <j@example.com>"),
        ]);
        assert_eq!(check_can_react(&target, "me@example.com"), Ok(()));
        assert!(check_can_react(&target, "other@example.com").is_err());

        let mut list = target.clone();
        list.payload.as_mut().unwrap().headers.as_mut().unwrap()
            .push(header("List-Id", "<dev.lists.example.com>"));
        assert!(check_can_react(&list, "me@example.com").is_err());

        let many: Vec<String> = (0..21).map(|i| format!("u{}@example.com", i)).collect();
        let crowded = full_message("m2", &["INBOX"], vec![
            header("To", &format!("me@example.com, {}", many.join(", "))),
        ]);
        assert!(check_can_react(&crowded, "me@example.com").is_err());
    }
}
