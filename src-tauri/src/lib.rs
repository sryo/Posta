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
use tauri::{Emitter, Listener, Manager, RunEvent, WindowEvent};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::new())
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
                                let mailto_data = parse_mailto(&url);
                                tracing::info!("Received mailto: to={}", mailto_data.to);

                                // Emit to frontend
                                let _ = handle.emit("mailto-received", mailto_data);

                                // Show and focus the window
                                if let Some(window) = handle.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_app,
            commands::configure_auth,
            commands::get_stored_credentials,
            commands::start_oauth_flow,
            commands::complete_oauth_flow,
            commands::run_oauth_flow,
            commands::get_accounts,
            commands::delete_account,
            commands::get_cards,
            commands::create_card,
            commands::update_card,
            commands::delete_card,
            commands::reorder_cards,
            commands::fetch_threads,
            commands::fetch_threads_paginated,
            commands::sync_threads_incremental,
            commands::search_threads_preview,
            commands::modify_threads,
            commands::get_thread_details,
            commands::send_email,
            commands::reply_to_thread,
            commands::get_cached_card_threads,
            commands::save_cached_card_threads,
            commands::get_cached_card_events,
            commands::save_cached_card_events,
            commands::clear_card_cache,
            commands::download_attachment,
            commands::open_attachment,
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
