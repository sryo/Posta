// All-inboxes cards: one list merged from every account's mail or events

use crate::calendar::CalendarEvent;
use crate::models::Thread;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

/// Where each account's list goes on from, sent to the frontend as an
/// all-inboxes card's page token. An account missing from it has no more
/// threads to list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Cursor {
    v: u32,
    #[serde(rename = "a")]
    accounts: BTreeMap<String, AccountCursor>,
}

/// One account's place: the Gmail page to list (None is the first) and how
/// many of its threads were already shown
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AccountCursor {
    pub page: Option<String>,
    pub skip: usize,
}

const CURSOR_VERSION: u32 = 1;

impl Cursor {
    /// The first page of every account
    pub fn start<'a>(account_ids: impl IntoIterator<Item = &'a str>) -> Self {
        let accounts = account_ids.into_iter().map(|id| (id.to_string(), AccountCursor::default())).collect();
        Self { v: CURSOR_VERSION, accounts }
    }

    pub fn parse(token: &str) -> Result<Self, String> {
        match serde_json::from_str::<Self>(token) {
            Ok(cursor) if cursor.v == CURSOR_VERSION => Ok(cursor),
            _ => Err("This card's next page can't be read; refresh the card".to_string()),
        }
    }

    pub fn token(&self) -> Option<String> {
        (!self.accounts.is_empty()).then(|| serde_json::to_string(self).unwrap_or_default())
    }

    pub fn accounts(&self) -> impl Iterator<Item = (&String, &AccountCursor)> {
        self.accounts.iter()
    }
}

/// What one account's list gave for a merge
pub struct AccountPage {
    pub account_id: String,
    /// The Gmail page's thread ids, in list order
    pub ids: Vec<String>,
    /// How many of `ids` an earlier merge already showed
    pub skip: usize,
    /// Details of `ids[skip..]`; a thread deleted since it was listed is missing
    pub threads: Vec<Thread>,
    /// The page `ids` came from, listed again while some of it is left
    pub page: Option<String>,
    pub next_page_token: Option<String>,
}

/// Threads to show from every account's page, newest first, and where each
/// account goes on from. Only threads no older than the frontier are shown:
/// the newest of the oldest threads left on the pages of accounts with more
/// pages, so no later page can hold a thread newer than one shown. Each
/// account shows a run of its list from the start, so a thread is never
/// shown twice; the account setting the frontier shows its whole page, so
/// every merge moves on.
pub fn merge_account_pages(pages: Vec<AccountPage>) -> (Vec<Thread>, Cursor) {
    let frontier: Option<DateTime<Utc>> = pages
        .iter()
        .filter(|p| p.next_page_token.is_some())
        .filter_map(|p| p.threads.iter().map(|t| t.last_message_date).min())
        .max();

    let mut shown = Vec::new();
    let mut cursor = Cursor { v: CURSOR_VERSION, accounts: BTreeMap::new() };
    for page in pages {
        let mut details: std::collections::HashMap<String, Thread> =
            page.threads.into_iter().map(|t| (t.gmail_thread_id.clone(), t)).collect();
        let mut skip = page.skip.min(page.ids.len());
        for id in &page.ids[skip..] {
            match details.get(id) {
                Some(thread) if frontier.is_some_and(|f| thread.last_message_date < f) => break,
                Some(_) => shown.push(details.remove(id).expect("present")),
                None => {}
            }
            skip += 1;
        }
        let next = if skip < page.ids.len() {
            Some(AccountCursor { page: page.page, skip })
        } else {
            page.next_page_token.map(|token| AccountCursor { page: Some(token), skip: 0 })
        };
        if let Some(next) = next {
            cursor.accounts.insert(page.account_id, next);
        }
    }
    shown.sort_by(|a, b| b.last_message_date.cmp(&a.last_message_date));
    (shown, cursor)
}

/// The first `limit` threads across every account, newest first
pub fn newest_threads(threads: Vec<Thread>, limit: usize) -> Vec<Thread> {
    let mut threads = threads;
    threads.sort_by(|a, b| b.last_message_date.cmp(&a.last_message_date));
    threads.truncate(limit);
    threads
}

/// Every account's events, each named after its account, in the order a
/// calendar card lists them (`search_events`'). An
/// event on several accounts' calendars (an invite between them) shows once:
/// a copy the user can edit, else the first account's.
pub fn merge_calendar_events(by_account: Vec<(String, Vec<CalendarEvent>)>) -> Vec<CalendarEvent> {
    let mut events: Vec<CalendarEvent> = Vec::new();
    for (account_id, list) in by_account {
        for event in list {
            let event = CalendarEvent { account_id: account_id.clone(), ..event };
            match events.iter_mut().find(|e| e.id == event.id) {
                Some(kept) if event.can_edit && !kept.can_edit => *kept = event,
                Some(_) => {}
                None => events.push(event),
            }
        }
    }
    events.sort_by_key(crate::calendar::local_display_order);
    events
}

/// Which account an all-inboxes fetch failed on, so the frontend can tell
/// whose session expired
pub fn account_error(email: &str, error: &str) -> String {
    format!("{}: {}", email, error)
}

/// Accounts the cursor still lists, among those signed in
pub fn listed_accounts<'a>(cursor: &'a Cursor, signed_in: &HashSet<&str>) -> Vec<(&'a String, &'a AccountCursor)> {
    cursor.accounts().filter(|(id, _)| signed_in.contains(id.as_str())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(id: &str, account: &str, minutes_ago: i64) -> Thread {
        Thread {
            gmail_thread_id: id.into(),
            account_id: account.into(),
            subject: id.into(),
            snippet: String::new(),
            last_message_date: DateTime::from_timestamp(1_800_000_000 - minutes_ago * 60, 0).unwrap(),
            unread_count: 0,
            labels: Vec::new(),
            participants: Vec::new(),
            has_attachment: false,
            attachments: Vec::new(),
            calendar_event: None,
            last_sender: None,
            last_from_list: false,
        }
    }

    /// A page listing `threads` (id, minutes ago) in order
    fn page(account: &str, threads: &[(&str, i64)], skip: usize, page: Option<&str>, next: Option<&str>) -> AccountPage {
        AccountPage {
            account_id: account.into(),
            ids: threads.iter().map(|(id, _)| id.to_string()).collect(),
            skip,
            threads: threads[skip..].iter().map(|(id, ago)| thread(id, account, *ago)).collect(),
            page: page.map(str::to_string),
            next_page_token: next.map(str::to_string),
        }
    }

    fn ids(threads: &[Thread]) -> Vec<&str> {
        threads.iter().map(|t| t.gmail_thread_id.as_str()).collect()
    }

    fn at(page: Option<&str>, skip: usize) -> AccountCursor {
        AccountCursor { page: page.map(str::to_string), skip }
    }

    #[test]
    fn the_cursor_round_trips_through_its_token() {
        let mut cursor = Cursor::start(["a", "b"]);
        cursor.accounts.insert("b".into(), at(Some("gmail-token"), 3));
        let token = cursor.token().unwrap();
        assert!(token.starts_with(r#"{"v":1,"a":{"#), "{}", token);
        assert_eq!(Cursor::parse(&token).unwrap(), cursor);
        assert!(Cursor::parse("gmail-token").is_err(), "a single account's Gmail token is not a cursor");
        assert!(Cursor::parse(r#"{"v":2,"a":{}}"#).is_err());
        assert_eq!(Cursor::start([]).token(), None, "nothing left to list");
    }

    #[test]
    fn threads_of_two_accounts_merge_newest_first_and_older_ones_wait() {
        let (shown, cursor) = merge_account_pages(vec![
            page("a", &[("a1", 1), ("a2", 10), ("a3", 30)], 0, None, Some("a-next")),
            page("b", &[("b1", 5), ("b2", 20), ("b3", 40)], 0, None, Some("b-next")),
        ]);
        // b's page ends 40 minutes ago, a's 30: a's next page could hold
        // something from 35 minutes ago, newer than b3
        assert_eq!(ids(&shown), ["a1", "b1", "a2", "b2", "a3"]);
        assert_eq!(cursor.accounts["a"], at(Some("a-next"), 0));
        assert_eq!(cursor.accounts["b"], at(None, 2));
    }

    #[test]
    fn an_account_without_more_pages_does_not_hold_the_others_back_and_leaves_when_done() {
        let (shown, cursor) = merge_account_pages(vec![
            page("a", &[("a1", 1), ("a2", 50)], 0, None, None),
            page("b", &[("b1", 5), ("b2", 20)], 0, Some("b-page"), Some("b-next")),
        ]);
        assert_eq!(ids(&shown), ["a1", "b1", "b2"]);
        assert_eq!(cursor.accounts["a"], at(None, 1));
        assert_eq!(cursor.accounts["b"], at(Some("b-next"), 0));

        let (shown, cursor) = merge_account_pages(vec![
            page("a", &[("a1", 1), ("a2", 50)], 1, None, None),
            page("b", &[("b3", 60)], 0, Some("b-next"), None),
        ]);
        assert_eq!(ids(&shown), ["a2", "b3"]);
        assert_eq!(cursor.token(), None);
    }

    #[test]
    fn threads_deleted_since_they_were_listed_are_passed_over() {
        let mut listed = page("a", &[("a1", 1), ("gone", 2), ("a2", 3)], 0, None, Some("a-next"));
        listed.threads.retain(|t| t.gmail_thread_id != "gone");
        let (shown, cursor) = merge_account_pages(vec![listed]);
        assert_eq!(ids(&shown), ["a1", "a2"]);
        assert_eq!(cursor.accounts["a"], at(Some("a-next"), 0));
    }

    #[test]
    fn a_thread_listed_after_one_held_back_waits_with_it() {
        // Gmail's order and the last message's date can disagree; showing b3
        // now would show it again once b2's turn comes
        let (shown, cursor) = merge_account_pages(vec![
            page("a", &[("a1", 1), ("a2", 10)], 0, None, Some("a-next")),
            page("b", &[("b1", 5), ("b2", 20), ("b3", 8)], 0, None, None),
        ]);
        assert_eq!(ids(&shown), ["a1", "b1", "a2"]);
        assert_eq!(cursor.accounts["b"], at(None, 1));
    }

    #[test]
    fn one_account_pages_as_gmail_does() {
        let (shown, cursor) = merge_account_pages(vec![page("a", &[("a1", 1), ("a2", 2)], 0, None, Some("next"))]);
        assert_eq!(ids(&shown), ["a1", "a2"]);
        assert_eq!(cursor.accounts["a"], at(Some("next"), 0));
        let (shown, cursor) = merge_account_pages(vec![page("a", &[("a3", 3)], 0, Some("next"), None)]);
        assert_eq!(ids(&shown), ["a3"]);
        assert_eq!(cursor.token(), None);
    }

    /// Lists `mailbox` (newest first) `size` threads per page, like Gmail
    fn list(account: &str, mailbox: &[(String, i64)], at: &AccountCursor, size: usize) -> AccountPage {
        let start: usize = at.page.as_deref().map_or(0, |p| p.parse().unwrap());
        let end = (start + size).min(mailbox.len());
        let listed: Vec<(&str, i64)> = mailbox[start..end].iter().map(|(id, ago)| (id.as_str(), *ago)).collect();
        let next = (end < mailbox.len()).then(|| end.to_string());
        page(account, &listed, at.skip, at.page.as_deref(), next.as_deref())
    }

    #[test]
    fn paging_through_two_mailboxes_shows_every_thread_once_in_order() {
        let mailbox = |prefix: &str, agos: &[i64]| -> Vec<(String, i64)> {
            agos.iter().enumerate().map(|(i, ago)| (format!("{}{}", prefix, i), *ago)).collect()
        };
        let a = mailbox("a", &[1, 2, 3, 50, 51, 52, 53, 54, 200, 300, 301]);
        let b = mailbox("b", &[4, 5, 60, 61, 62, 100, 101, 102, 103, 104, 105, 250]);

        let mut cursor = Cursor::start(["a", "b"]);
        let mut seen: Vec<Thread> = Vec::new();
        for _ in 0..50 {
            let pages = cursor
                .accounts()
                .map(|(id, at)| list(id, if id == "a" { &a } else { &b }, at, 3))
                .collect();
            let (shown, next) = merge_account_pages(pages);
            seen.extend(shown);
            cursor = next;
            if cursor.token().is_none() {
                break;
            }
        }
        assert_eq!(cursor.token(), None, "the listing ends");
        let dates: Vec<_> = seen.iter().map(|t| t.last_message_date).collect();
        assert!(dates.windows(2).all(|w| w[0] >= w[1]), "newest first across pages");
        let mut expected: Vec<String> = a.iter().chain(&b).map(|(id, _)| id.clone()).collect();
        let mut got: Vec<String> = seen.iter().map(|t| t.gmail_thread_id.clone()).collect();
        expected.sort();
        got.sort();
        assert_eq!(got, expected);
    }

    fn event(id: &str, start: i64, can_edit: bool) -> CalendarEvent {
        CalendarEvent {
            id: id.into(),
            calendar_id: "primary".into(),
            calendar_name: String::new(),
            title: id.into(),
            description: None,
            location: None,
            start_time: start,
            end_time: None,
            all_day: false,
            status: "confirmed".into(),
            organizer: None,
            attendees: Vec::new(),
            html_link: None,
            hangout_link: None,
            response_status: None,
            can_edit,
            recurring_event_id: None,
            account_id: String::new(),
        }
    }

    #[test]
    fn calendar_events_of_every_account_are_named_sorted_and_shown_once() {
        let merged = merge_calendar_events(vec![
            ("a".into(), vec![event("standup", 10, false), event("lunch", 30, true)]),
            ("b".into(), vec![event("review", 20, true), event("standup", 10, true), event("lunch", 30, true)]),
        ]);
        let summary: Vec<_> = merged.iter().map(|e| (e.id.as_str(), e.account_id.as_str())).collect();
        assert_eq!(summary, [("standup", "b"), ("review", "b"), ("lunch", "a")]);
    }

    #[test]
    fn an_all_inboxes_error_names_the_account() {
        assert_eq!(account_error("b@x.com", "Search failed: 401 Unauthorized"), "b@x.com: Search failed: 401 Unauthorized");
    }

    #[test]
    fn newest_threads_across_accounts_come_first() {
        let threads = vec![thread("a1", "a", 10), thread("b1", "b", 1), thread("a2", "a", 5)];
        assert_eq!(ids(&newest_threads(threads, 2)), ["b1", "a2"]);
    }

    #[test]
    fn accounts_signed_out_since_the_last_page_are_not_listed() {
        let cursor = Cursor::start(["a", "gone"]);
        let listed = listed_accounts(&cursor, &HashSet::from(["a"]));
        assert_eq!(listed.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), ["a"]);
    }
}
