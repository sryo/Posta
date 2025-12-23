// Google Calendar API client

use chrono::{DateTime, Duration, NaiveDate, Utc};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";

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

    match status {
        StatusCode::UNAUTHORIZED => "Calendar access expired. Please re-login.".to_string(),
        StatusCode::FORBIDDEN => "Calendar access denied. Please re-login to grant permissions.".to_string(),
        StatusCode::NOT_FOUND => "Calendar not found.".to_string(),
        StatusCode::TOO_MANY_REQUESTS => "Too many requests. Please try again later.".to_string(),
        _ => format!("Calendar error ({})", status),
    }
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventAttendee {
    pub email: String,
    pub display_name: Option<String>,
    pub response_status: Option<String>,
    pub is_self: bool,
    pub is_organizer: bool,
}

#[derive(Debug, Deserialize)]
struct CalendarListResponse {
    items: Option<Vec<CalendarListEntry>>,
}

#[derive(Debug, Deserialize)]
struct CalendarListEntry {
    id: String,
    summary: Option<String>,
    primary: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct EventsListResponse {
    items: Option<Vec<ApiEvent>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
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
    organizer: Option<EventOrganizer>,
    attendees: Option<Vec<ApiAttendee>>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
    #[serde(rename = "hangoutLink")]
    hangout_link: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct EventDateTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
    #[serde(rename = "timeZone")]
    time_zone: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EventOrganizer {
    email: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
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
    attendees: Option<Vec<AttendeeInput>>,
    recurrence: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct EventDateTimeInput {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Serialize)]
struct AttendeeInput {
    email: String,
}

pub struct CalendarClient {
    http_client: reqwest::Client,
    access_token: String,
}

impl CalendarClient {
    pub fn new(access_token: String) -> Self {
        Self {
            http_client: reqwest::Client::new(),
            access_token,
        }
    }

    /// List all calendars for the user
    pub async fn list_calendars(&self) -> Result<Vec<(String, String, bool)>, String> {
        let url = format!("{}/users/me/calendarList", CALENDAR_API_BASE);

        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Calendar API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(friendly_calendar_error(status, &body));
        }

        let data: CalendarListResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse calendar list: {}", e))?;

        Ok(data
            .items
            .unwrap_or_default()
            .into_iter()
            .map(|c| (c.id, c.summary.unwrap_or_default(), c.primary.unwrap_or(false)))
            .collect())
    }

    /// Fetch events from a calendar within a time range
    pub async fn list_events(
        &self,
        calendar_id: &str,
        calendar_name: &str,
        time_min: DateTime<Utc>,
        time_max: DateTime<Utc>,
        max_results: i32,
    ) -> Result<Vec<CalendarEvent>, String> {
        let url = format!(
            "{}/calendars/{}/events?timeMin={}&timeMax={}&maxResults={}&singleEvents=true&orderBy=startTime",
            CALENDAR_API_BASE,
            urlencoding::encode(calendar_id),
            urlencoding::encode(&time_min.to_rfc3339()),
            urlencoding::encode(&time_max.to_rfc3339()),
            max_results
        );

        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Calendar events request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(friendly_calendar_error(status, &body));
        }

        let data: EventsListResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse events: {}", e))?;

        let events = data
            .items
            .unwrap_or_default()
            .into_iter()
            .filter_map(|e| self.api_event_to_calendar_event(e, calendar_id, calendar_name))
            .collect();

        Ok(events)
    }

    /// Search events across all calendars
    pub async fn search_events(
        &self,
        query: &CalendarQuery,
        max_results: i32,
    ) -> Result<Vec<CalendarEvent>, String> {
        let calendars = self.list_calendars().await?;
        let mut all_events = Vec::new();

        // Determine time range from query
        let (time_min, time_max) = query.get_time_range();
        println!("DEBUG: Searching events with range: {} to {}", time_min, time_max);

        for (calendar_id, calendar_name, _primary) in calendars {
            let mut url = format!(
                "{}/calendars/{}/events?timeMin={}&timeMax={}&maxResults={}&singleEvents=true&orderBy=startTime",
                CALENDAR_API_BASE,
                urlencoding::encode(&calendar_id),
                urlencoding::encode(&time_min.to_rfc3339()),
                urlencoding::encode(&time_max.to_rfc3339()),
                max_results
            );

            // Add text search if provided
            if let Some(q) = &query.text {
                url.push_str(&format!("&q={}", urlencoding::encode(q)));
            }

            let resp = self
                .http_client
                .get(&url)
                .bearer_auth(&self.access_token)
                .send()
                .await
                .map_err(|e| format!("Calendar search failed: {}", e))?;

            if !resp.status().is_success() {
                continue; // Skip calendars with errors
            }

            let data: EventsListResponse = match resp.json().await {
                Ok(d) => d,
                Err(_) => continue,
            };

            let events: Vec<CalendarEvent> = data
                .items
                .unwrap_or_default()
                .into_iter()
                .filter_map(|e| self.api_event_to_calendar_event(e, &calendar_id, &calendar_name))
                .collect();

            all_events.extend(events);
        }

        // Apply additional filters
        let filtered: Vec<CalendarEvent> = all_events
            .into_iter()
            .filter(|e| query.matches(e))
            .collect();

        // Sort by start time
        let mut sorted = filtered;
        sorted.sort_by_key(|e| e.start_time);

        // Limit results
        sorted.truncate(max_results as usize);

        Ok(sorted)
    }

    /// Create a new event
    pub async fn create_event(
        &self,
        calendar_id: &str,
        summary: String,
        description: Option<String>,
        start_time: i64,
        end_time: i64,
        all_day: bool,
        location: Option<String>,
        attendees: Option<Vec<String>>,
        recurrence: Option<Vec<String>>,
    ) -> Result<CalendarEvent, String> {
        let url = format!(
            "{}/calendars/{}/events",
            CALENDAR_API_BASE,
            urlencoding::encode(calendar_id)
        );

        let start_dt = DateTime::<Utc>::from_timestamp(start_time / 1000, (start_time % 1000 * 1_000_000) as u32).ok_or("Invalid start time")?;
        let end_dt = DateTime::<Utc>::from_timestamp(end_time / 1000, (end_time % 1000 * 1_000_000) as u32).ok_or("Invalid end time")?;

        let (start, end) = if all_day {
            (
                EventDateTimeInput {
                    date: Some(start_dt.format("%Y-%m-%d").to_string()),
                    date_time: None,
                },
                EventDateTimeInput {
                    date: Some(end_dt.format("%Y-%m-%d").to_string()),
                    date_time: None,
                },
            )
        } else {
            (
                EventDateTimeInput {
                    date_time: Some(start_dt.to_rfc3339()),
                    date: None,
                },
                EventDateTimeInput {
                    date_time: Some(end_dt.to_rfc3339()),
                    date: None,
                },
            )
        };

        let body = CreateEventRequest {
            summary,
            description,
            location,
            start,
            end,
            attendees: attendees.map(|emails| {
                emails
                    .into_iter()
                    .map(|email| AttendeeInput { email })
                    .collect()
            }),
            recurrence,
        };

        let resp = self
            .http_client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Create event request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(friendly_calendar_error(status, &body));
        }

        let api_event: ApiEvent = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse created event: {}", e))?;

        // We can use "primary" as calendar name for the returned object since we don't have it easily here, 
        // or just empty string. It's mostly for display.
        self.api_event_to_calendar_event(api_event, calendar_id, "")
            .ok_or_else(|| "Failed to convert created event".to_string())
    }

    fn api_event_to_calendar_event(&self, event: ApiEvent, calendar_id: &str, calendar_name: &str) -> Option<CalendarEvent> {
        let (start_time, all_day) = self.parse_event_datetime(&event.start)?;
        let end_time = event.end.as_ref().and_then(|e| self.parse_event_datetime(&Some(e.clone())).map(|(t, _)| t));

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
            organizer: event.organizer.and_then(|o| o.email.or(o.display_name)),
            attendees,
            html_link: event.html_link,
            hangout_link: event.hangout_link,
            response_status,
        })
    }

    fn parse_event_datetime(&self, dt: &Option<EventDateTime>) -> Option<(i64, bool)> {
        let dt = dt.as_ref()?;

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

fn parse_duration(s: &str) -> Option<Duration> {
    let len = s.len();
    if len < 2 {
        return None;
    }
    let (num_str, unit) = s.split_at(len - 1);
    let num: i64 = num_str.parse().ok()?;
    match unit {
        "d" => Some(Duration::days(num)),
        "w" => Some(Duration::weeks(num)),
        "m" => Some(Duration::days(num * 30)),
        "y" => Some(Duration::days(num * 365)),
        _ => None,
    }
}

#[derive(Debug, Default, Clone)]
pub enum TimeRange {
    #[default]
    Today,
    Tomorrow,
    Week,
    Month,
    Upcoming(Duration),
    Custom { start: DateTime<Utc>, end: DateTime<Utc> },
}

impl CalendarQuery {
    pub fn parse(query: &str) -> Self {
        let mut cq = CalendarQuery::default();
        let mut remaining_text = Vec::new();

        for token in query.split_whitespace() {
            let token_lower = token.to_lowercase();

            if token_lower.starts_with("calendar:") {
                let value = &token[9..];
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
            } else if token_lower.starts_with("with:") {
                cq.with.push(token[5..].to_string());
            } else if token_lower.starts_with("organizer:") {
                cq.organizer = Some(token[10..].to_string());
            } else if token_lower.starts_with("location:") {
                cq.location = Some(token[9..].trim_matches('"').to_string());
            } else if token_lower.starts_with("status:") {
                cq.status = Some(token[7..].to_string());
            } else if token_lower.starts_with("response:") {
                cq.response = Some(token[9..].to_string());
            } else if token.starts_with('-') && token.len() > 1 {
                cq.exclude.push(token[1..].to_string());
            } else {
                remaining_text.push(token.to_string());
            }
        }

        if !remaining_text.is_empty() {
            cq.text = Some(remaining_text.join(" "));
        }
        println!("DEBUG: Parsed query '{query}' -> TimeRange: {:?}, Text: {:?}", cq.time_range, cq.text);

        cq
    }

    pub fn get_time_range(&self) -> (DateTime<Utc>, DateTime<Utc>) {
        let now = Utc::now();
        // Use yesterday as potential start buffer to handle Timezone offsets 
        // ensuring we don't miss "today's" events in local time that are "yesterday" in UTC
        // or just to be safe.
        // Actually, let's just stick to strict Today unless upcoming.
        
        let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();

        match &self.time_range {
            TimeRange::Today => (today_start, today_start + Duration::days(1)),
            TimeRange::Tomorrow => (
                today_start + Duration::days(1),
                today_start + Duration::days(2),
            ),
            TimeRange::Week => (today_start, today_start + Duration::days(7)),
            TimeRange::Month => (today_start, today_start + Duration::days(30)),
            // For upcoming, we start from NOW to avoid missing things that just started,
            // also avoids showing events from "yesterday" due to timezone offsets if we used today_start (UTC 00:00)
            TimeRange::Upcoming(duration) => (now, now + *duration),
            TimeRange::Custom { start, end } => (*start, *end),
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
            let event_response = event.response_status.as_deref().unwrap_or("needsAction");
            if event_response.to_lowercase() != response.to_lowercase() {
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

    #[test]
    fn test_parse_duration() {
        assert_eq!(parse_duration("7d"), Some(Duration::days(7)));
        assert_eq!(parse_duration("1w"), Some(Duration::weeks(1)));
        assert_eq!(parse_duration("2m"), Some(Duration::days(60)));
        assert_eq!(parse_duration("1y"), Some(Duration::days(365)));
        assert_eq!(parse_duration("invalid"), None);
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
        let cq = CalendarQuery::parse("calendar:7d");
        let (start, end) = cq.get_time_range();
        
        let now = Utc::now();
        let today = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
        
        // Start should be today (midnight UTC)
        assert_eq!(start, today);
        // End should be today + 7 days
        assert_eq!(end, today + Duration::days(7));
    }
}

#[cfg(test)]
mod tests_27d {
    use super::*;
    #[test]
    fn test_27d() {
         assert_eq!(parse_duration("27d"), Some(Duration::days(27)));
    }
}
