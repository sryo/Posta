// iCloud sync for cards via NSUbiquitousKeyValueStore

#[cfg(any(target_os = "ios", target_os = "macos"))]
mod kvstore;

#[cfg(any(target_os = "ios", target_os = "macos"))]
pub use kvstore::ICloudKVStore;

// No-op stub for non-Apple platforms
#[cfg(not(any(target_os = "ios", target_os = "macos")))]
mod stub {
    use crate::models::Card;
    use std::collections::HashMap;

    pub struct ICloudKVStore;

    impl ICloudKVStore {
        pub fn new() -> Self {
            Self
        }

        pub fn sync_cards(&self, _cards: &[Card]) -> Result<(), String> {
            Ok(())
        }

        pub fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
            Ok(None)
        }

        pub fn sync_account_mappings(&self, _mappings: &HashMap<String, String>) -> Result<(), String> {
            Ok(())
        }

        pub fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String> {
            Ok(None)
        }
    }
}

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
pub use stub::ICloudKVStore;
