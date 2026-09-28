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

use std::collections::{HashMap, HashSet};

/// Whether local cards absent from the iCloud value may be deleted as removed
/// on another device. `base` is this device's record of synced cards (card id
/// -> account id). A value that shares none of those cards did not come from
/// them: iCloud discards writes made before a Mac's first download and swaps
/// the whole store when the Apple ID changes, and deleting against such a
/// value would wipe cards that never reached iCloud.
pub fn deletions_trusted(icloud_ids: &HashSet<String>, base: &HashMap<String, String>) -> bool {
    base.keys().any(|id| icloud_ids.contains(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn base(list: &[&str]) -> HashMap<String, String> {
        list.iter().map(|s| (s.to_string(), "a1".to_string())).collect()
    }

    #[test]
    fn deletions_are_trusted_when_icloud_still_has_a_synced_card() {
        assert!(deletions_trusted(&ids(&["keep"]), &base(&["keep", "gone"])));
    }

    #[test]
    fn value_unrelated_to_the_synced_cards_deletes_nothing() {
        // New Mac whose pushes were dropped: iCloud still holds the old layout
        assert!(!deletions_trusted(&ids(&["old-1", "old-2"]), &base(&["new-1", "new-2"])));
        assert!(!deletions_trusted(&ids(&[]), &base(&["new-1"])));
    }
}
