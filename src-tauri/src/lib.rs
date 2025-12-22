// Gmail client - Posta

pub mod auth;
pub mod cache;
pub mod commands;
pub mod gmail;
pub mod models;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    tauri::Builder::default()
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
            commands::list_labels,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
