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
use tauri::{Emitter, Listener, Manager, RunEvent, WindowEvent};
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

/// Parse a mailto: URL into structured data
fn parse_mailto(url: &str) -> MailtoData {
    let mut data = MailtoData {
        to: String::new(),
        cc: String::new(),
        bcc: String::new(),
        subject: String::new(),
        body: String::new(),
    };

    // Remove "mailto:" prefix
    let url = url.strip_prefix("mailto:").unwrap_or(url);

    // Split by ? to get the email and query params
    let (email_part, query_part) = match url.split_once('?') {
        Some((e, q)) => (e, Some(q)),
        None => (url, None),
    };

    // URL-decode the email part
    data.to = urlencoding::decode(email_part).unwrap_or_default().to_string();

    // Parse query parameters
    if let Some(query) = query_part {
        for param in query.split('&') {
            if let Some((key, value)) = param.split_once('=') {
                let decoded = urlencoding::decode(value).unwrap_or_default().to_string();
                match key.to_lowercase().as_str() {
                    "to" => {
                        if !data.to.is_empty() {
                            data.to.push_str(", ");
                        }
                        data.to.push_str(&decoded);
                    }
                    "cc" => data.cc = decoded,
                    "bcc" => data.bcc = decoded,
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
                            if url.starts_with("mailto:") {
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
                            if url.as_str().starts_with("mailto:") {
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
            commands::force_icloud_sync,
            commands::fetch_contacts,
            commands::search_contacts,
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

    app.run(|app_handle, event| {
        match event {
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { api, .. },
                label,
                ..
            } => {
                // On macOS, hide the window instead of closing it
                #[cfg(target_os = "macos")]
                {
                    if let Some(window) = app_handle.get_webview_window(&label) {
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
            }
            RunEvent::ExitRequested { api, .. } => {
                // Prevent the app from exiting when all windows are closed
                #[cfg(target_os = "macos")]
                api.prevent_exit();
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                // Show the main window when clicking the dock icon
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    });
}
