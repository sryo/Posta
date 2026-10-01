// Shared data types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::calendar::CalendarEvent as GoogleCalendarEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub picture: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
}

impl Account {
    pub fn new(email: String, picture: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            email,
            picture,
            signature: None,
        }
    }
}

/// `Card::account_id` of a card showing the mail or events of every
/// signed-in account
pub const ALL_ACCOUNTS: &str = "all";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
            card_type: "calendar".to_string(),
            ..Self::new(account_id, name, query, position)
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

/// Below this an image with a Content-ID is a logo or a signature, not a photo
const EMBEDDED_IMAGE_MAX_SIZE: i32 = 15_000;

impl Attachment {
    /// An image the message body draws in place, such as a logo or a signature,
    /// rather than a file sent along. Photos from Apple Mail carry a Content-ID
    /// too, so it also takes an unnamed part (named after its Content-ID), an
    /// Outlook-style "image001.png", or a small size.
    pub fn looks_embedded(&self) -> bool {
        let Some(cid) = self.content_id.as_deref() else { return false };
        if !self.mime_type.starts_with("image/") {
            return false;
        }
        let stem = self.filename.rsplit_once('.').map_or(self.filename.as_str(), |(stem, _)| stem);
        let outlook = stem.len() == 8
            && stem.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("image"))
            && stem[5..].bytes().all(|b| b.is_ascii_digit());
        stem == cid || outlook || self.size < EMBEDDED_IMAGE_MAX_SIZE
    }

    pub fn is_calendar(&self) -> bool {
        let has_ics_extension = self
            .filename
            .rsplit_once('.')
            .is_some_and(|(_, ext)| ext.eq_ignore_ascii_case("ics"));
        self.mime_type.eq_ignore_ascii_case("text/calendar")
            || self.mime_type.eq_ignore_ascii_case("application/ics")
            || has_ics_extension
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
    /// Video call link (X-GOOGLE-CONFERENCE)
    #[serde(default)]
    pub conference_url: Option<String>,
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
    /// The From of the latest message that isn't a reaction
    #[serde(default)]
    pub last_sender: Option<String>,
    /// Whether that message came from a mailing list
    #[serde(default)]
    pub last_from_list: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadGroup {
    pub label: String,
    pub threads: Vec<Thread>,
}

#[derive(Debug)]
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

#[cfg(test)]
mod tests {
    use super::Attachment;

    fn attachment(filename: &str, mime_type: &str) -> Attachment {
        Attachment {
            message_id: "m".into(),
            attachment_id: "a".into(),
            filename: filename.into(),
            mime_type: mime_type.into(),
            size: 1,
            inline_data: None,
            content_id: None,
        }
    }

    #[test]
    fn calendar_invites_are_recognised_whatever_the_case() {
        assert!(attachment("invite.ics", "application/octet-stream").is_calendar());
        assert!(attachment("INVITE.ICS", "application/octet-stream").is_calendar());
        assert!(attachment("", "text/calendar").is_calendar());
        assert!(attachment("", "Text/Calendar").is_calendar());
        assert!(attachment("", "application/ics").is_calendar());
        assert!(!attachment("notes.txt", "text/plain").is_calendar());
        assert!(!attachment("topics", "text/plain").is_calendar());
    }
}

#[cfg(test)]
mod embedded_image_tests {
    use super::Attachment;

    fn image(filename: &str, size: i32, content_id: Option<&str>) -> Attachment {
        Attachment {
            message_id: "m".into(),
            attachment_id: "a".into(),
            filename: filename.into(),
            mime_type: "image/png".into(),
            size,
            inline_data: None,
            content_id: content_id.map(Into::into),
        }
    }

    #[test]
    fn looks_embedded_takes_logos_and_leaves_photos() {
        assert!(image("ii_abc123.png", 90_000, Some("ii_abc123")).looks_embedded());
        assert!(image("image001.png", 90_000, Some("x@y")).looks_embedded());
        assert!(image("logo.png", 4_000, Some("x@y")).looks_embedded());
        assert!(!image("IMG_2041.jpeg", 900_000, Some("B1C2@apple")).looks_embedded());
        assert!(!image("photo.png", 4_000, None).looks_embedded());
    }
}
