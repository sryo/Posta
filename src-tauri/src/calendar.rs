// Google Calendar API client

use chrono::{DateTime, Duration, Local, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use futures::{FutureExt, StreamExt};
use reqwest::StatusCode;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";
// Events-list page size (the API default) and a per-calendar safety cap so a
// runaway calendar can't page forever
const EVENTS_PAGE_SIZE: i32 = 250;
const PER_CALENDAR_EVENT_CAP: usize = 500;
const CALENDAR_LIST_PAGE_SIZE: i32 = 250;
const CALENDAR_LIST_CAP: usize = 1000;
/// Secondary calendars searched at once per invite lookup; several invite
/// rows look up at the same time, and Google rate-limits per user
const INVITE_SEARCH_CONCURRENCY: usize = 4;
/// Calendars one card's search lists events from at once
const SEARCH_CONCURRENCY: usize = 6;
const CALENDAR_LIST_TTL: std::time::Duration = std::time::Duration::from_secs(120);
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

fn build_http_client(timeout: std::time::Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// One connection pool for every Google API client, so each command doesn't
/// pay for a fresh TLS handshake
pub(crate) static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| build_http_client(REQUEST_TIMEOUT));

type CalendarListSlot = Arc<tokio::sync::Mutex<Option<(std::time::Instant, Result<Arc<Vec<CalendarInfo>>, String>)>>>;

/// Calendar lists, keyed by (API base, access token)
static CALENDAR_LISTS: LazyLock<Mutex<HashMap<(String, String), CalendarListSlot>>> = LazyLock::new(Default::default);

/// Calendar info returned to frontend
#[derive(Debug, Clone, Serialize)]
pub struct CalendarInfo {
    pub id: String,
    pub name: String,
    pub is_primary: bool,
    pub access_role: String, // owner, writer, reader, freeBusyReader
    pub timezone: Option<String>, // IANA timezone (e.g. "America/Argentina/Buenos_Aires")
}

/// Convert calendar API errors to user-friendly messages
fn friendly_calendar_error(status: StatusCode, body: &str) -> String {
    // Check for specific error patterns
    if body.contains("SERVICE_DISABLED") || body.contains("has not been used in project") {
        return "Calendar API not enabled. Please enable Google Calendar API in your Google Cloud Console and re-login.".to_string();
    }

    if body.contains("invalid_grant") || body.contains("Token has been expired") {
        return "Calendar access expired. Please re-login to refresh permissions.".to_string();
    }

    if body.contains("insufficientPermissions") || body.contains("access denied") {
        return "Calendar permission denied. Please re-login to grant calendar access.".to_string();
    }

    let api_error = serde_json::from_str::<ApiErrorBody>(body).ok().map(|b| b.error);
    let rate_limited = api_error.iter().flat_map(|e| &e.errors).any(|e| {
        matches!(
            e.reason.as_deref(),
            Some("rateLimitExceeded" | "userRateLimitExceeded" | "quotaExceeded")
        )
    });
    if rate_limited || status == StatusCode::TOO_MANY_REQUESTS {
        return "Too many requests. Please try again later.".to_string();
    }

    match status {
        StatusCode::UNAUTHORIZED => "Calendar access expired. Please re-login.".to_string(),
        // Other 403s are about this calendar or event (read-only calendar,
        // not the organizer), which Google explains better than we can
        StatusCode::FORBIDDEN => api_error
            .and_then(|e| e.message)
            .unwrap_or_else(|| "You don't have permission to change this calendar.".to_string()),
        StatusCode::NOT_FOUND => "Event or calendar not found. It may have been deleted.".to_string(),
        StatusCode::GONE => "This event was already deleted.".to_string(),
        _ => format!("Calendar error ({})", status),
    }
}

/// A transport failure in words the user can act on, without the request
/// URL (it can hold the user's search text)
fn calendar_request_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Google Calendar didn't respond. Check your connection and try again.".to_string()
    } else if e.is_connect() {
        "Couldn't reach Google Calendar. Check your connection and try again.".to_string()
    } else {
        format!("Calendar request failed: {}", e.without_url())
    }
}

#[derive(Deserialize)]
struct ApiErrorBody {
    error: ApiError,
}

#[derive(Deserialize)]
struct ApiError {
    message: Option<String>,
    #[serde(default)]
    errors: Vec<ApiErrorItem>,
}

#[derive(Deserialize)]
struct ApiErrorItem {
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: i64,      // Unix timestamp in milliseconds
    pub end_time: Option<i64>, // Unix timestamp in milliseconds
    pub all_day: bool,
    pub status: String, // confirmed, tentative, cancelled
    pub organizer: Option<String>,
    pub attendees: Vec<EventAttendee>,
    pub html_link: Option<String>,
    pub hangout_link: Option<String>,
    pub response_status: Option<String>, // accepted, declined, tentative, needsAction
    #[serde(default)]
    pub can_edit: bool, // whether the current user can edit this event
    /// Set on one occurrence of a repeating event: the series' id
    #[serde(default)]
    pub recurring_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventAttendee {
    pub email: String,
    pub display_name: Option<String>,
    pub response_status: Option<String>,
    pub is_self: bool,
    pub is_organizer: bool,
}

/// One page of a list endpoint (calendarList, events)
#[derive(Debug, Deserialize)]
struct Page<T> {
    items: Option<Vec<T>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CalendarListEntry {
    id: String,
    summary: Option<String>,
    #[serde(rename = "summaryOverride")]
    summary_override: Option<String>,
    primary: Option<bool>,
    #[serde(rename = "accessRole")]
    access_role: Option<String>,
    #[serde(rename = "timeZone")]
    time_zone: Option<String>,
}

impl From<CalendarListEntry> for CalendarInfo {
    fn from(c: CalendarListEntry) -> Self {
        CalendarInfo {
            id: c.id,
            name: c.summary_override.filter(|s| !s.is_empty()).or(c.summary).unwrap_or_default(),
            is_primary: c.primary.unwrap_or(false),
            access_role: c.access_role.unwrap_or_else(|| "reader".to_string()),
            timezone: c.time_zone,
        }
    }
}

#[derive(Debug, Deserialize)]
struct EventCreator {
    #[serde(rename = "self")]
    is_self: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ApiEvent {
    id: String,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    status: Option<String>,
    start: Option<EventDateTime>,
    end: Option<EventDateTime>,
    creator: Option<EventCreator>,
    organizer: Option<EventOrganizer>,
    attendees: Option<Vec<ApiAttendee>>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
    #[serde(rename = "hangoutLink")]
    hangout_link: Option<String>,
    #[serde(rename = "guestsCanModify")]
    guests_can_modify: Option<bool>,
    locked: Option<bool>,
    #[serde(rename = "recurringEventId")]
    recurring_event_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct EventDateTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EventOrganizer {
    email: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "self")]
    is_self: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ApiAttendee {
    email: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "responseStatus")]
    response_status: Option<String>,
    #[serde(rename = "self")]
    is_self: Option<bool>,
    organizer: Option<bool>,
}

#[derive(Debug, Serialize)]
struct CreateEventRequest {
    summary: String,
    description: Option<String>,
    location: Option<String>,
    start: EventDateTimeInput,
    end: EventDateTimeInput,
    #[serde(skip_serializing_if = "Option::is_none")]
    attendees: Option<Vec<CalEventAttendee>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recurrence: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct EventDateTimeInput {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
    // Required by the API for recurring events: the zone the rule expands in
    #[serde(rename = "timeZone", skip_serializing_if = "Option::is_none")]
    time_zone: Option<String>,
}

#[derive(Deserialize)]
struct CalEventSearchResponse {
    items: Option<Vec<CalEventSearchItem>>,
}

#[derive(Deserialize)]
struct CalEventSearchItem {
    #[serde(default)]
    id: String,
    attendees: Option<Vec<CalEventAttendee>>,
    creator: Option<EventCreator>,
}

/// Guests hear about changes only to events the user created; anyone else's
/// event is the creator's to announce
fn send_updates(is_self_creator: bool) -> &'static str {
    if is_self_creator { "all" } else { "none" }
}

// Round-trips every attendee field, including ones not named here: the RSVP
// PATCH replaces the whole attendees array, so fields not echoed back would
// be wiped for everyone. Google leaves out the address of some guests.
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
struct CalEventAttendee {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    email: String,
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(rename = "responseStatus", skip_serializing_if = "Option::is_none")]
    response_status: Option<String>,
    #[serde(rename = "self", skip_serializing_if = "Option::is_none")]
    is_self: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    optional: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
    #[serde(rename = "additionalGuests", skip_serializing_if = "Option::is_none")]
    additional_guests: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource: Option<bool>,
    #[serde(flatten)]
    other: serde_json::Map<String, serde_json::Value>,
}

pub struct CalendarClient {
    http_client: reqwest::Client,
    access_token: String,
    api_base: String,
}

fn events_list_url(
    api_base: &str,
    calendar_id: &str,
    time_min: DateTime<Utc>,
    time_max: DateTime<Utc>,
    query: &CalendarQuery,
) -> String {
    let mut url = format!(
        "{}/calendars/{}/events?timeMin={}&timeMax={}&maxResults={}&singleEvents=true&orderBy=startTime",
        api_base,
        urlencoding::encode(calendar_id),
        urlencoding::encode(&time_min.to_rfc3339()),
        urlencoding::encode(&time_max.to_rfc3339()),
        EVENTS_PAGE_SIZE
    );
    if let Some(q) = &query.text {
        url.push_str(&format!("&q={}", urlencoding::encode(q)));
    }
    // The API omits cancelled events unless asked, so status:cancelled
    // would otherwise never match anything
    if query.status.as_deref().is_some_and(|s| s.eq_ignore_ascii_case("cancelled")) {
        url.push_str("&showDeleted=true");
    }
    url
}

/// What the event form edits, as sent by create and update
pub struct EventFields {
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: i64,
    pub end_time: i64,
    pub all_day: bool,
    pub attendees: Option<Vec<String>>,
    pub recurrence: Option<Vec<String>>,
}

/// The guest list to write, or None to leave the event's guests as they are.
/// The form only knows addresses, and the attendees array is replaced
/// wholesale, so: guests already on the event keep their whole entry (a bare
/// address would drop their response, optional flag and comment), guests
/// Google lists without an address stay, and an unchanged list isn't sent.
fn attendees_for_write(emails: Option<Vec<String>>, existing: &[CalEventAttendee]) -> Option<Vec<CalEventAttendee>> {
    let emails = emails.unwrap_or_default();
    let mut attendees: Vec<CalEventAttendee> = Vec::with_capacity(emails.len());
    for email in emails {
        if email.is_empty() || attendees.iter().any(|a| a.email.eq_ignore_ascii_case(&email)) {
            continue;
        }
        let attendee = existing
            .iter()
            .find(|a| a.email.eq_ignore_ascii_case(&email))
            .cloned()
            .unwrap_or(CalEventAttendee { email, ..Default::default() });
        attendees.push(attendee);
    }
    let (addressed, unaddressed): (Vec<&CalEventAttendee>, Vec<&CalEventAttendee>) =
        existing.iter().partition(|a| !a.email.is_empty());
    let unchanged = attendees.len() == addressed.len()
        && attendees.iter().all(|a| addressed.iter().any(|e| e.email.eq_ignore_ascii_case(&a.email)));
    if unchanged {
        return None;
    }
    attendees.extend(unaddressed.into_iter().cloned());
    Some(attendees)
}

/// Build the create/update body. `existing_attendees` is the event's current
/// guest list (empty for a new event, or when it couldn't be read: then a
/// form without guests leaves the event's guests alone).
fn build_event_request(
    fields: EventFields,
    time_zone: Option<&str>,
    existing_attendees: &[CalEventAttendee],
) -> Result<CreateEventRequest, String> {
    let start_dt = DateTime::<Utc>::from_timestamp_millis(fields.start_time).ok_or("Invalid start time")?;
    let end_dt = DateTime::<Utc>::from_timestamp_millis(fields.end_time).ok_or("Invalid end time")?;

    let (start, end) = if fields.all_day {
        // The form's end date is inclusive; Google's all-day end date is exclusive
        let exclusive_end = end_dt.checked_add_signed(Duration::days(1)).ok_or("Invalid end time")?;
        let date = |dt: DateTime<Utc>| EventDateTimeInput {
            date: Some(dt.format("%Y-%m-%d").to_string()),
            date_time: None,
            time_zone: None,
        };
        (date(start_dt), date(exclusive_end))
    } else {
        let date_time = |dt: DateTime<Utc>| EventDateTimeInput {
            date_time: Some(dt.to_rfc3339()),
            date: None,
            time_zone: time_zone.map(str::to_string),
        };
        (date_time(start_dt), date_time(end_dt))
    };

    Ok(CreateEventRequest {
        summary: fields.summary,
        description: fields.description,
        location: fields.location,
        start,
        end,
        attendees: attendees_for_write(fields.attendees, existing_attendees),
        // Google requires RFC 5545 property names ("RRULE:FREQ=DAILY"); the
        // form emits bare rule strings ("FREQ=DAILY")
        recurrence: fields.recurrence.map(|rules| {
            rules
                .into_iter()
                .map(|rule| {
                    if rule.starts_with("RRULE:")
                        || rule.starts_with("RDATE")
                        || rule.starts_with("EXRULE")
                        || rule.starts_with("EXDATE")
                    {
                        rule
                    } else {
                        format!("RRULE:{}", rule)
                    }
                })
                .collect()
        }),
    })
}

impl CalendarClient {
    pub fn new(access_token: String) -> Self {
        Self {
            http_client: HTTP_CLIENT.clone(),
            access_token,
            api_base: CALENDAR_API_BASE.to_string(),
        }
    }

    /// Send an authorized request; error statuses become friendly messages
    async fn send(&self, request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
        let resp = request
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(calendar_request_error)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(friendly_calendar_error(status, &body));
        }
        Ok(resp)
    }

    async fn send_json<T: DeserializeOwned>(&self, request: reqwest::RequestBuilder) -> Result<T, String> {
        self.send(request)
            .await?
            .json()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    calendar_request_error(e)
                } else {
                    format!("Failed to parse calendar response: {}", e.without_url())
                }
            })
    }

    /// GET `url` and the pages after it, keeping at most `cap` items
    async fn get_pages<T: DeserializeOwned>(&self, url: &str, cap: usize) -> Result<Vec<T>, String> {
        let mut items = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let page_url = match &page_token {
                Some(token) => format!("{}&pageToken={}", url, urlencoding::encode(token)),
                None => url.to_string(),
            };
            let page: Page<T> = self.send_json(self.http_client.get(&page_url)).await?;
            items.extend(page.items.unwrap_or_default());
            if items.len() >= cap {
                items.truncate(cap);
                break;
            }
            match page.next_page_token {
                Some(token) if page_token.as_ref() != Some(&token) => page_token = Some(token),
                _ => break,
            }
        }
        Ok(items)
    }

    /// List all calendars for the user
    pub async fn list_calendars(&self) -> Result<Vec<CalendarInfo>, String> {
        let url = format!("{}/users/me/calendarList?maxResults={}", self.api_base, CALENDAR_LIST_PAGE_SIZE);
        let entries: Vec<CalendarListEntry> = self.get_pages(&url, CALENDAR_LIST_CAP).await?;
        Ok(entries.into_iter().map(CalendarInfo::from).collect())
    }

    /// Look up one calendar (accepts "primary"). Best-effort: used to label
    /// events returned by write calls and to pick a recurrence time zone.
    async fn calendar_info(&self, calendar_id: &str) -> Option<CalendarInfo> {
        let url = format!(
            "{}/users/me/calendarList/{}",
            self.api_base,
            urlencoding::encode(calendar_id)
        );
        match self.send_json::<CalendarListEntry>(self.http_client.get(&url)).await {
            Ok(entry) => Some(entry.into()),
            Err(e) => {
                tracing::warn!("Failed to look up calendar {}: {}", calendar_id, e);
                None
            }
        }
    }

    /// Search events across all calendars
    pub async fn search_events(
        &self,
        query: &CalendarQuery,
        max_results: i32,
    ) -> Result<Vec<CalendarEvent>, String> {
        let calendars = self.cached_calendar_list().await?;
        let mut all_events = Vec::new();

        // Use primary calendar's timezone, or first calendar's, for time range calculation
        let timezone = calendars
            .iter()
            .find(|c| c.is_primary)
            .or_else(|| calendars.first())
            .and_then(|c| c.timezone.as_deref());

        // Determine time range from query using calendar timezone
        let (time_min, time_max) = query.get_time_range(timezone);

        let fetches: Vec<_> = calendars
            .iter()
            .map(|cal| {
                let url = events_list_url(&self.api_base, &cal.id, time_min, time_max, query);
                async move { self.get_pages::<ApiEvent>(&url, PER_CALENDAR_EVENT_CAP).await }.boxed()
            })
            .collect();
        // In calendar order, which the dedupe below relies on
        let results: Vec<_> = futures::stream::iter(fetches).buffered(SEARCH_CONCURRENCY).collect().await;

        let calendar_count = results.len();
        let mut errors: Vec<(String, String)> = Vec::new();
        // An event shared with a subscribed calendar comes back from each
        // with the same id; keep the copy from the calendar the user answers on
        let mut listed: HashMap<String, (usize, u8)> = HashMap::new();
        for (result, cal) in results.into_iter().zip(calendars.iter()) {
            match result {
                Ok(items) => {
                    let preference = copy_preference(cal);
                    let events = items
                        .into_iter()
                        .filter_map(|e| api_event_to_calendar_event(e, &cal.id, &cal.name, &cal.access_role));
                    for event in events {
                        match listed.get_mut(&event.id) {
                            Some((index, kept)) => {
                                if preference < *kept {
                                    *kept = preference;
                                    all_events[*index] = event;
                                }
                            }
                            None => {
                                listed.insert(event.id.clone(), (all_events.len(), preference));
                                all_events.push(event);
                            }
                        }
                    }
                }
                Err(e) => errors.push((cal.id.clone(), e)),
            }
        }

        // A minority of calendars failing (e.g. a freeBusyReader calendar
        // returning 403) is tolerable, but if every calendar failed surface
        // the error instead of pretending there are no events
        if !errors.is_empty() {
            if errors.len() == calendar_count {
                return Err(errors.remove(0).1);
            }
            for (cal_id, e) in &errors {
                tracing::warn!("Failed to fetch events for calendar {}: {}", cal_id, e);
            }
        }

        // Apply additional filters
        let filtered: Vec<CalendarEvent> = all_events
            .into_iter()
            .filter(|e| query.matches(e))
            .collect();

        let mut sorted = filtered;
        sorted.sort_by_key(|e| (day_start_millis(e, timezone), !e.all_day));

        // Limit results
        sorted.truncate(max_results as usize);

        Ok(sorted)
    }

    /// Create a new event
    pub async fn create_event(
        &self,
        calendar_id: &str,
        fields: EventFields,
    ) -> Result<CalendarEvent, String> {
        let url = format!(
            "{}/calendars/{}/events?sendUpdates={}",
            self.api_base,
            urlencoding::encode(calendar_id),
            send_updates(true)
        );

        let calendar = self.calendar_info(calendar_id).await;
        let time_zone = recurrence_time_zone(&fields, calendar.as_ref());
        let body = build_event_request(fields, time_zone, &[])?;
        let api_event: ApiEvent = self.send_json(self.http_client.post(&url).json(&body)).await?;

        written_event(api_event, calendar_id, calendar.as_ref())
            .ok_or_else(|| "Failed to convert created event".to_string())
    }

    /// Move an event to a different calendar
    pub async fn move_event(
        &self,
        source_calendar_id: &str,
        event_id: &str,
        destination_calendar_id: &str,
    ) -> Result<CalendarEvent, String> {
        let is_self_creator = self.is_self_creator(source_calendar_id, event_id).await;
        let url = format!(
            "{}/calendars/{}/events/{}/move?destination={}&sendUpdates={}",
            self.api_base,
            urlencoding::encode(source_calendar_id),
            urlencoding::encode(event_id),
            urlencoding::encode(destination_calendar_id),
            send_updates(is_self_creator)
        );

        let (api_event, calendar) = futures::join!(
            self.send_json::<ApiEvent>(self.http_client.post(&url)),
            self.calendar_info(destination_calendar_id)
        );
        let api_event = api_event?;
        written_event(api_event, destination_calendar_id, calendar.as_ref())
            .ok_or_else(|| "Failed to convert moved event".to_string())
    }

    /// Delete an event from a calendar
    pub async fn delete_event(
        &self,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), String> {
        let is_self_creator = self.is_self_creator(calendar_id, event_id).await;
        let url = format!(
            "{}/calendars/{}/events/{}?sendUpdates={}",
            self.api_base,
            urlencoding::encode(calendar_id),
            urlencoding::encode(event_id),
            send_updates(is_self_creator)
        );

        self.send(self.http_client.delete(&url)).await?;
        Ok(())
    }

    /// PATCH, not PUT: a PUT replaces the whole resource and would wipe
    /// everything the form doesn't send (reminders, color, visibility,
    /// availability, attachments, recurrence)
    pub async fn update_event(
        &self,
        calendar_id: &str,
        event_id: &str,
        fields: EventFields,
    ) -> Result<CalendarEvent, String> {
        let (calendar, existing) =
            futures::join!(self.calendar_info(calendar_id), self.event_people(calendar_id, event_id));
        // The current guest list is only needed when the form lists guests,
        // so a failed lookup is fatal only then
        let (existing_attendees, is_self_creator) = match existing {
            Ok(event) => (event.attendees.unwrap_or_default(), event.creator.and_then(|c| c.is_self).unwrap_or(false)),
            Err(e) if fields.attendees.as_ref().is_some_and(|a| !a.is_empty()) => return Err(e),
            Err(_) => (Vec::new(), false),
        };
        let url = format!(
            "{}/calendars/{}/events/{}?sendUpdates={}",
            self.api_base,
            urlencoding::encode(calendar_id),
            urlencoding::encode(event_id),
            send_updates(is_self_creator)
        );
        let time_zone = recurrence_time_zone(&fields, calendar.as_ref());
        let body = build_event_request(fields, time_zone, &existing_attendees)?;
        let api_event: ApiEvent = self.send_json(self.http_client.patch(&url).json(&body)).await?;

        written_event(api_event, calendar_id, calendar.as_ref())
            .ok_or_else(|| "Failed to convert updated event".to_string())
    }

    async fn event_people(&self, calendar_id: &str, event_id: &str) -> Result<CalEventSearchItem, String> {
        let url = format!(
            "{}/calendars/{}/events/{}?fields=id,attendees,creator",
            self.api_base,
            urlencoding::encode(calendar_id),
            urlencoding::encode(event_id)
        );
        self.send_json(self.http_client.get(&url)).await
    }

    /// Unknown counts as not the creator, so a failed lookup never emails guests
    async fn is_self_creator(&self, calendar_id: &str, event_id: &str) -> bool {
        match self.event_people(calendar_id, event_id).await {
            Ok(event) => event.creator.and_then(|c| c.is_self).unwrap_or(false),
            Err(e) => {
                tracing::warn!("Couldn't look up the creator of event {}: {}", event_id, e);
                false
            }
        }
    }

    /// Query a single calendar for an event by iCalUID
    async fn search_calendar_for_ical_uid(
        &self,
        calendar_id: &str,
        event_uid: &str,
    ) -> Result<Option<CalEventSearchItem>, String> {
        let search_url = format!(
            "{}/calendars/{}/events?iCalUID={}",
            self.api_base,
            urlencoding::encode(calendar_id),
            urlencoding::encode(event_uid)
        );

        let events_response: CalEventSearchResponse = self.send_json(self.http_client.get(&search_url)).await?;
        Ok(events_response.items.unwrap_or_default().into_iter().next())
    }

    /// Locate an event by iCalUID: primary calendar first (common case, no
    /// extra requests), then the account's other calendars, since invites
    /// can land on secondary calendars. `writable_only` restricts the
    /// secondary scan to calendars the user can modify (for RSVP patches).
    /// Failures on secondary calendars are logged and skipped.
    async fn find_event_by_ical_uid(
        &self,
        event_uid: &str,
        writable_only: bool,
    ) -> Result<Option<(String, CalEventSearchItem)>, String> {
        if let Some(item) = self.search_calendar_for_ical_uid("primary", event_uid).await? {
            return Ok(Some(("primary".to_string(), item)));
        }

        let calendars = self.calendars_for_invite_lookup().await;
        let candidates: Vec<&CalendarInfo> = calendars
            .iter()
            .filter(|c| {
                !c.is_primary
                    && can_hold_invites(c)
                    && (!writable_only || c.access_role == "owner" || c.access_role == "writer")
            })
            .collect();
        // Results arrive in calendar order; stopping at the first hit drops
        // the searches still in flight and never starts the rest
        let searches: Vec<_> = candidates
            .into_iter()
            .map(|cal| async move { (cal, self.search_calendar_for_ical_uid(&cal.id, event_uid).await) }.boxed())
            .collect();
        let mut results = futures::stream::iter(searches).buffered(INVITE_SEARCH_CONCURRENCY);
        while let Some((cal, result)) = results.next().await {
            match result {
                Ok(Some(item)) => return Ok(Some((cal.id.clone(), item))),
                Ok(None) => {}
                Err(e) => tracing::warn!("iCalUID lookup failed for calendar {}: {}", cal.id, e),
            }
        }
        Ok(None)
    }

    /// The account's calendar list, cached briefly: every invite row and
    /// calendar card needs it, and without the cache each would list the
    /// calendars again. Concurrent callers for one account wait for a single
    /// fetch and share its outcome; a failure is not kept for later callers.
    async fn cached_calendar_list(&self) -> Result<Arc<Vec<CalendarInfo>>, String> {
        let asked_at = std::time::Instant::now();
        let slot = {
            let mut lists = CALENDAR_LISTS.lock().unwrap_or_else(|e| e.into_inner());
            lists.retain(|_, slot| slot.try_lock().map_or(true, |s| s.as_ref().is_some_and(|(at, _)| at.elapsed() < CALENDAR_LIST_TTL)));
            lists
                .entry((self.api_base.clone(), self.access_token.clone()))
                .or_default()
                .clone()
        };
        let mut cached = slot.lock().await;
        match cached.as_ref() {
            Some((at, Ok(list))) if at.elapsed() < CALENDAR_LIST_TTL => return Ok(list.clone()),
            Some((at, Err(e))) if *at >= asked_at => return Err(e.clone()),
            _ => {}
        }
        let result = self.list_calendars().await.map(Arc::new);
        *cached = Some((std::time::Instant::now(), result.clone()));
        result
    }

    /// Invite lookups fall back to the primary calendar alone when the
    /// calendar list can't be fetched
    async fn calendars_for_invite_lookup(&self) -> Arc<Vec<CalendarInfo>> {
        self.cached_calendar_list().await.unwrap_or_else(|e| {
            tracing::warn!("Failed to list calendars for iCalUID lookup: {}", e);
            Default::default()
        })
    }

    /// Get the user's RSVP status for a calendar event from Calendar API
    /// Returns the response status: "accepted", "tentative", "declined", "needsAction", or None
    pub async fn get_calendar_event_status(
        &self,
        user_email: &str,
        event_uid: &str,
    ) -> Result<Option<String>, String> {
        let Some((calendar_id, event)) = self.find_event_by_ical_uid(event_uid, false).await? else {
            return Ok(None);
        };
        let Some(attendees) = event.attendees.as_ref() else {
            return Ok(None);
        };
        let index = self_attendee_index(attendees, user_email, calendar_id == "primary");
        Ok(index.and_then(|i| attendees[i].response_status.clone()))
    }

    /// Answer an invite found by iCalUID (an email invite)
    /// status should be "accepted", "tentative", or "declined"
    pub async fn rsvp_calendar_event(
        &self,
        user_email: &str,
        event_uid: &str,
        status: &str,
    ) -> Result<(), String> {
        let (calendar_id, event) = self
            .find_event_by_ical_uid(event_uid, true)
            .await?
            .ok_or_else(|| "Calendar event not found".to_string())?;
        let on_primary = calendar_id == "primary";
        self.patch_rsvp(&calendar_id, event, user_email, status, on_primary).await
    }

    /// Answer an event already listed from one of the user's calendars. Its
    /// id may be one occurrence of a series or come from another calendar
    /// system, so it is addressed directly rather than by iCalUID.
    pub async fn rsvp_event(
        &self,
        user_email: &str,
        calendar_id: &str,
        event_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let event = self.event_people(calendar_id, event_id).await?;
        // A primary calendar's id is the account's address
        let on_primary = calendar_id == "primary" || calendar_id.eq_ignore_ascii_case(user_email);
        self.patch_rsvp(calendar_id, event, user_email, status, on_primary).await
    }

    async fn patch_rsvp(
        &self,
        calendar_id: &str,
        event: CalEventSearchItem,
        user_email: &str,
        status: &str,
        on_primary: bool,
    ) -> Result<(), String> {
        let attendees = with_rsvp(event.attendees.unwrap_or_default(), user_email, status, on_primary);
        let patch_url = format!(
            "{}/calendars/{}/events/{}?sendUpdates=all",
            self.api_base,
            urlencoding::encode(calendar_id),
            urlencoding::encode(&event.id)
        );

        #[derive(Serialize)]
        struct PatchRequest {
            attendees: Vec<CalEventAttendee>,
        }

        self.send(self.http_client.patch(&patch_url).json(&PatchRequest { attendees }))
            .await?;
        Ok(())
    }
}

fn api_event_to_calendar_event(event: ApiEvent, calendar_id: &str, calendar_name: &str, calendar_access_role: &str) -> Option<CalendarEvent> {
    let (start_time, all_day) = parse_event_datetime(event.start.as_ref()?)?;
    let end_time = event.end.as_ref().and_then(parse_event_datetime).map(|(t, _)| t);

    let attendees: Vec<EventAttendee> = event
        .attendees
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| {
            Some(EventAttendee {
                email: a.email?,
                display_name: a.display_name,
                response_status: a.response_status,
                is_self: a.is_self.unwrap_or(false),
                is_organizer: a.organizer.unwrap_or(false),
            })
        })
        .collect();

    // Find current user's response status
    let response_status = attendees
        .iter()
        .find(|a| a.is_self)
        .and_then(|a| a.response_status.clone());

    // Extract organizer and creator info before consuming
    let is_self_organizer = event.organizer.as_ref()
        .and_then(|o| o.is_self)
        .unwrap_or(false);
    let is_self_creator = event.creator.as_ref()
        .and_then(|c| c.is_self)
        .unwrap_or(false);
    let organizer_display = event.organizer.and_then(|o| o.email.or(o.display_name));

    // Determine if user can edit this event:
    // Calendar must have write access (owner or writer), event must not be locked, and one of:
    // 1. User is the organizer (from organizer.self field)
    // 2. User is the creator (from creator.self field)
    // 3. guestsCanModify is true and user is an attendee
    let has_calendar_write_access = calendar_access_role == "owner" || calendar_access_role == "writer";
    let is_locked = event.locked.unwrap_or(false);
    let is_attendee = attendees.iter().any(|a| a.is_self);
    let guests_can_modify = event.guests_can_modify.unwrap_or(false);
    let can_edit = has_calendar_write_access && !is_locked && (is_self_organizer || is_self_creator || (guests_can_modify && is_attendee));

    tracing::debug!(
        "Event '{}': calendar_access={}, is_self_organizer={}, is_self_creator={}, guests_can_modify={}, is_attendee={}, is_locked={}, can_edit={}",
        event.summary.as_deref().unwrap_or("(no title)"),
        calendar_access_role,
        is_self_organizer,
        is_self_creator,
        guests_can_modify,
        is_attendee,
        is_locked,
        can_edit
    );

    Some(CalendarEvent {
        id: event.id,
        calendar_id: calendar_id.to_string(),
        calendar_name: calendar_name.to_string(),
        title: event.summary.unwrap_or_else(|| "(No title)".to_string()),
        description: event.description,
        location: event.location,
        start_time,
        end_time,
        all_day,
        status: event.status.unwrap_or_else(|| "confirmed".to_string()),
        organizer: organizer_display,
        attendees,
        html_link: event.html_link,
        hangout_link: event.hangout_link,
        response_status,
        can_edit,
        recurring_event_id: event.recurring_event_id,
    })
}

/// Which copy of an event listed from several calendars to keep (lower
/// wins): the user's primary calendar, then one they can write to
fn copy_preference(calendar: &CalendarInfo) -> u8 {
    match calendar.access_role.as_str() {
        _ if calendar.is_primary => 0,
        "owner" | "writer" => 1,
        _ => 2,
    }
}

/// Free/busy calendars show no attendees, and Google's generated calendars
/// (holidays, contacts' birthdays, week numbers: ids under
/// group.v.calendar.google.com) never receive invitations
fn can_hold_invites(calendar: &CalendarInfo) -> bool {
    calendar.access_role != "freeBusyReader" && !calendar.id.ends_with("@group.v.calendar.google.com")
}

/// The user's entry in an attendee list. The API's `self` flag marks the
/// owner of the calendar the event was read from, so on the primary
/// calendar it also finds invites sent to one of the user's aliases; on
/// other calendars it would be someone else.
fn self_attendee_index(attendees: &[CalEventAttendee], user_email: &str, on_primary: bool) -> Option<usize> {
    attendees
        .iter()
        .position(|a| a.email.eq_ignore_ascii_case(user_email))
        .or_else(|| on_primary.then(|| attendees.iter().position(|a| a.is_self == Some(true))).flatten())
}

/// The attendee list with the user's response set, adding the user if absent
fn with_rsvp(
    mut attendees: Vec<CalEventAttendee>,
    user_email: &str,
    status: &str,
    on_primary: bool,
) -> Vec<CalEventAttendee> {
    match self_attendee_index(&attendees, user_email, on_primary) {
        Some(i) => attendees[i].response_status = Some(status.to_string()),
        None => attendees.push(CalEventAttendee {
            email: user_email.to_string(),
            response_status: Some(status.to_string()),
            is_self: Some(true),
            ..Default::default()
        }),
    }
    attendees
}

/// Recurring events need the zone their rule expands in; single events don't
fn recurrence_time_zone<'a>(fields: &EventFields, calendar: Option<&'a CalendarInfo>) -> Option<&'a str> {
    fields.recurrence.as_ref().and(calendar)?.timezone.as_deref()
}

/// Convert an event returned by a write call. Without the calendar's list
/// entry, fall back to the requested id and assume write access (the write
/// just succeeded).
fn written_event(event: ApiEvent, calendar_id: &str, calendar: Option<&CalendarInfo>) -> Option<CalendarEvent> {
    match calendar {
        Some(c) => api_event_to_calendar_event(event, &c.id, &c.name, &c.access_role),
        None => api_event_to_calendar_event(event, calendar_id, "", "writer"),
    }
}

fn parse_event_datetime(dt: &EventDateTime) -> Option<(i64, bool)> {
    if let Some(datetime_str) = &dt.date_time {
        // DateTime format: 2024-12-23T10:00:00-08:00
        let parsed = DateTime::parse_from_rfc3339(datetime_str).ok()?;
        Some((parsed.timestamp_millis(), false))
    } else if let Some(date_str) = &dt.date {
        // All-day event: 2024-12-23
        let parsed = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
        let datetime = parsed.and_hms_opt(0, 0, 0)?.and_utc();
        Some((datetime.timestamp_millis(), true))
    } else {
        None
    }
}

/// Calendar query parser
#[derive(Debug, Default)]
pub struct CalendarQuery {
    pub time_range: TimeRange,
    pub text: Option<String>,
    pub with: Vec<String>,      // Attendees
    pub organizer: Option<String>,
    pub location: Option<String>,
    pub status: Option<String>, // confirmed, tentative, cancelled
    pub response: Option<String>, // accepted, declined, tentative, needsAction
    pub exclude: Vec<String>,   // Keywords to exclude
}

const MAX_UPCOMING_DAYS: i64 = 100 * 365;

/// Parses "<n><unit>" (d, w, m = 30 days, y = 365 days) into a positive
/// duration of at most MAX_UPCOMING_DAYS
fn parse_duration(s: &str) -> Option<Duration> {
    let unit = s.chars().last()?;
    let num_str = &s[..s.len() - unit.len_utf8()];
    if num_str.is_empty() || !num_str.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let num: i64 = num_str.parse().ok()?;
    let days_per_unit = match unit {
        'd' => 1,
        'w' => 7,
        'm' => 30,
        'y' => 365,
        _ => return None,
    };
    let days = num.checked_mul(days_per_unit)?;
    if !(1..=MAX_UPCOMING_DAYS).contains(&days) {
        return None;
    }
    Some(Duration::days(days))
}

/// Splits on whitespace, except inside double quotes, so values like
/// `location:"New York"` stay one token. Quotes are kept in the token.
fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in query.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
            current.push(c);
        } else if c.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn strip_operator<'a>(token: &'a str, operator: &str) -> Option<&'a str> {
    let head = token.get(..operator.len())?;
    head.eq_ignore_ascii_case(operator).then(|| &token[operator.len()..])
}

fn unquote(value: &str) -> &str {
    value.trim_matches('"')
}

/// Local midnight, or the first instant after a DST gap that swallows
/// midnight (e.g. America/Santiago springs forward at 00:00)
fn start_of_day<Z: TimeZone>(tz: &Z, date: NaiveDate) -> DateTime<Utc> {
    (0..=3)
        .find_map(|hour| tz.from_local_datetime(&date.and_hms_opt(hour, 0, 0)?).earliest())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|| date.and_hms_opt(0, 0, 0).expect("midnight is a valid time").and_utc())
}

/// When an event starts, counting an all-day event from its date's midnight
/// in `timezone` (else the system's) rather than the UTC midnight its
/// timestamp holds
fn day_start_millis(event: &CalendarEvent, timezone: Option<&str>) -> i64 {
    let date = match DateTime::<Utc>::from_timestamp_millis(event.start_time) {
        Some(start) if event.all_day => start.date_naive(),
        _ => return event.start_time,
    };
    let start = match timezone.and_then(|s| s.parse::<Tz>().ok()) {
        Some(tz) => start_of_day(&tz, date),
        None => start_of_day(&Local, date),
    };
    start.timestamp_millis()
}

#[derive(Debug, Default, Clone)]
pub enum TimeRange {
    #[default]
    Today,
    Tomorrow,
    Week,
    Month,
    Upcoming(Duration),
}

impl CalendarQuery {
    pub fn parse(query: &str) -> Self {
        let mut cq = CalendarQuery::default();
        let mut remaining_text = Vec::new();

        for token in tokenize_query(query) {
            let token = token.as_str();
            let value_of = |op: &str| strip_operator(token, op).map(unquote);

            if let Some(value) = value_of("calendar:") {
                cq.time_range = match value.to_lowercase().as_str() {
                    "today" => TimeRange::Today,
                    "tomorrow" => TimeRange::Tomorrow,
                    "week" => TimeRange::Week,
                    "month" => TimeRange::Month,
                    other => {
                        // Try to parse as duration (e.g. 3d, 2w)
                        if let Some(duration) = parse_duration(other) {
                            TimeRange::Upcoming(duration)
                        } else {
                            TimeRange::Today
                        }
                    }
                };
            } else if let Some(value) = value_of("with:") {
                cq.with.push(value.to_string());
            } else if let Some(value) = value_of("organizer:") {
                cq.organizer = Some(value.to_string());
            } else if let Some(value) = value_of("location:") {
                cq.location = Some(value.to_string());
            } else if let Some(value) = value_of("status:") {
                cq.status = Some(value.to_string());
            } else if let Some(value) = value_of("response:") {
                cq.response = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix('-').map(unquote).filter(|v| !v.is_empty()) {
                cq.exclude.push(value.to_string());
            } else {
                remaining_text.push(token.to_string());
            }
        }

        if !remaining_text.is_empty() {
            cq.text = Some(remaining_text.join(" "));
        }

        cq
    }

    pub fn get_time_range(&self, timezone: Option<&str>) -> (DateTime<Utc>, DateTime<Utc>) {
        self.get_time_range_at(timezone, Utc::now())
    }

    /// Same as get_time_range but with an injectable `now` for testability
    fn get_time_range_at(&self, timezone: Option<&str>, now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
        // Days are counted in the calendar's time zone, falling back to the
        // system's; `day(n)` is the start of the nth day from today
        let day: Box<dyn Fn(i64) -> DateTime<Utc>> = match timezone.and_then(|s| s.parse::<Tz>().ok()) {
            Some(tz) => {
                let today = now.with_timezone(&tz).date_naive();
                Box::new(move |n| start_of_day(&tz, today + Duration::days(n)))
            }
            None => {
                let today = now.with_timezone(&Local).date_naive();
                Box::new(move |n| start_of_day(&Local, today + Duration::days(n)))
            }
        };

        match &self.time_range {
            TimeRange::Today => (day(0), day(1)),
            TimeRange::Tomorrow => (day(1), day(2)),
            TimeRange::Week => (day(0), day(7)),
            TimeRange::Month => (day(0), day(30)),
            // For upcoming, we start from NOW to avoid missing things that just started
            TimeRange::Upcoming(duration) => (now, now + *duration),
        }
    }

    pub fn matches(&self, event: &CalendarEvent) -> bool {
        // Check attendee filter
        if !self.with.is_empty() {
            let has_attendee = self.with.iter().any(|w| {
                let w_lower = w.to_lowercase();
                event.attendees.iter().any(|a| {
                    a.email.to_lowercase().contains(&w_lower)
                        || a.display_name
                            .as_ref()
                            .map(|n| n.to_lowercase().contains(&w_lower))
                            .unwrap_or(false)
                })
            });
            if !has_attendee {
                return false;
            }
        }

        // Check organizer filter
        if let Some(org) = &self.organizer {
            let org_lower = org.to_lowercase();
            let matches_org = event
                .organizer
                .as_ref()
                .map(|o| o.to_lowercase().contains(&org_lower))
                .unwrap_or(false);
            if !matches_org {
                return false;
            }
        }

        // Check location filter
        if let Some(loc) = &self.location {
            let loc_lower = loc.to_lowercase();
            let matches_loc = event
                .location
                .as_ref()
                .map(|l| l.to_lowercase().contains(&loc_lower))
                .unwrap_or(false);
            if !matches_loc {
                return false;
            }
        }

        // Check status filter
        if let Some(status) = &self.status {
            if event.status.to_lowercase() != status.to_lowercase() {
                return false;
            }
        }

        // Check response filter
        if let Some(response) = &self.response {
            let answered = event
                .response_status
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(response));
            if !answered {
                return false;
            }
        }

        // Check exclusions
        for exclude in &self.exclude {
            let exclude_lower = exclude.to_lowercase();
            if event.title.to_lowercase().contains(&exclude_lower) {
                return false;
            }
            if event
                .description
                .as_ref()
                .map(|d| d.to_lowercase().contains(&exclude_lower))
                .unwrap_or(false)
            {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::stub_server::StubServer;

    fn api_event(json: serde_json::Value) -> ApiEvent {
        serde_json::from_value(json).unwrap()
    }

    fn google_error(code: u16, reason: &str, message: &str) -> String {
        serde_json::json!({
            "error": { "code": code, "message": message, "errors": [{ "reason": reason, "message": message }] }
        })
        .to_string()
    }

    #[test]
    fn error_messages_only_suggest_re_login_for_auth_problems() {
        let err = |code: u16, body: &str| friendly_calendar_error(StatusCode::from_u16(code).unwrap(), body);

        // Google reports rate limits as 403s
        let rate = err(403, &google_error(403, "rateLimitExceeded", "Rate Limit Exceeded"));
        assert!(rate.contains("Too many requests"), "{rate}");
        let quota = err(403, &google_error(403, "userRateLimitExceeded", "User Rate Limit Exceeded"));
        assert!(quota.contains("Too many requests"), "{quota}");

        // Not being allowed to change an event is not a login problem
        let not_organizer = err(403, &google_error(403, "forbiddenForNonOrganizer", "Shared properties can only be changed by the organizer of the event."));
        assert!(!not_organizer.contains("re-login"), "{not_organizer}");
        assert!(not_organizer.contains("only be changed by the organizer"), "{not_organizer}");
        let read_only = err(403, &google_error(403, "requiredAccessLevel", "You need to have writer access to this calendar."));
        assert_eq!(read_only, "You need to have writer access to this calendar.");

        // A missing scope still asks for a re-login
        let scope = err(403, &google_error(403, "insufficientPermissions", "Request had insufficient authentication scopes."));
        assert!(scope.contains("re-login"), "{scope}");
        assert!(err(401, &google_error(401, "authError", "Invalid Credentials")).contains("Calendar access expired"));

        // 404/410 on an event (deleted elsewhere) is not a missing calendar
        assert!(!err(404, &google_error(404, "notFound", "Not Found")).contains("Calendar not found"));
        assert!(err(410, &google_error(410, "deleted", "Resource has been deleted")).contains("deleted"));
        assert_eq!(err(500, "<html>oops</html>"), "Calendar error (500 Internal Server Error)");
    }

    #[test]
    fn converts_timed_and_all_day_events() {
        let ev = api_event(serde_json::json!({
            "id": "e1",
            "start": { "dateTime": "2024-12-23T10:00:00-03:00" },
            "end": { "dateTime": "2024-12-23T11:30:00-03:00" },
        }));
        let ev = api_event_to_calendar_event(ev, "cal", "Work", "owner").unwrap();
        assert!(!ev.all_day);
        assert_eq!(ev.start_time, "2024-12-23T13:00:00Z".parse::<DateTime<Utc>>().unwrap().timestamp_millis());
        assert_eq!(ev.end_time, Some(ev.start_time + 90 * 60 * 1000));
        assert_eq!(ev.title, "(No title)");
        assert_eq!(ev.status, "confirmed");
        assert_eq!((ev.calendar_id.as_str(), ev.calendar_name.as_str()), ("cal", "Work"));

        // All-day dates are anchored at UTC midnight, end exclusive
        let ev = api_event(serde_json::json!({
            "id": "e2", "summary": "Trip",
            "start": { "date": "2024-12-23" }, "end": { "date": "2024-12-25" },
        }));
        let ev = api_event_to_calendar_event(ev, "cal", "", "owner").unwrap();
        assert!(ev.all_day);
        let midnight = NaiveDate::from_ymd_opt(2024, 12, 23).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc();
        assert_eq!(ev.start_time, midnight.timestamp_millis());
        assert_eq!(ev.end_time, Some((midnight + Duration::days(2)).timestamp_millis()));

        // Events without a usable start are dropped
        let ev = api_event(serde_json::json!({ "id": "e3", "start": { "date": "garbage" } }));
        assert!(api_event_to_calendar_event(ev, "cal", "", "owner").is_none());
        let ev = api_event(serde_json::json!({ "id": "e4" }));
        assert!(api_event_to_calendar_event(ev, "cal", "", "owner").is_none());
    }

    #[test]
    fn events_say_which_series_they_belong_to() {
        // Cards list single instances; an edit PATCHes that one occurrence,
        // and the form needs to know it's part of a series
        let ev = api_event(serde_json::json!({
            "id": "abc_20241223T100000Z",
            "recurringEventId": "abc",
            "start": { "dateTime": "2024-12-23T10:00:00Z" },
        }));
        let ev = api_event_to_calendar_event(ev, "cal", "", "owner").unwrap();
        assert_eq!(ev.recurring_event_id.as_deref(), Some("abc"));
        assert_eq!(serde_json::to_value(&ev).unwrap()["recurring_event_id"], "abc");

        // Events cached before the field existed still load
        let mut cached = serde_json::to_value(&ev).unwrap();
        cached.as_object_mut().unwrap().remove("recurring_event_id");
        let cached: CalendarEvent = serde_json::from_value(cached).unwrap();
        assert_eq!(cached.recurring_event_id, None);
    }

    #[test]
    fn event_response_status_and_attendees() {
        let ev = api_event(serde_json::json!({
            "id": "e1",
            "start": { "date": "2024-12-23" },
            "organizer": { "email": "boss@x.com", "displayName": "Boss" },
            "attendees": [
                { "email": "boss@x.com", "organizer": true, "responseStatus": "accepted" },
                { "email": "me@x.com", "self": true, "responseStatus": "tentative" },
                { "displayName": "No email resource" },
            ],
        }));
        let ev = api_event_to_calendar_event(ev, "cal", "", "owner").unwrap();
        assert_eq!(ev.organizer.as_deref(), Some("boss@x.com"));
        assert_eq!(ev.response_status.as_deref(), Some("tentative"));
        assert_eq!(ev.attendees.len(), 2);
        assert!(ev.attendees[0].is_organizer && !ev.attendees[0].is_self);
        assert!(ev.attendees[1].is_self);
    }

    #[test]
    fn event_can_edit_rules() {
        let can_edit = |json: serde_json::Value, role: &str| {
            let mut json = json;
            json["id"] = "e".into();
            json["start"] = serde_json::json!({ "date": "2024-12-23" });
            api_event_to_calendar_event(api_event(json), "cal", "", role).unwrap().can_edit
        };
        let organizer = serde_json::json!({ "organizer": { "self": true } });
        assert!(can_edit(organizer.clone(), "owner"));
        assert!(can_edit(organizer.clone(), "writer"));
        assert!(!can_edit(organizer.clone(), "reader"));
        assert!(!can_edit(organizer.clone(), "freeBusyReader"));

        let mut locked = organizer.clone();
        locked["locked"] = true.into();
        assert!(!can_edit(locked, "owner"));

        assert!(can_edit(serde_json::json!({ "creator": { "self": true } }), "owner"));

        let guest = serde_json::json!({ "attendees": [{ "email": "me@x.com", "self": true }] });
        assert!(!can_edit(guest.clone(), "owner"));
        let mut modifiable = guest;
        modifiable["guestsCanModify"] = true.into();
        assert!(can_edit(modifiable, "owner"));
        assert!(!can_edit(serde_json::json!({ "guestsCanModify": true }), "owner"));
    }

    fn event_for_matching() -> CalendarEvent {
        CalendarEvent {
            id: "e".into(),
            calendar_id: "cal".into(),
            calendar_name: "Work".into(),
            title: "Weekly Standup".into(),
            description: Some("Bring the Roadmap".into()),
            location: Some("Room 4, New York".into()),
            start_time: 0,
            end_time: None,
            all_day: false,
            status: "confirmed".into(),
            organizer: Some("Alice@Example.com".into()),
            attendees: vec![EventAttendee {
                email: "bob@example.com".into(),
                display_name: Some("Bob Builder".into()),
                response_status: None,
                is_self: false,
                is_organizer: false,
            }],
            html_link: None,
            hangout_link: None,
            response_status: Some("accepted".into()),
            can_edit: false,
            recurring_event_id: None,
        }
    }

    #[test]
    fn query_matches_filters() {
        let ev = event_for_matching();
        let m = |q: &str| CalendarQuery::parse(q).matches(&ev);

        assert!(m("calendar:today"));
        assert!(m("with:bob"));
        assert!(m("with:builder"));
        assert!(m("with:nobody with:BOB"));
        assert!(!m("with:carol"));
        assert!(m("organizer:alice"));
        assert!(!m("organizer:bob"));
        assert!(m(r#"location:"new york""#));
        assert!(!m("location:paris"));
        assert!(m("status:Confirmed"));
        assert!(!m("status:cancelled"));
        assert!(m("response:accepted"));
        assert!(!m("response:declined"));
        assert!(!m("-standup"));
        assert!(!m("-roadmap"));
        assert!(m("-retro"));
        // Free text is sent to the API, not filtered locally
        assert!(m("unrelated words"));

        // Without a self attendee (a solo event, or one on someone else's
        // calendar) there is no invitation to answer, so no response: filter
        // matches; otherwise a needsAction card fills with the user's own blocks
        let mut no_response = ev.clone();
        no_response.response_status = None;
        for status in ["needsAction", "accepted", "declined", "tentative"] {
            assert!(!CalendarQuery::parse(&format!("response:{status}")).matches(&no_response), "{status}");
        }
        assert!(CalendarQuery::parse("calendar:week").matches(&no_response));
        let mut pending = ev.clone();
        pending.response_status = Some("needsAction".into());
        assert!(CalendarQuery::parse("response:NEEDSACTION").matches(&pending));
        let mut no_location = ev;
        no_location.location = None;
        assert!(!CalendarQuery::parse("location:york").matches(&no_location));
    }

    #[test]
    fn events_url_requests_cancelled_events_only_when_filtering_for_them() {
        let now = "2024-07-10T15:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let url = |q: &str| events_list_url(CALENDAR_API_BASE, "me@x.com", now, now + Duration::days(1), &CalendarQuery::parse(q));

        let plain = url("calendar:today");
        assert!(plain.starts_with("https://www.googleapis.com/calendar/v3/calendars/me%40x.com/events?"));
        assert!(plain.contains("timeMin=2024-07-10T15%3A30%3A00%2B00%3A00"));
        assert!(plain.contains("singleEvents=true"));
        assert!(!plain.contains("showDeleted"));
        assert!(!plain.contains("&q="));

        assert!(url("calendar:week status:Cancelled").contains("&showDeleted=true"));
        assert!(!url("calendar:week status:confirmed").contains("showDeleted"));
        assert!(url("calendar:week team sync").contains("&q=team%20sync"));
    }

    fn fields(start_time: i64, end_time: i64, all_day: bool) -> EventFields {
        EventFields {
            summary: "Title".into(),
            description: None,
            location: None,
            start_time,
            end_time,
            all_day,
            attendees: None,
            recurrence: None,
        }
    }

    fn request_json(all_day: bool, recurrence: Option<Vec<String>>, time_zone: Option<&str>) -> serde_json::Value {
        // 2024-12-23 12:00 UTC to 2024-12-24 12:00 UTC, as the form sends all-day dates
        let start = 1_734_955_200_000;
        let end = start + 24 * 3600 * 1000;
        let req = build_event_request(EventFields { recurrence, ..fields(start, end, all_day) }, time_zone, &[]).unwrap();
        serde_json::to_value(req).unwrap()
    }

    #[test]
    fn all_day_request_uses_exclusive_end_date() {
        let json = request_json(true, None, Some("America/New_York"));
        assert_eq!(json["start"], serde_json::json!({ "date": "2024-12-23", "dateTime": null }));
        assert_eq!(json["end"], serde_json::json!({ "date": "2024-12-25", "dateTime": null }));
    }

    #[test]
    fn timed_request_carries_time_zone_for_recurrence_expansion() {
        let json = request_json(false, Some(vec!["FREQ=WEEKLY".into()]), Some("America/New_York"));
        assert_eq!(json["start"]["dateTime"], "2024-12-23T12:00:00+00:00");
        assert_eq!(json["start"]["timeZone"], "America/New_York");
        assert_eq!(json["end"]["timeZone"], "America/New_York");
        assert_eq!(json["recurrence"], serde_json::json!(["RRULE:FREQ=WEEKLY"]));

        let json = request_json(false, Some(vec!["RRULE:FREQ=DAILY".into(), "EXDATE:20241225".into()]), None);
        assert_eq!(json["recurrence"], serde_json::json!(["RRULE:FREQ=DAILY", "EXDATE:20241225"]));
        assert!(json["start"].get("timeZone").is_none());
    }

    #[test]
    fn request_accepts_pre_epoch_timestamps() {
        // 1969-12-31T23:59:58.500Z
        let req = build_event_request(fields(-1_500, 0, false), None, &[]).unwrap();
        let json = serde_json::to_value(req).unwrap();
        assert_eq!(json["start"]["dateTime"], "1969-12-31T23:59:58.500+00:00");
        assert_eq!(json["end"]["dateTime"], "1970-01-01T00:00:00+00:00");
    }

    #[test]
    fn request_without_recurrence_leaves_existing_recurrence_alone() {
        // Updates are PATCHes; a null recurrence would strip a series' rules
        let json = request_json(false, None, None);
        assert!(json.get("recurrence").is_none());
        // Cleared optional fields are sent as null so a PATCH clears them
        assert!(json["description"].is_null() && json.get("description").is_some());
        // An event with no guests before or after has no guest list to send
        assert!(json.get("attendees").is_none());
    }

    fn attendee(email: &str, is_self: bool, status: &str) -> CalEventAttendee {
        CalEventAttendee {
            email: email.into(),
            response_status: Some(status.into()),
            is_self: is_self.then_some(true),
            ..Default::default()
        }
    }

    #[test]
    fn rsvp_updates_the_self_attendee_even_when_invited_under_an_alias() {
        // Invite went to an alias; the API marks that attendee as self
        let attendees = vec![
            attendee("boss@x.com", false, "accepted"),
            attendee("me.alias@x.com", true, "needsAction"),
        ];
        assert_eq!(self_attendee_index(&attendees, "me@x.com", true), Some(1));

        let updated = with_rsvp(attendees.clone(), "me@x.com", "declined", true);
        assert_eq!(updated.len(), 2);
        assert_eq!(updated[0].response_status.as_deref(), Some("accepted"));
        assert_eq!(updated[1].response_status.as_deref(), Some("declined"));

        // On someone else's calendar, `self` is that calendar's owner
        assert_eq!(self_attendee_index(&attendees, "me@x.com", false), None);
        let updated = with_rsvp(attendees, "me@x.com", "declined", false);
        assert_eq!(updated.len(), 3);
        assert_eq!(updated[1].response_status.as_deref(), Some("needsAction"));
    }

    #[test]
    fn rsvp_prefers_the_exact_email_over_the_self_flag() {
        let attendees = vec![
            attendee("shared@x.com", true, "needsAction"),
            attendee("me@x.com", false, "needsAction"),
        ];
        assert_eq!(self_attendee_index(&attendees, "me@x.com", true), Some(1));
    }

    #[test]
    fn rsvp_matches_email_case_insensitively_and_adds_self_when_missing() {
        let updated = with_rsvp(vec![attendee("Me@X.com", false, "needsAction")], "me@x.com", "accepted", true);
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].response_status.as_deref(), Some("accepted"));

        let updated = with_rsvp(vec![attendee("boss@x.com", false, "accepted")], "me@x.com", "tentative", true);
        assert_eq!(updated.len(), 2);
        assert_eq!(updated[1].email, "me@x.com");
        assert_eq!(updated[1].response_status.as_deref(), Some("tentative"));
        assert_eq!(updated[1].is_self, Some(true));
    }

    #[test]
    fn editing_attendees_keeps_existing_guests_entries() {
        let mut optional = attendee("carol@x.com", false, "tentative");
        optional.optional = Some(true);
        optional.comment = Some("maybe".into());
        let existing = vec![
            attendee("me@x.com", true, "accepted"),
            attendee("Bob@X.com", false, "declined"),
            optional,
        ];
        let edited = EventFields {
            attendees: Some(vec!["me@x.com".into(), "bob@x.com".into(), "dan@x.com".into(), "carol@x.com".into(), "BOB@x.com".into()]),
            ..fields(0, 3_600_000, false)
        };
        let json = serde_json::to_value(build_event_request(edited, None, &existing).unwrap()).unwrap();
        assert_eq!(
            json["attendees"],
            serde_json::json!([
                { "email": "me@x.com", "responseStatus": "accepted", "self": true },
                { "email": "Bob@X.com", "responseStatus": "declined" },
                { "email": "dan@x.com" },
                { "email": "carol@x.com", "responseStatus": "tentative", "optional": true, "comment": "maybe" },
            ])
        );

        // Guests left out of the form are removed; clearing the field clears the list
        let json = serde_json::to_value(
            build_event_request(EventFields { attendees: Some(vec!["dan@x.com".into()]), ..fields(0, 0, false) }, None, &existing).unwrap(),
        )
        .unwrap();
        assert_eq!(json["attendees"], serde_json::json!([{ "email": "dan@x.com" }]));
        let json = serde_json::to_value(build_event_request(fields(0, 0, false), None, &existing).unwrap()).unwrap();
        assert_eq!(json["attendees"], serde_json::json!([]));
    }

    fn written_attendees(emails: Option<Vec<&str>>, existing: &[CalEventAttendee]) -> Option<serde_json::Value> {
        let edited = EventFields {
            attendees: emails.map(|e| e.into_iter().map(String::from).collect()),
            ..fields(0, 3_600_000, false)
        };
        let json = serde_json::to_value(build_event_request(edited, None, existing).unwrap()).unwrap();
        json.get("attendees").cloned()
    }

    #[test]
    fn an_unchanged_guest_list_is_left_alone() {
        // The PATCH replaces the whole array, so resending what the form shows
        // would drop guests it can't show, for a title-only edit
        let mut hidden = attendee("", false, "accepted");
        hidden.other.insert("id".into(), "guest-7".into());
        let existing = vec![attendee("me@x.com", true, "accepted"), attendee("Bob@X.com", false, "declined"), hidden];
        assert_eq!(written_attendees(Some(vec!["bob@x.com", "me@x.com"]), &existing), None);
        assert_eq!(written_attendees(Some(vec!["bob@x.com", "me@x.com", "BOB@x.com"]), &existing), None);

        // A changed list still keeps the guests the form can't show
        assert_eq!(
            written_attendees(Some(vec!["me@x.com", "dan@x.com"]), &existing),
            Some(serde_json::json!([
                { "email": "me@x.com", "responseStatus": "accepted", "self": true },
                { "email": "dan@x.com" },
                { "id": "guest-7", "responseStatus": "accepted" },
            ]))
        );
        assert_eq!(
            written_attendees(None, &existing),
            Some(serde_json::json!([{ "id": "guest-7", "responseStatus": "accepted" }]))
        );

        // Without the current list, a form with no guests leaves them alone
        assert_eq!(written_attendees(None, &[]), None);
        assert_eq!(written_attendees(Some(vec![]), &[]), None);
        // A new event with guests invites them
        assert_eq!(written_attendees(Some(vec!["dan@x.com"]), &[]), Some(serde_json::json!([{ "email": "dan@x.com" }])));
    }

    #[test]
    fn recurrence_time_zone_only_for_recurring_events() {
        let calendar = CalendarInfo {
            id: "c".into(),
            name: "C".into(),
            is_primary: true,
            access_role: "owner".into(),
            timezone: Some("Asia/Tokyo".into()),
        };
        let single = fields(0, 0, false);
        let recurring = EventFields { recurrence: Some(vec!["FREQ=DAILY".into()]), ..fields(0, 0, false) };
        assert_eq!(recurrence_time_zone(&single, Some(&calendar)), None);
        assert_eq!(recurrence_time_zone(&recurring, Some(&calendar)), Some("Asia/Tokyo"));
        assert_eq!(recurrence_time_zone(&recurring, None), None);
    }

    #[test]
    fn rsvp_patch_round_trips_attendee_fields() {
        let json = serde_json::json!({
            "email": "a@x.com", "displayName": "A", "responseStatus": "accepted",
            "optional": true, "comment": "late", "additionalGuests": 2, "resource": false,
            "id": "profile-1", "organizer": false,
        });
        let parsed: CalEventAttendee = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), json);
    }

    #[tokio::test]
    async fn rsvp_keeps_guests_google_lists_without_an_address() {
        // Google omits the address of some guests; the PATCH must still parse
        // the list and send those guests back, or they'd be dropped
        let server = StubServer::start(|method, target| match method {
            "PATCH" => (200, "{}".to_string()),
            _ if target.contains("iCalUID=") => (
                200,
                serde_json::json!({ "items": [{ "id": "e1", "attendees": [
                    { "email": "me@x.com", "responseStatus": "needsAction" },
                    { "id": "guest-7", "displayName": "No address", "responseStatus": "accepted" },
                ] }] })
                .to_string(),
            ),
            _ => (200, serde_json::json!({ "items": [] }).to_string()),
        })
        .await;
        server.client().rsvp_calendar_event("me@x.com", "uid-1", "accepted").await.unwrap();
        let patch = server.requests().into_iter().find(|(m, _, _)| m == "PATCH").expect("no PATCH sent");
        let body: serde_json::Value = serde_json::from_str(&patch.2).unwrap();
        assert_eq!(
            body["attendees"],
            serde_json::json!([
                { "email": "me@x.com", "responseStatus": "accepted" },
                { "id": "guest-7", "displayName": "No address", "responseStatus": "accepted" },
            ])
        );
    }

    #[tokio::test]
    async fn rsvp_to_a_listed_event_patches_that_event_without_an_ical_uid_lookup() {
        // Cards list single occurrences ("abc_20260928T150000Z") and invites
        // from other systems, whose ids aren't iCalUIDs; the card already
        // knows which calendar and event it shows
        let server = StubServer::start(|method, target| match method {
            "GET" if target.starts_with("/calendars/me%40x.com/events/abc_20260928T150000Z?") => (
                200,
                serde_json::json!({ "id": "abc_20260928T150000Z", "attendees": [
                    { "email": "boss@x.com", "organizer": true, "responseStatus": "accepted" },
                    { "email": "me.alias@x.com", "self": true, "responseStatus": "needsAction" },
                ] })
                .to_string(),
            ),
            "PATCH" => (200, "{}".to_string()),
            _ => (404, "{}".to_string()),
        })
        .await;
        server
            .client()
            .rsvp_event("me@x.com", "me@x.com", "abc_20260928T150000Z", "tentative")
            .await
            .unwrap();
        let requests = server.requests();
        assert!(requests.iter().all(|(_, t, _)| !t.contains("iCalUID")), "{requests:?}");
        let patch = requests.iter().find(|(m, _, _)| m == "PATCH").expect("no PATCH sent");
        assert_eq!(patch.1, "/calendars/me%40x.com/events/abc_20260928T150000Z?sendUpdates=all");
        let body: serde_json::Value = serde_json::from_str(&patch.2).unwrap();
        assert_eq!(body["attendees"][0]["responseStatus"], "accepted");
        assert_eq!(body["attendees"][1]["responseStatus"], "tentative");
        assert_eq!(body["attendees"].as_array().unwrap().len(), 2);

        // A missing event is reported, not answered
        let err = server.client().rsvp_event("me@x.com", "me@x.com", "gone", "accepted").await.unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }

    impl StubServer {
        fn client(&self) -> CalendarClient {
            CalendarClient { api_base: self.base.clone(), ..CalendarClient::new("token".into()) }
        }
    }

    fn calendar_entry(id: &str) -> serde_json::Value {
        serde_json::json!({ "id": id, "summary": id, "accessRole": "owner", "timeZone": "UTC" })
    }

    #[test]
    fn calendars_go_by_the_name_the_user_gave_them() {
        let info = |json: serde_json::Value| CalendarInfo::from(serde_json::from_value::<CalendarListEntry>(json).unwrap());
        let renamed = info(serde_json::json!({ "id": "c1", "summary": "Team Rota 2024", "summaryOverride": "Rota" }));
        assert_eq!(renamed.name, "Rota");
        assert_eq!(info(serde_json::json!({ "id": "c2", "summary": "Work" })).name, "Work");
        assert_eq!(info(serde_json::json!({ "id": "c3", "summaryOverride": "" , "summary": "Home" })).name, "Home");
    }

    #[tokio::test]
    async fn list_calendars_follows_page_tokens() {
        let server = StubServer::start(|_, target| {
            let body = if target.contains("pageToken=next%2Fpage") {
                serde_json::json!({ "items": [calendar_entry("second")] })
            } else {
                serde_json::json!({ "items": [calendar_entry("first")], "nextPageToken": "next/page" })
            };
            (200, body.to_string())
        })
        .await;

        let calendars = server.client().list_calendars().await.unwrap();
        let ids: Vec<&str> = calendars.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["first", "second"]);
        assert_eq!(server.requests().len(), 2);
    }

    #[tokio::test]
    async fn paging_stops_when_google_repeats_a_page_token() {
        // Empty pages can carry a token; one that never changes would
        // otherwise be followed forever, since no items reach the cap
        let server = StubServer::start(|_, _| (200, serde_json::json!({ "items": [], "nextPageToken": "again" }).to_string())).await;
        let calendars = tokio::time::timeout(std::time::Duration::from_secs(10), server.client().list_calendars())
            .await
            .expect("paged forever")
            .unwrap();
        assert!(calendars.is_empty());
        assert_eq!(server.requests().len(), 2);
    }

    fn invite_lookup_stub(calendars: serde_json::Value, found_on: &'static str) -> impl Fn(&str, &str) -> (u16, String) + Send + Sync + 'static {
        move |method, target| {
            if target.starts_with("/users/me/calendarList") {
                return (200, serde_json::json!({ "items": calendars }).to_string());
            }
            if method == "PATCH" {
                return (200, "{}".to_string());
            }
            let items = if target.starts_with(&format!("/calendars/{}/events?iCalUID=", urlencoding::encode(found_on))) {
                serde_json::json!([{ "id": "e1", "attendees": [{ "email": "me@x.com", "responseStatus": "accepted" }] }])
            } else {
                serde_json::json!([])
            };
            (200, serde_json::json!({ "items": items }).to_string())
        }
    }

    fn calendar_with_role(id: &str, role: &str) -> serde_json::Value {
        serde_json::json!({ "id": id, "summary": id, "accessRole": role })
    }

    fn searched_calendars(server: &StubServer) -> Vec<String> {
        server
            .requests()
            .into_iter()
            .filter(|(_, target, _)| target.contains("/events?iCalUID="))
            .map(|(_, target, _)| target.trim_start_matches("/calendars/").split('/').next().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn invite_lookup_searches_secondary_calendars_concurrently() {
        let calendars = serde_json::json!([
            { "id": "me@x.com", "primary": true, "accessRole": "owner" },
            calendar_with_role("work", "owner"),
            calendar_with_role("team", "writer"),
            calendar_with_role("shared", "reader"),
        ]);
        // One at a time, the first secondary search would wait forever
        let server = StubServer::start_gated(
            invite_lookup_stub(calendars, "team"),
            |target| target.contains("/events?iCalUID=") && !target.starts_with("/calendars/primary/"),
            3,
        )
        .await;
        let status = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            server.client().get_calendar_event_status("me@x.com", "uid-1"),
        )
        .await
        .expect("secondary calendars were searched one at a time")
        .unwrap();
        assert_eq!(status.as_deref(), Some("accepted"));
    }

    #[tokio::test]
    async fn invite_lookup_stops_at_the_first_calendar_holding_the_invite() {
        // Accounts can subscribe to dozens of calendars; searching all of
        // them at once for every invite row runs into Google's rate limits
        let calendars: Vec<_> = (0..20).map(|i| calendar_with_role(&format!("cal{i:02}"), "reader")).collect();
        let server = StubServer::start(invite_lookup_stub(serde_json::json!(calendars), "cal00")).await;
        assert_eq!(server.client().get_calendar_event_status("me@x.com", "uid-1").await.unwrap().as_deref(), Some("accepted"));
        let searched = searched_calendars(&server);
        assert_eq!(searched[0], "primary");
        assert!(searched.len() <= 1 + INVITE_SEARCH_CONCURRENCY, "{searched:?}");
    }

    #[tokio::test]
    async fn invite_lookup_skips_calendars_that_cannot_hold_invites() {
        let calendars = serde_json::json!([
            { "id": "me@x.com", "primary": true, "accessRole": "owner" },
            calendar_with_role("work", "owner"),
            calendar_with_role("shared", "reader"),
            calendar_with_role("busy", "freeBusyReader"),
            calendar_with_role("en.usa#holiday@group.v.calendar.google.com", "reader"),
            calendar_with_role("addressbook#contacts@group.v.calendar.google.com", "reader"),
        ]);
        let server = StubServer::start(invite_lookup_stub(calendars, "nowhere")).await;
        assert_eq!(server.client().get_calendar_event_status("me@x.com", "uid-1").await.unwrap(), None);
        let mut searched = searched_calendars(&server);
        searched.sort();
        assert_eq!(searched, vec!["primary", "shared", "work"]);

        // An RSVP can only be written to a calendar the user can modify
        let calendars = serde_json::json!([calendar_with_role("work", "owner"), calendar_with_role("shared", "reader")]);
        let rsvp_server = StubServer::start(invite_lookup_stub(calendars, "work")).await;
        rsvp_server.client().rsvp_calendar_event("me@x.com", "uid-1", "declined").await.unwrap();
        let mut searched = searched_calendars(&rsvp_server);
        searched.sort();
        assert_eq!(searched, vec!["primary", "work"]);
        let patches: Vec<_> = rsvp_server.requests().into_iter().filter(|(m, _, _)| m == "PATCH").collect();
        assert_eq!(patches.len(), 1);
        assert!(patches[0].1.starts_with("/calendars/work/events/e1?"), "{:?}", patches[0]);
        assert!(patches[0].2.contains("declined"), "{:?}", patches[0]);
    }

    #[tokio::test]
    async fn an_invite_status_lookup_reports_an_expired_session() {
        // The caller evicts the cached token on this error; reading it as
        // "no status" would keep reusing the dead token
        let server = StubServer::start(|_, _| (401, r#"{"error":{"code":401,"status":"UNAUTHENTICATED"}}"#.to_string())).await;
        let result = server.client().get_calendar_event_status("me@x.com", "uid-1").await;
        assert!(result.is_err(), "{result:?}");
    }

    #[tokio::test]
    async fn invite_lookups_share_one_calendar_list_request() {
        // Each invite row looks up its own event; the account's calendar
        // list is fetched once for all of them, not once per row
        let calendars = serde_json::json!([calendar_with_role("work", "owner")]);
        let server = StubServer::start(invite_lookup_stub(calendars, "work")).await;
        let client = server.client();
        let lookups: Vec<_> = (0..4).map(|i| client.get_calendar_event_status("me@x.com", ["a", "b", "c", "d"][i])).collect();
        let statuses = futures::future::join_all(lookups).await;
        assert!(statuses.iter().all(|s| s.as_ref().unwrap().as_deref() == Some("accepted")), "{statuses:?}");
        server.client().get_calendar_event_status("me@x.com", "e").await.unwrap();
        let list_requests = server.requests().iter().filter(|(_, t, _)| t.starts_with("/users/me/calendarList")).count();
        assert_eq!(list_requests, 1);

        // Another account (token) gets its own list
        let other = CalendarClient { access_token: "other-token".into(), ..server.client() };
        other.get_calendar_event_status("me@x.com", "f").await.unwrap();
        let list_requests = server.requests().iter().filter(|(_, t, _)| t.starts_with("/users/me/calendarList")).count();
        assert_eq!(list_requests, 2);
    }

    fn calendar_list_requests(server: &StubServer) -> usize {
        server.requests().iter().filter(|(_, t, _)| t.starts_with("/users/me/calendarList")).count()
    }

    #[tokio::test]
    async fn calendar_cards_share_one_calendar_list_request() {
        // Every calendar card searches at startup and on each refresh
        let server = StubServer::start(|_, target| {
            let items = if target.starts_with("/users/me/calendarList") {
                serde_json::json!([calendar_entry("me"), calendar_entry("work")])
            } else {
                serde_json::json!([])
            };
            (200, serde_json::json!({ "items": items }).to_string())
        })
        .await;
        let client = server.client();
        let query = CalendarQuery::parse("calendar:week");
        let searches: Vec<_> = (0..3).map(|_| client.search_events(&query, 10)).collect();
        for result in futures::future::join_all(searches).await {
            result.unwrap();
        }
        client.search_events(&CalendarQuery::parse("calendar:today"), 10).await.unwrap();
        assert_eq!(calendar_list_requests(&server), 1);
        // Both calendars were still searched each time
        let event_requests = server.requests().iter().filter(|(_, t, _)| t.starts_with("/calendars/")).count();
        assert_eq!(event_requests, 8);
    }

    #[tokio::test]
    async fn a_failed_calendar_list_answers_everyone_waiting_for_it_but_is_not_kept() {
        let server = StubServer::start(|_, target| {
            if target.starts_with("/users/me/calendarList") {
                return (503, "{}".to_string());
            }
            (200, serde_json::json!({ "items": [] }).to_string())
        })
        .await;
        let client = server.client();
        let query = CalendarQuery::parse("calendar:week");
        let searches: Vec<_> = (0..3).map(|_| client.search_events(&query, 10)).collect();
        for result in futures::future::join_all(searches).await {
            assert_eq!(result.unwrap_err(), "Calendar error (503 Service Unavailable)");
        }
        assert_eq!(calendar_list_requests(&server), 1);

        // The next search tries again
        assert!(client.search_events(&query, 10).await.is_err());
        assert_eq!(calendar_list_requests(&server), 2);
    }

    #[tokio::test]
    async fn clients_reuse_connections() {
        // Every command builds its own client; sharing one connection pool
        // saves a TLS handshake per request against Google
        let server = StubServer::start(|_, _| (200, serde_json::json!({ "items": [] }).to_string())).await;
        for _ in 0..3 {
            server.client().list_calendars().await.unwrap();
        }
        assert_eq!(server.requests().len(), 3);
        assert_eq!(server.connections(), 1);
    }

    #[tokio::test]
    async fn a_request_google_never_answers_fails_instead_of_hanging() {
        // The gate needs two requests, so the only one sent is never answered
        let server = StubServer::start_gated(|_, _| (200, "{}".to_string()), |_| true, 2).await;
        let client = CalendarClient {
            http_client: build_http_client(std::time::Duration::from_millis(200)),
            ..server.client()
        };
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), client.list_calendars())
            .await
            .expect("request hung");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn connection_failures_are_explained_without_the_request_url() {
        // The card's sync-failed tooltip shows this; the URL holds the
        // user's search text
        let unreachable = CalendarClient { api_base: "http://127.0.0.1:9".into(), ..CalendarClient::new("token".into()) };
        let err = unreachable.search_events(&CalendarQuery::parse("calendar:week dentist"), 10).await.unwrap_err();
        assert_eq!(err, "Couldn't reach Google Calendar. Check your connection and try again.");

        let server = StubServer::start_gated(|_, _| (200, "{}".to_string()), |_| true, 2).await;
        let slow = CalendarClient {
            http_client: build_http_client(std::time::Duration::from_millis(200)),
            ..server.client()
        };
        let err = slow.list_calendars().await.unwrap_err();
        assert_eq!(err, "Google Calendar didn't respond. Check your connection and try again.");
    }

    fn update_stub(method: &str, target: &str) -> (u16, String) {
        match method {
            "GET" if target.contains("fields=id,attendees") => (500, "{}".to_string()),
            "GET" => (200, calendar_entry("cal").to_string()),
            _ => (200, serde_json::json!({ "id": "e1", "start": { "date": "2024-12-23" } }).to_string()),
        }
    }

    #[tokio::test]
    async fn update_with_guests_fails_rather_than_resetting_their_responses() {
        // Without the current guest list, a bare-address PATCH would wipe
        // every guest's response, so the edit must not be sent
        let server = StubServer::start(update_stub).await;
        let edited = EventFields { attendees: Some(vec!["bob@x.com".into()]), ..fields(0, 3_600_000, false) };
        assert!(server.client().update_event("cal", "e1", edited).await.is_err());
        assert!(server.requests().iter().all(|(method, _, _)| method != "PATCH"));

        // Without guests in the form there is nothing to look up
        let server = StubServer::start(update_stub).await;
        let updated = server.client().update_event("cal", "e1", fields(0, 3_600_000, false)).await.unwrap();
        assert_eq!(updated.calendar_name, "cal");
        assert!(server
            .requests()
            .iter()
            .any(|(method, target, _)| method == "PATCH" && target.starts_with("/calendars/cal/events/e1?")));
    }

    #[tokio::test]
    async fn a_title_edit_does_not_resend_the_guest_list() {
        let server = StubServer::start(|method, target| match method {
            "GET" if target.contains("/events/e1?fields=") => (
                200,
                serde_json::json!({ "id": "e1", "creator": { "self": true }, "attendees": [
                    { "email": "me@x.com", "self": true, "responseStatus": "accepted" },
                    { "email": "bob@x.com", "responseStatus": "accepted" },
                ] })
                .to_string(),
            ),
            "GET" => (200, calendar_entry("cal").to_string()),
            _ => (200, serde_json::json!({ "id": "e1", "start": { "date": "2024-12-23" } }).to_string()),
        })
        .await;
        let edited = EventFields { attendees: Some(vec!["me@x.com".into(), "bob@x.com".into()]), ..fields(0, 3_600_000, false) };
        server.client().update_event("cal", "e1", edited).await.unwrap();
        let patch = server.requests().into_iter().find(|(m, _, _)| m == "PATCH").expect("no PATCH sent");
        let body: serde_json::Value = serde_json::from_str(&patch.2).unwrap();
        assert_eq!(body["summary"], "Title");
        assert!(body.get("attendees").is_none(), "{body}");
    }

    #[tokio::test]
    async fn an_edit_without_guests_leaves_them_alone_when_the_event_cannot_be_read() {
        // update_stub fails the guest lookup; the event may well have guests
        let server = StubServer::start(update_stub).await;
        server.client().update_event("cal", "e1", fields(0, 3_600_000, false)).await.unwrap();
        let patch = server.requests().into_iter().find(|(m, _, _)| m == "PATCH").expect("no PATCH sent");
        let body: serde_json::Value = serde_json::from_str(&patch.2).unwrap();
        assert!(body.get("attendees").is_none(), "{body}");
    }

    /// Stub where event `e1` was created by the user iff `mine`
    fn creator_stub(mine: bool) -> impl Fn(&str, &str) -> (u16, String) + Send + Sync + 'static {
        move |method, target| match method {
            "GET" if target.contains("/events/e1?fields=") => (
                200,
                serde_json::json!({ "id": "e1", "creator": { "email": "a@x.com", "self": mine } }).to_string(),
            ),
            "GET" => (200, calendar_entry("cal").to_string()),
            "DELETE" => (204, String::new()),
            _ => (200, serde_json::json!({ "id": "e1", "start": { "date": "2024-12-23" } }).to_string()),
        }
    }

    fn mutation_targets(server: &StubServer) -> Vec<String> {
        server
            .requests()
            .into_iter()
            .filter(|(method, _, _)| method != "GET")
            .map(|(_, target, _)| target)
            .collect()
    }

    #[tokio::test]
    async fn creating_an_event_invites_its_guests() {
        let server = StubServer::start(creator_stub(true)).await;
        server.client().create_event("cal", fields(0, 3_600_000, false)).await.unwrap();
        assert_eq!(mutation_targets(&server), vec!["/calendars/cal/events?sendUpdates=all"]);
    }

    #[tokio::test]
    async fn guests_are_only_emailed_about_changes_to_events_the_user_created() {
        for (mine, updates) in [(true, "sendUpdates=all"), (false, "sendUpdates=none")] {
            let server = StubServer::start(creator_stub(mine)).await;
            let client = server.client();
            client.update_event("cal", "e1", fields(0, 3_600_000, false)).await.unwrap();
            client.move_event("cal", "e1", "other").await.unwrap();
            client.delete_event("cal", "e1").await.unwrap();
            let targets = mutation_targets(&server);
            assert_eq!(targets.len(), 3, "{targets:?}");
            assert!(targets.iter().all(|t| t.contains(updates)), "mine={mine}: {targets:?}");
        }
    }

    #[tokio::test]
    async fn guests_are_not_emailed_when_the_creator_is_unknown() {
        let server = StubServer::start(|method, target| match method {
            "GET" if target.contains("/events/e1?fields=") => (500, "{}".to_string()),
            _ => (204, String::new()),
        })
        .await;
        server.client().delete_event("cal", "e1").await.unwrap();
        assert_eq!(mutation_targets(&server), vec!["/calendars/cal/events/e1?sendUpdates=none"]);
    }

    async fn searched_titles(time_zone: &'static str, events: serde_json::Value, max_results: i32) -> Vec<String> {
        let server = StubServer::start(move |_, target| {
            let body = if target.starts_with("/users/me/calendarList") {
                serde_json::json!({ "items": [{ "id": "me", "primary": true, "accessRole": "owner", "timeZone": time_zone }] })
            } else {
                serde_json::json!({ "items": events })
            };
            (200, body.to_string())
        })
        .await;
        let found = server.client().search_events(&CalendarQuery::parse("calendar:week"), max_results).await.unwrap();
        found.into_iter().map(|e| e.title).collect()
    }

    #[tokio::test]
    async fn search_pages_through_events_and_skips_calendars_that_fail() {
        let event = |id: &str, time: &str| serde_json::json!({ "id": id, "summary": id, "start": { "dateTime": time } });
        let server = StubServer::start(move |_, target| {
            if target.starts_with("/users/me/calendarList") {
                let items = serde_json::json!([calendar_entry("mine"), calendar_entry("busy")]);
                return (200, serde_json::json!({ "items": items }).to_string());
            }
            if target.starts_with("/calendars/busy/") {
                return (403, google_error(403, "requiredAccessLevel", "No access"));
            }
            let body = if target.contains("&pageToken=2") {
                serde_json::json!({ "items": [event("second", "2024-12-23T09:00:00Z")] })
            } else {
                serde_json::json!({ "items": [event("first", "2024-12-23T10:00:00Z")], "nextPageToken": "2" })
            };
            (200, body.to_string())
        })
        .await;

        let found = server.client().search_events(&CalendarQuery::parse("calendar:week"), 10).await.unwrap();
        let titles: Vec<&str> = found.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, vec!["second", "first"]);
        assert!(found.iter().all(|e| e.calendar_id == "mine"));
    }

    #[tokio::test]
    async fn a_search_asks_a_few_calendars_at_a_time() {
        // Accounts subscribe to dozens of team, room and holiday calendars;
        // asking all at once for every card runs into Google's rate limits,
        // and the calendars that get refused silently drop out of the card
        let calendars: Vec<_> = (0..20).map(|i| calendar_entry(&format!("cal{i:02}"))).collect();
        let server = StubServer::start_slow(
            move |_, target| {
                let items = if target.starts_with("/users/me/calendarList") {
                    serde_json::json!(calendars)
                } else {
                    let id = target.trim_start_matches("/calendars/").split('/').next().unwrap();
                    serde_json::json!([{ "id": id, "summary": id, "start": { "dateTime": "2024-12-23T10:00:00Z" } }])
                };
                (200, serde_json::json!({ "items": items }).to_string())
            },
            std::time::Duration::from_millis(30),
        )
        .await;
        let found = server.client().search_events(&CalendarQuery::parse("calendar:week"), 100).await.unwrap();
        assert_eq!(found.len(), 20);
        assert!(server.most_in_flight() > 1, "calendars were searched one at a time");
        assert!(server.most_in_flight() <= SEARCH_CONCURRENCY, "{} requests at once", server.most_in_flight());
    }

    #[tokio::test]
    async fn an_event_on_several_calendars_is_listed_once_from_the_users_own() {
        // A meeting with a coworker whose calendar the user subscribes to
        // comes back from both calendars with the same id; cards key events
        // by id, so a second copy would take the first copy's RSVPs and edits
        let event = |id: &str| serde_json::json!({ "id": id, "summary": id, "start": { "dateTime": "2024-12-23T10:00:00Z" } });
        let server = StubServer::start(move |_, target| {
            let items = if target.starts_with("/users/me/calendarList") {
                serde_json::json!([
                    calendar_with_role("coworker", "reader"),
                    calendar_with_role("team", "writer"),
                    { "id": "me", "summary": "me", "primary": true, "accessRole": "owner", "timeZone": "UTC" },
                ])
            } else if target.starts_with("/calendars/coworker/") {
                serde_json::json!([event("shared"), event("theirs"), event("team-sync")])
            } else if target.starts_with("/calendars/team/") {
                serde_json::json!([event("team-sync"), event("all-hands")])
            } else {
                serde_json::json!([event("shared"), event("all-hands")])
            };
            (200, serde_json::json!({ "items": items }).to_string())
        })
        .await;
        let found = server.client().search_events(&CalendarQuery::parse("calendar:week"), 10).await.unwrap();
        let mut listed: Vec<(&str, &str)> = found.iter().map(|e| (e.id.as_str(), e.calendar_id.as_str())).collect();
        listed.sort();
        assert_eq!(listed, vec![("all-hands", "me"), ("shared", "me"), ("team-sync", "team"), ("theirs", "coworker")]);
    }

    #[tokio::test]
    async fn all_day_events_sort_at_the_calendars_midnight() {
        // All-day timestamps are UTC midnight; the day actually starts at the
        // calendar's midnight, before (east of UTC) or after (west) that
        let tokyo = serde_json::json!([
            { "id": "a", "summary": "Early meeting", "start": { "dateTime": "2024-12-23T08:00:00+09:00" } },
            { "id": "b", "summary": "Holiday", "start": { "date": "2024-12-23" }, "end": { "date": "2024-12-24" } },
        ]);
        assert_eq!(searched_titles("Asia/Tokyo", tokyo.clone(), 10).await, vec!["Holiday", "Early meeting"]);
        assert_eq!(searched_titles("Asia/Tokyo", tokyo, 1).await, vec!["Holiday"]);

        // A meeting at the calendar's midnight ties with the all-day event,
        // which goes first
        let midnight = serde_json::json!([
            { "id": "a", "summary": "Midnight call", "start": { "dateTime": "2024-12-23T00:00:00+09:00" } },
            { "id": "b", "summary": "Holiday", "start": { "date": "2024-12-23" }, "end": { "date": "2024-12-24" } },
        ]);
        assert_eq!(searched_titles("Asia/Tokyo", midnight, 10).await, vec!["Holiday", "Midnight call"]);

        let buenos_aires = serde_json::json!([
            { "id": "b", "summary": "Holiday", "start": { "date": "2024-12-23" }, "end": { "date": "2024-12-24" } },
            { "id": "a", "summary": "Late dinner", "start": { "dateTime": "2024-12-22T22:00:00-03:00" } },
        ]);
        assert_eq!(searched_titles("America/Argentina/Buenos_Aires", buenos_aires, 10).await, vec!["Late dinner", "Holiday"]);
    }

    #[test]
    fn test_parse_duration() {
        assert_eq!(parse_duration("7d"), Some(Duration::days(7)));
        assert_eq!(parse_duration("27d"), Some(Duration::days(27)));
        assert_eq!(parse_duration("1w"), Some(Duration::weeks(1)));
        assert_eq!(parse_duration("2m"), Some(Duration::days(60)));
        assert_eq!(parse_duration("1y"), Some(Duration::days(365)));
        assert_eq!(parse_duration("invalid"), None);
    }

    #[test]
    fn parse_duration_rejects_non_ascii_without_panicking() {
        assert_eq!(parse_duration("3é"), None);
        assert_eq!(parse_duration("é"), None);
        assert_eq!(parse_duration("ñd"), None);
        let cq = CalendarQuery::parse("calendar:3é");
        assert!(matches!(cq.time_range, TimeRange::Today));
    }

    #[test]
    fn parse_duration_rejects_negative_and_zero() {
        assert_eq!(parse_duration("-3d"), None);
        assert_eq!(parse_duration("0d"), None);
        assert_eq!(parse_duration("+3d"), None);
    }

    #[test]
    fn huge_durations_do_not_panic() {
        assert_eq!(parse_duration("9223372036854775807d"), None);
        assert_eq!(parse_duration("9999999999999999y"), None);
        assert_eq!(parse_duration("100y"), Some(Duration::days(36500)));
        assert_eq!(parse_duration("101y"), None);
        let now = "2024-07-10T15:30:00Z".parse::<DateTime<Utc>>().unwrap();
        for q in ["calendar:100000000w", "calendar:99999999y"] {
            let (start, end) = CalendarQuery::parse(q).get_time_range_at(Some("UTC"), now);
            assert!(start <= now && end > now);
        }
    }

    #[test]
    fn parse_query_keeps_quoted_values_together() {
        let cq = CalendarQuery::parse(r#"calendar:week location:"New York" standup"#);
        assert_eq!(cq.location.as_deref(), Some("New York"));
        assert_eq!(cq.text.as_deref(), Some("standup"));

        let cq = CalendarQuery::parse(r#"with:"Ana María" -"team sync""#);
        assert_eq!(cq.with, vec!["Ana María".to_string()]);
        assert_eq!(cq.exclude, vec!["team sync".to_string()]);
        assert!(cq.text.is_none());
    }

    #[test]
    fn parse_query_operators_are_case_insensitive() {
        let cq = CalendarQuery::parse("CALENDAR:Tomorrow With:Bob Organizer:alice STATUS:cancelled");
        assert!(matches!(cq.time_range, TimeRange::Tomorrow));
        assert_eq!(cq.with, vec!["Bob".to_string()]);
        assert_eq!(cq.organizer.as_deref(), Some("alice"));
        assert_eq!(cq.status.as_deref(), Some("cancelled"));
    }

    #[test]
    fn test_parse_query_upcoming() {
        let cq = CalendarQuery::parse("calendar:7d");
        match cq.time_range {
            TimeRange::Upcoming(d) => assert_eq!(d, Duration::days(7)),
            _ => panic!("Expected Upcoming(7d)"),
        }
        assert!(cq.text.is_none());
    }

    #[test]
    fn test_parse_query_mixed() {
        let cq = CalendarQuery::parse("calendar:2w meeting with:john");
        match cq.time_range {
            TimeRange::Upcoming(d) => assert_eq!(d, Duration::weeks(2)),
            _ => panic!("Expected Upcoming(2w)"),
        }
        assert_eq!(cq.text, Some("meeting".to_string()));
        assert_eq!(cq.with, vec!["john".to_string()]);
    }

    #[test]
    fn test_get_time_range() {
        let now = "2024-07-10T15:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let utc_midnight = NaiveDate::from_ymd_opt(2024, 7, 10)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let range = |q: &str, tz: &str| CalendarQuery::parse(q).get_time_range_at(Some(tz), now);

        assert_eq!(range("calendar:today", "UTC"), (utc_midnight, utc_midnight + Duration::days(1)));
        assert_eq!(
            range("calendar:tomorrow", "UTC"),
            (utc_midnight + Duration::days(1), utc_midnight + Duration::days(2))
        );
        assert_eq!(range("calendar:week", "UTC"), (utc_midnight, utc_midnight + Duration::days(7)));
        assert_eq!(range("calendar:month", "UTC"), (utc_midnight, utc_midnight + Duration::days(30)));
        // Upcoming ranges start at `now`, not midnight
        assert_eq!(range("calendar:3d", "UTC"), (now, now + Duration::days(3)));

        // "today" is the calendar's day: Buenos Aires (UTC-3) midnight is 03:00 UTC
        let (start, end) = range("calendar:today", "America/Argentina/Buenos_Aires");
        assert_eq!(start, utc_midnight + Duration::hours(3));
        assert_eq!(end, start + Duration::days(1));

        // Late evening in Tokyo is already the next calendar day there
        let (start, _) = range("calendar:today", "Asia/Tokyo");
        assert_eq!(start, utc_midnight + Duration::days(1) - Duration::hours(9));
    }

    fn utc(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    #[test]
    fn test_get_time_range_dst_gap() {
        // Chile springs forward at local midnight: 2024-09-08 00:00 does not
        // exist in America/Santiago, so the day starts at 01:00 (-03)
        let cq = CalendarQuery::parse("calendar:today");
        let now = utc("2024-09-08T15:00:00Z");
        let (start, end) = cq.get_time_range_at(Some("America/Santiago"), now);
        assert_eq!(start, utc("2024-09-08T04:00:00Z"));
        assert_eq!(end, utc("2024-09-09T03:00:00Z"));

        // A normal day resolves to actual local midnight (UTC-4 in July)
        let now = "2024-07-01T15:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let (start, _) = cq.get_time_range_at(Some("America/Santiago"), now);
        let expected = NaiveDate::from_ymd_opt(2024, 7, 1)
            .unwrap()
            .and_hms_opt(4, 0, 0)
            .unwrap()
            .and_utc();
        assert_eq!(start, expected);
    }

    #[test]
    fn day_ranges_follow_local_midnights_across_dst_changes() {
        let range = |q: &str, now: &str| CalendarQuery::parse(q).get_time_range_at(Some("America/New_York"), utc(now));

        // 2024-03-10 is 23 hours long in New York; 2024-11-03 is 25
        assert_eq!(
            range("calendar:today", "2024-03-10T15:00:00Z"),
            (utc("2024-03-10T05:00:00Z"), utc("2024-03-11T04:00:00Z"))
        );
        assert_eq!(
            range("calendar:tomorrow", "2024-03-09T15:00:00Z"),
            (utc("2024-03-10T05:00:00Z"), utc("2024-03-11T04:00:00Z"))
        );
        assert_eq!(
            range("calendar:week", "2024-03-08T15:00:00Z"),
            (utc("2024-03-08T05:00:00Z"), utc("2024-03-15T04:00:00Z"))
        );
        assert_eq!(
            range("calendar:today", "2024-11-03T15:00:00Z"),
            (utc("2024-11-03T04:00:00Z"), utc("2024-11-04T05:00:00Z"))
        );
    }
}

/// A local HTTP server standing in for Google in client tests
#[cfg(test)]
pub(crate) mod stub_server {
    type Handler = dyn Fn(&str, &str) -> (u16, String) + Send + Sync;
    type Requests = std::sync::Arc<std::sync::Mutex<Vec<(String, String, String)>>>;
    type Gate = std::sync::Arc<(Box<dyn Fn(&str) -> bool + Send + Sync>, tokio::sync::Barrier)>;

    /// A local keep-alive HTTP server answering each request with
    /// `handler(method, path_and_query)`; records every request as (method,
    /// target, body) and counts the connections it accepted
    pub(crate) struct StubServer {
        pub(crate) base: String,
        requests: Requests,
        connections: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        most_in_flight: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl StubServer {
        pub(crate) async fn start(handler: impl Fn(&str, &str) -> (u16, String) + Send + Sync + 'static) -> Self {
            Self::start_inner(std::sync::Arc::new(handler), None, None).await
        }

        /// Every request is answered only after `hold`, so requests sent
        /// together overlap and `most_in_flight` sees them
        pub(crate) async fn start_slow(
            handler: impl Fn(&str, &str) -> (u16, String) + Send + Sync + 'static,
            hold: std::time::Duration,
        ) -> Self {
            Self::start_inner(std::sync::Arc::new(handler), None, Some(hold)).await
        }

        /// Requests whose target satisfies `gated` are held until `n` of them
        /// are in flight at once, so a caller sending them one at a time
        /// never gets an answer
        pub(crate) async fn start_gated(
            handler: impl Fn(&str, &str) -> (u16, String) + Send + Sync + 'static,
            gated: impl Fn(&str) -> bool + Send + Sync + 'static,
            n: usize,
        ) -> Self {
            let gate: Gate = std::sync::Arc::new((Box::new(gated), tokio::sync::Barrier::new(n)));
            Self::start_inner(std::sync::Arc::new(handler), Some(gate), None).await
        }

        async fn start_inner(handler: std::sync::Arc<Handler>, gate: Option<Gate>, hold: Option<std::time::Duration>) -> Self {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let requests: Requests = Default::default();
            let connections = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let in_flight = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let most_in_flight = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let log = requests.clone();
            let accepted = connections.clone();
            let peak = most_in_flight.clone();
            tokio::spawn(async move {
                loop {
                    let Ok((mut socket, _)) = listener.accept().await else { return };
                    accepted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let handler = handler.clone();
                    let log = log.clone();
                    let gate = gate.clone();
                    let in_flight = in_flight.clone();
                    let peak = peak.clone();
                    tokio::spawn(async move {
                        let mut buf = Vec::new();
                        let mut chunk = [0u8; 4096];
                        loop {
                            let header_end = loop {
                                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                                    break i + 4;
                                }
                                match socket.read(&mut chunk).await {
                                    Ok(0) | Err(_) => return,
                                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                                }
                            };
                            let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
                            let content_length = head
                                .lines()
                                .find_map(|l| {
                                    let (k, v) = l.split_once(':')?;
                                    k.eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<usize>().ok())?
                                })
                                .unwrap_or(0);
                            while buf.len() < header_end + content_length {
                                match socket.read(&mut chunk).await {
                                    Ok(0) | Err(_) => return,
                                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                                }
                            }
                            let mut request_line = head.lines().next().unwrap_or_default().split(' ');
                            let method = request_line.next().unwrap_or_default().to_string();
                            let target = request_line.next().unwrap_or_default().to_string();
                            let body = String::from_utf8_lossy(&buf[header_end..header_end + content_length]).to_string();
                            buf.drain(..header_end + content_length);
                            if let Some(gate) = &gate {
                                if (gate.0)(&target) {
                                    gate.1.wait().await;
                                }
                            }
                            if let Some(hold) = hold {
                                use std::sync::atomic::Ordering::SeqCst;
                                peak.fetch_max(in_flight.fetch_add(1, SeqCst) + 1, SeqCst);
                                tokio::time::sleep(hold).await;
                                in_flight.fetch_sub(1, SeqCst);
                            }
                            let (status, response) = handler(&method, &target);
                            log.lock().unwrap().push((method, target, body));
                            let reply = format!(
                                "HTTP/1.1 {} Stub\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                                status,
                                response.len(),
                                response
                            );
                            if socket.write_all(reply.as_bytes()).await.is_err() {
                                return;
                            }
                        }
                    });
                }
            });
            StubServer { base, requests, connections, most_in_flight }
        }

        pub(crate) fn requests(&self) -> Vec<(String, String, String)> {
            self.requests.lock().unwrap().clone()
        }

        pub(crate) fn connections(&self) -> usize {
            self.connections.load(std::sync::atomic::Ordering::SeqCst)
        }

        /// The most requests held at once by a `start_slow` server
        pub(crate) fn most_in_flight(&self) -> usize {
            self.most_in_flight.load(std::sync::atomic::Ordering::SeqCst)
        }
    }
}
