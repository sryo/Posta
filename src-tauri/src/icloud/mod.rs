// iCloud sync for cards via NSUbiquitousKeyValueStore

use crate::models::Card;
use std::collections::HashMap;

#[cfg(any(target_os = "ios", target_os = "macos"))]
mod kvstore;

#[cfg(any(target_os = "ios", target_os = "macos"))]
pub use kvstore::ICloudKVStore;

// No-op stub for non-Apple platforms
#[cfg(not(any(target_os = "ios", target_os = "macos")))]
pub struct ICloudKVStore;

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
impl ICloudKVStore {
    pub fn new() -> Self {
        Self
    }

    pub fn sync_cards(&self, _cards: &[Card]) -> Result<(), String> {
        // No-op on non-iOS
        Ok(())
    }

    pub fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
        // No-op on non-iOS
        Ok(None)
    }

    pub fn sync_account_mappings(&self, _mappings: &HashMap<String, String>) -> Result<(), String> {
        // No-op on non-iOS
        Ok(())
    }

    pub fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String> {
        // No-op on non-iOS
        Ok(None)
    }
}
