// Shared data types for the Gmail IMAP client

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub picture: Option<String>,
    #[serde(skip_serializing)]
    pub refresh_token_ref: Option<String>,
}

impl Account {
    pub fn new(email: String, picture: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            email,
            picture,
            refresh_token_ref: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub account_id: String,
    pub name: String,
    pub query: String,
    pub position: i32,
    pub collapsed: bool,
}

impl Card {
    pub fn new(account_id: String, name: String, query: String, position: i32) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            account_id,
            name,
            query,
            position,
            collapsed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub message_id: String,
    pub attachment_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i32,
    /// Base64-encoded data for small images (< 100KB), None for larger files
    pub inline_data: Option<String>,
}

impl Attachment {
    pub fn is_image(&self) -> bool {
        self.mime_type.starts_with("image/")
    }
}

/// Attachment for outgoing emails (compose/reply)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendAttachment {
    pub filename: String,
    pub mime_type: String,
    /// Base64-encoded file data
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub gmail_thread_id: String,
    pub account_id: String,
    pub subject: String,
    pub snippet: String,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub last_message_date: DateTime<Utc>,
    pub unread_count: i32,
    pub labels: Vec<String>,
    pub participants: Vec<String>,
    pub has_attachment: bool,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub gmail_msg_id: String,
    pub thread_id: String,
    pub from_addr: String,
    pub to_addrs: Vec<String>,
    pub date: DateTime<Utc>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadGroup {
    pub label: String,
    pub threads: Vec<Thread>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResult {
    pub groups: Vec<ThreadGroup>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DateBucket {
    Today,
    Yesterday,
    ThisWeek,
    Last30Days,
    Older,
}

impl DateBucket {
    pub fn as_str(&self) -> &'static str {
        match self {
            DateBucket::Today => "Today",
            DateBucket::Yesterday => "Yesterday",
            DateBucket::ThisWeek => "This week",
            DateBucket::Last30Days => "Last 30 days",
            DateBucket::Older => "Older",
        }
    }
}
