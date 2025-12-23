// iCloud sync for cards via NSUbiquitousKeyValueStore

use crate::models::Card;
use std::collections::HashMap;

#[cfg(target_os = "ios")]
mod kvstore;

#[cfg(target_os = "ios")]
pub use kvstore::ICloudKVStore;

// No-op stub for non-iOS platforms
#[cfg(not(target_os = "ios"))]
pub struct ICloudKVStore;

#[cfg(not(target_os = "ios"))]
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
