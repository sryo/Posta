// Gmail client - Posta

pub mod auth;
pub mod cache;
pub mod commands;
pub mod gmail;
pub mod icloud;
pub mod models;

use commands::AppState;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
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
            commands::fetch_threads,
            commands::fetch_threads_paginated,
            commands::search_threads_preview,
            commands::modify_threads,
            commands::get_thread_details,
            commands::send_email,
            commands::reply_to_thread,
            commands::get_cached_card_threads,
            commands::save_cached_card_threads,
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
            RunEvent::Reopen { .. } => {
                // Show the main window when clicking the dock icon
                #[cfg(target_os = "macos")]
                {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            _ => {}
        }
    });
}
