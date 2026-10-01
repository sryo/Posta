// Gmail client - Posta

pub mod auth;
pub mod cache;
pub mod calendar;
pub mod commands;
mod dock_menu;
mod haptics;
mod wake;
pub mod gmail;
pub mod icloud;
pub mod models;
pub mod people;
pub mod ai;
pub mod unsubscribe;
pub mod unified;

use commands::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::{RunEvent, WindowEvent};
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

/// Mailto URLs received while the webview has no "mailto-received" listener
/// yet (cold start, or a reload). The frontend drains them with
/// `take_pending_mailtos` right after it starts listening.
#[derive(Default)]
struct PendingMailto(Mutex<PendingMailtoInner>);

#[derive(Default)]
struct PendingMailtoInner {
    listening: bool,
    urls: Vec<String>,
}

impl PendingMailtoInner {
    /// Buffer the URL unless the frontend is listening; true if buffered
    fn offer(&mut self, url: &str) -> bool {
        if self.listening {
            return false;
        }
        if !self.urls.iter().any(|u| u == url) {
            self.urls.push(url.to_string());
        }
        true
    }

    fn drain(&mut self) -> Vec<MailtoData> {
        self.listening = true;
        std::mem::take(&mut self.urls).iter().map(|u| parse_mailto(u)).collect()
    }

    fn reset(&mut self) {
        self.listening = false;
    }
}

fn pending_mailtos(handle: &tauri::AppHandle) -> std::sync::MutexGuard<'_, PendingMailtoInner> {
    handle.state::<PendingMailto>().inner().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Emit a mailto URL to the frontend, or buffer it until the frontend listens
fn deliver_mailto(handle: &tauri::AppHandle, url: &str) {
    if !pending_mailtos(handle).offer(url) {
        let mailto_data = parse_mailto(url);
        tracing::info!("Received mailto: to={}", mailto_data.to);
        let _ = handle.emit("mailto-received", mailto_data);
    }

    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Called by the frontend once its "mailto-received" listener is registered:
/// returns the links that arrived before, and sends later ones as events
#[tauri::command]
fn take_pending_mailtos(app_handle: tauri::AppHandle) -> Vec<MailtoData> {
    pending_mailtos(&app_handle).drain()
}

/// Shows `png` as the Dock icon while the app runs, or the bundled icon again
/// when it is None. Finder and Launchpad keep the bundled icon either way.
#[tauri::command]
fn set_dock_icon(app_handle: tauri::AppHandle, png: Option<Vec<u8>>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app_handle
            .run_on_main_thread(move || dock_icon::set(png.as_deref()))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_handle, png);
        Ok(())
    }
}

/// What the right-click Dock menu lists until the board next changes
#[tauri::command]
fn set_dock_menu(menu: dock_menu::DockMenu) {
    dock_menu::set(menu);
}

/// Trackpad feedback while a card is dragged: "alignment" or "levelChange"
#[tauri::command]
fn haptic(app_handle: tauri::AppHandle, kind: String) -> Result<(), String> {
    let haptic = haptics::Haptic::parse(&kind).ok_or_else(|| format!("Unknown haptic {kind}"))?;
    #[cfg(target_os = "macos")]
    {
        app_handle
            .run_on_main_thread(move || haptics::perform(haptic))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_handle, haptic);
        Ok(())
    }
}

/// One notification per card for the mail that came while the Mac slept,
/// grouped under the card in Notification Centre
#[tauri::command]
fn post_card_notes(notes: Vec<wake::CardNote>) {
    #[cfg(target_os = "macos")]
    wake::post(notes);
    #[cfg(not(target_os = "macos"))]
    let _ = notes;
}

/// Brings the window forward with `card_id` focused, for a card chosen
/// outside it (the Dock menu, a notification)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn show_card(handle: &tauri::AppHandle, card_id: &str) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = handle.emit("focus-card", card_id);
}

#[cfg(target_os = "macos")]
mod dock_icon {
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    /// Must run on the main thread, which owns NSApplication
    pub fn set(png: Option<&[u8]>) {
        unsafe {
            let image: Option<Retained<AnyObject>> = png.and_then(|bytes| {
                let data: Retained<AnyObject> = msg_send![
                    class!(NSData),
                    dataWithBytes: bytes.as_ptr().cast::<std::ffi::c_void>(),
                    length: bytes.len()
                ];
                let image: Allocated<AnyObject> = msg_send![class!(NSImage), alloc];
                msg_send![image, initWithData: &*data]
            });
            let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![&*app, setApplicationIconImage: image.as_deref()];
        }
    }
}

/// `RUST_LOG`'s directives, or warnings and errors when it is unset or
/// empty; tracing's own default drops warnings such as a failed iCloud write
fn log_filter(rust_log: Option<&str>) -> tracing_subscriber::EnvFilter {
    match rust_log.map(str::trim) {
        Some(directives) if !directives.is_empty() => tracing_subscriber::EnvFilter::new(directives),
        _ => tracing_subscriber::EnvFilter::new("warn"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(log_filter(std::env::var("RUST_LOG").ok().as_deref()))
        .init();

    let builder = tauri::Builder::default();
    // Must be registered first: a second launch (e.g. clicking a mailto: link
    // while Posta runs on Windows/Linux) would otherwise open the same
    // database and OAuth port from another process
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::new())
        .manage(PendingMailto::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                dock_menu::install(app.handle());
                wake::install(app.handle());
            }
            // Handle deep links (mailto:)
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if is_mailto(url.as_str()) {
                            deliver_mailto(&handle, url.as_str());
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
            // A reloaded page has lost its listener until it drains again
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                pending_mailtos(webview.app_handle()).reset();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_app,
            commands::configure_auth,
            commands::get_stored_credentials,
            commands::run_oauth_flow,
            commands::cancel_oauth_flow,
            commands::reopen_oauth_page,
            commands::get_accounts,
            commands::delete_account,
            commands::update_account_signature,
            commands::get_cards,
            commands::create_card,
            commands::update_card,
            commands::delete_card,
            commands::reorder_cards,
            commands::fetch_threads_paginated,
            commands::fetch_query_threads,
            commands::sync_threads_incremental,
            commands::search_threads_preview,
            commands::modify_threads,
            commands::get_thread_details,
            commands::send_email,
            commands::reply_to_thread,
            commands::send_reaction,
            commands::unsubscribe_one_click,
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
            commands::list_thread_drafts,
            commands::rsvp_calendar_event,
            commands::rsvp_listed_calendar_event,
            commands::get_calendar_rsvp_status,
            commands::pull_from_icloud,
            commands::get_icloud_sync_status,
            commands::fetch_contacts,
            commands::list_calendars,
            commands::fetch_calendar_events,
            commands::create_calendar_event,
            commands::move_calendar_event,
            commands::delete_calendar_event,
            commands::update_calendar_event,
            commands::suggest_replies,
            commands::set_gemini_api_key,
            commands::has_gemini_api_key,
            take_pending_mailtos,
            set_dock_icon,
            set_dock_menu,
            haptic,
            post_card_notes,
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
    use super::{is_mailto, parse_mailto, PendingMailtoInner};

    #[test]
    fn warnings_are_logged_unless_rust_log_says_otherwise() {
        use tracing_subscriber::filter::LevelFilter;
        assert_eq!(super::log_filter(None).max_level_hint(), Some(LevelFilter::WARN));
        assert_eq!(super::log_filter(Some("")).max_level_hint(), Some(LevelFilter::WARN));
        assert_eq!(super::log_filter(Some("debug")).max_level_hint(), Some(LevelFilter::DEBUG));
    }

    #[test]
    fn mailtos_are_buffered_until_the_frontend_drains_them() {
        let mut pending = PendingMailtoInner::default();
        assert!(pending.offer("mailto:a@x.com"));
        assert!(pending.offer("mailto:b@x.com"));
        // macOS can hand over the launch URL both as the current link and as an event
        assert!(pending.offer("mailto:a@x.com"));
        let drained: Vec<String> = pending.drain().into_iter().map(|d| d.to).collect();
        assert_eq!(drained, vec!["a@x.com", "b@x.com"]);
        assert!(!pending.offer("mailto:c@x.com"), "links after the drain go straight to the listener");
        assert!(pending.drain().is_empty());
    }

    #[test]
    fn a_reloaded_frontend_gets_links_that_arrive_before_it_listens() {
        let mut pending = PendingMailtoInner::default();
        pending.drain();
        pending.reset();
        assert!(pending.offer("mailto:a@x.com"));
        assert_eq!(pending.drain().len(), 1);
    }

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
        // App.tsx calls getCurrentWindow().startDragging(), .setBadgeCount()
        // and .setTitle(); core:default grants none of them
        assert!(perms.contains(&"core:window:allow-start-dragging"));
        assert!(perms.contains(&"core:window:allow-set-badge-count"));
        assert!(perms.contains(&"core:window:allow-set-title"));
    }

    /// The `<string>` value that follows `<key>{key}</key>` in a plist
    fn plist_string<'a>(plist: &'a str, key: &str) -> Option<&'a str> {
        let after_key = plist.split_once(&format!("<key>{}</key>", key))?.1;
        let value = after_key.trim_start().strip_prefix("<string>")?;
        value.split_once("</string>").map(|(v, _)| v.trim())
    }

    #[test]
    fn macos_signing_config_grants_the_icloud_store_to_this_app() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let entitlements = include_str!("../Entitlements.plist");
        let macos = &conf["bundle"]["macOS"];

        assert_eq!(macos["entitlements"], "Entitlements.plist");
        assert_eq!(macos["files"]["embedded.provisionprofile"], "Posta.provisionprofile");

        let identity = macos["signingIdentity"].as_str().unwrap();
        let team = identity
            .rsplit_once('(')
            .and_then(|(_, rest)| rest.strip_suffix(')'))
            .expect("signing identity ends with (TEAMID)");
        let app_id = format!("{}.{}", team, conf["identifier"].as_str().unwrap());

        assert_eq!(plist_string(entitlements, "com.apple.developer.team-identifier"), Some(team));
        assert_eq!(plist_string(entitlements, "com.apple.application-identifier"), Some(app_id.as_str()));
        // Without this entitlement NSUbiquitousKeyValueStore silently keeps
        // everything local, and card sync never reaches other Macs
        assert_eq!(
            plist_string(entitlements, "com.apple.developer.ubiquity-kvstore-identifier"),
            Some(app_id.as_str())
        );
    }
}
