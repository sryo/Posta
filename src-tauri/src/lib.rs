// Gmail client - Posta

pub mod auth;
pub mod cache;
pub mod calendar;
pub mod commands;
pub mod gmail;
pub mod icloud;
pub mod models;
pub mod people;
pub mod ai;

use commands::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::{RunEvent, WindowEvent};
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::Listener;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri_plugin_deep_link::DeepLinkExt;

/// Parsed mailto: URL data
#[derive(Debug, Clone, serde::Serialize)]
pub struct MailtoData {
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
}

const MAILTO_SCHEME: &str = "mailto:";

fn is_mailto(url: &str) -> bool {
    url.get(..MAILTO_SCHEME.len())
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case(MAILTO_SCHEME))
}

fn percent_decode(s: &str) -> String {
    String::from_utf8_lossy(&urlencoding::decode_binary(s.as_bytes())).into_owned()
}

fn append_recipients(field: &mut String, recipients: &str) {
    if recipients.is_empty() {
        return;
    }
    if !field.is_empty() {
        field.push_str(", ");
    }
    field.push_str(recipients);
}

/// Parse a mailto: URL (RFC 6068) into structured data
fn parse_mailto(url: &str) -> MailtoData {
    let mut data = MailtoData {
        to: String::new(),
        cc: String::new(),
        bcc: String::new(),
        subject: String::new(),
        body: String::new(),
    };

    let url = if is_mailto(url) { &url[MAILTO_SCHEME.len()..] } else { url };

    let (email_part, query_part) = match url.split_once('?') {
        Some((e, q)) => (e, Some(q)),
        None => (url, None),
    };

    data.to = percent_decode(email_part);

    if let Some(query) = query_part {
        for param in query.split('&') {
            if let Some((key, value)) = param.split_once('=') {
                let decoded = percent_decode(value);
                match key.to_lowercase().as_str() {
                    "to" => append_recipients(&mut data.to, &decoded),
                    "cc" => append_recipients(&mut data.cc, &decoded),
                    "bcc" => append_recipients(&mut data.bcc, &decoded),
                    "subject" => data.subject = decoded,
                    "body" => data.body = decoded,
                    _ => {}
                }
            }
        }
    }

    data
}

/// Mailto URLs received before the webview registered its "mailto-received"
/// listener (cold start). `ready` flips once the frontend has loaded.
#[derive(Default)]
struct PendingMailto(Mutex<PendingMailtoInner>);

#[derive(Default)]
struct PendingMailtoInner {
    ready: bool,
    urls: Vec<String>,
}

/// Emit a mailto URL to the frontend, or buffer it until the webview is ready
fn deliver_mailto(handle: &tauri::AppHandle, url: &str) {
    let buffered = {
        let pending = handle.state::<PendingMailto>();
        let mut inner = pending.0.lock().unwrap();
        if inner.ready {
            false
        } else {
            if !inner.urls.iter().any(|u| u == url) {
                inner.urls.push(url.to_string());
            }
            true
        }
    };

    if !buffered {
        let mailto_data = parse_mailto(url);
        tracing::info!("Received mailto: to={}", mailto_data.to);
        let _ = handle.emit("mailto-received", mailto_data);
    }

    // Show and focus the window
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Mark the frontend ready and replay any mailto links buffered during startup
fn flush_pending_mailtos(handle: &tauri::AppHandle) {
    let urls = {
        let pending = handle.state::<PendingMailto>();
        let mut inner = pending.0.lock().unwrap();
        inner.ready = true;
        std::mem::take(&mut inner.urls)
    };

    for url in urls {
        let mailto_data = parse_mailto(&url);
        tracing::info!("Delivering buffered mailto: to={}", mailto_data.to);
        let _ = handle.emit("mailto-received", mailto_data);
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::new())
        .manage(PendingMailto::default())
        .setup(|app| {
            // Handle deep links (mailto:)
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let handle = app.handle().clone();
                app.listen("deep-link://new-url", move |event: tauri::Event| {
                    let urls = event.payload();
                    // The payload is a JSON array of URLs
                    if let Ok(url_list) = serde_json::from_str::<Vec<String>>(urls) {
                        for url in url_list {
                            if is_mailto(&url) {
                                deliver_mailto(&handle, &url);
                            }
                        }
                    }
                });

                // Cold start: pick up URL(s) the app was launched with, which
                // can arrive before the listener above is registered
                match app.deep_link().get_current() {
                    Ok(Some(urls)) => {
                        for url in urls {
                            if is_mailto(url.as_str()) {
                                deliver_mailto(app.handle(), url.as_str());
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(e) => tracing::warn!("Failed to read startup deep link: {}", e),
                }
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            // The frontend registers its "mailto-received" listener right after
            // mount; wait a beat past load-finished before replaying buffered links
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let handle = webview.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    flush_pending_mailtos(&handle);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_app,
            commands::configure_auth,
            commands::get_stored_credentials,
            commands::run_oauth_flow,
            commands::get_accounts,
            commands::delete_account,
            commands::update_account_signature,
            commands::get_cards,
            commands::create_card,
            commands::update_card,
            commands::delete_card,
            commands::reorder_cards,
            commands::fetch_threads_paginated,
            commands::sync_threads_incremental,
            commands::search_threads_preview,
            commands::modify_threads,
            commands::get_thread_details,
            commands::send_email,
            commands::reply_to_thread,
            commands::send_reaction,
            commands::get_cached_card_threads,
            commands::save_cached_card_threads,
            commands::get_cached_card_events,
            commands::save_cached_card_events,
            commands::clear_card_cache,
            commands::download_attachment,
            commands::open_attachment,
            commands::save_attachment,
            commands::list_labels,
            commands::save_draft,
            commands::delete_draft,
            commands::rsvp_calendar_event,
            commands::get_calendar_rsvp_status,
            commands::pull_from_icloud,
            commands::fetch_contacts,
            commands::list_calendars,
            commands::fetch_calendar_events,
            commands::create_calendar_event,
            commands::move_calendar_event,
            commands::delete_calendar_event,
            commands::update_calendar_event,
            commands::suggest_replies,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // On macOS closing the window hides it and the dock icon brings it back;
    // elsewhere closing the window quits
    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { api, .. },
            label,
            ..
        } => {
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.hide();
                api.prevent_close();
            }
        }
        RunEvent::ExitRequested { api, .. } => api.prevent_exit(),
        RunEvent::Reopen { .. } => {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}

#[cfg(test)]
mod tests {
    use super::{is_mailto, parse_mailto};

    #[test]
    fn mailto_parses_address_and_fields() {
        let d = parse_mailto("mailto:a@x.com?subject=Hello%20there&body=Line%201%0D%0Aa%26b&cc=c@x.com");
        assert_eq!(d.to, "a@x.com");
        assert_eq!(d.subject, "Hello there");
        assert_eq!(d.body, "Line 1\r\na&b");
        assert_eq!(d.cc, "c@x.com");
        assert_eq!(d.bcc, "");
    }

    #[test]
    fn mailto_keeps_plus_literal() {
        assert_eq!(parse_mailto("mailto:a+tag@x.com?subject=1+1").subject, "1+1");
        assert_eq!(parse_mailto("mailto:a+tag@x.com").to, "a+tag@x.com");
    }

    #[test]
    fn mailto_joins_repeated_recipient_fields() {
        let d = parse_mailto("mailto:a@x.com?to=b@x.com&cc=c@x.com&cc=d@x.com&bcc=e@x.com&BCC=f@x.com");
        assert_eq!(d.to, "a@x.com, b@x.com");
        assert_eq!(d.cc, "c@x.com, d@x.com");
        assert_eq!(d.bcc, "e@x.com, f@x.com");
    }

    #[test]
    fn mailto_scheme_is_case_insensitive() {
        assert_eq!(parse_mailto("MAILTO:a@x.com").to, "a@x.com");
        assert!(is_mailto("MailTo:a@x.com"));
        assert!(!is_mailto("https://x.com"));
        assert!(!is_mailto("mail"));
    }

    #[test]
    fn mailto_invalid_utf8_escape_does_not_drop_the_field() {
        let d = parse_mailto("mailto:a@x.com?subject=caf%E9%20menu");
        assert!(d.subject.starts_with("caf"), "subject was {:?}", d.subject);
        assert!(d.subject.ends_with(" menu"), "subject was {:?}", d.subject);
    }

    #[test]
    fn capabilities_allow_window_calls_made_by_the_frontend() {
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let perms: Vec<&str> = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        // App.tsx calls getCurrentWindow().startDragging() and .setBadgeCount();
        // core:default grants neither
        assert!(perms.contains(&"core:window:allow-start-dragging"));
        assert!(perms.contains(&"core:window:allow-set-badge-count"));
    }
}
