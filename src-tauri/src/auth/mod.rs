// Authentication module

pub mod callback;
pub mod oauth2;

pub use callback::wait_for_callback;
pub use oauth2::{
    delete_refresh_token, get_oauth_credentials, get_refresh_token,
    store_oauth_credentials, store_refresh_token, AuthError, GmailAuth,
};
