// Shared data types for the Gmail IMAP client

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::calendar::CalendarEvent as GoogleCalendarEvent;
pub use crate::calendar::EventAttendee as GoogleCalendarEventAttendee;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub picture: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(skip_serializing)]
    pub refresh_token_ref: Option<String>,
}

impl Account {
    pub fn new(email: String, picture: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            email,
            picture,
            signature: None,
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
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_group_by")]
    pub group_by: String,
    #[serde(default = "default_card_type")]
    pub card_type: String, // "email" or "calendar"
}

fn default_group_by() -> String {
    "date".to_string()
}

fn default_card_type() -> String {
    "email".to_string()
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
            color: None,
            group_by: "date".to_string(),
            card_type: "email".to_string(),
        }
    }

    pub fn new_calendar(account_id: String, name: String, query: String, position: i32) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            account_id,
            name,
            query,
            position,
            collapsed: false,
            color: None,
            group_by: "date".to_string(),
            card_type: "calendar".to_string(),
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
    /// Content-ID for inline images (used for cid: references in HTML)
    pub content_id: Option<String>,
}

impl Attachment {
    pub fn is_image(&self) -> bool {
        self.mime_type.starts_with("image/")
    }

    pub fn is_calendar(&self) -> bool {
        self.mime_type == "text/calendar"
            || self.mime_type == "application/ics"
            || self.filename.ends_with(".ics")
    }
}

/// Calendar event extracted from ICS attachment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    /// Event UID from ICS
    pub uid: Option<String>,
    /// Event title (SUMMARY)
    pub title: String,
    /// Start time as Unix timestamp in milliseconds
    pub start_time: i64,
    /// End time as Unix timestamp in milliseconds (optional for all-day events)
    pub end_time: Option<i64>,
    /// Whether this is an all-day event
    pub all_day: bool,
    /// Location (LOCATION)
    pub location: Option<String>,
    /// Description (DESCRIPTION)
    pub description: Option<String>,
    /// Organizer email
    pub organizer: Option<String>,
    /// Attendee emails
    pub attendees: Vec<String>,
    /// Event method: REQUEST (invite), REPLY, CANCEL
    pub method: Option<String>,
    /// Event status: CONFIRMED, TENTATIVE, CANCELLED
    pub status: Option<String>,
    /// User's response status: accepted, tentative, declined, needsAction
    pub response_status: Option<String>,
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
    /// Calendar event if this thread contains a calendar invite
    pub calendar_event: Option<CalendarEvent>,
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

/// Email reaction (emoji response to a message)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reaction {
    /// The emoji used for this reaction
    pub emoji: String,
    /// Email address of the person who reacted
    pub from_addr: String,
    /// Message ID this reaction is in response to
    pub in_reply_to: String,
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
