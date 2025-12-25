// iOS iCloud Key-Value Store wrapper

use crate::models::Card;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::NSString;
use std::collections::HashMap;

// Define a wrapper type that we can make Send + Sync
pub struct ICloudKVStore {
    // We store the store as a raw pointer to make the struct Send + Sync
    // All access must be done on the main thread
    store_ptr: *mut AnyObject,
}

// SAFETY: NSUbiquitousKeyValueStore is thread-safe according to Apple's documentation
// All methods are safe to call from any thread
unsafe impl Send for ICloudKVStore {}
unsafe impl Sync for ICloudKVStore {}

impl ICloudKVStore {
    pub fn new() -> Self {
        unsafe {
            let cls = class!(NSUbiquitousKeyValueStore);
            let store: Retained<AnyObject> = msg_send![cls, defaultStore];
            // Convert to raw pointer and leak the Retained to prevent deallocation
            let store_ptr = Retained::into_raw(store);
            Self { store_ptr }
        }
    }

    pub fn sync_cards(&self, cards: &[Card]) -> Result<(), String> {
        let json = serde_json::to_string(cards).map_err(|e| e.to_string())?;
        let key = NSString::from_str("posta_cards");
        let value = NSString::from_str(&json);

        unsafe {
            let _: () = msg_send![self.store_ptr, setString: &*value, forKey: &*key];
            let _: bool = msg_send![self.store_ptr, synchronize];
        }
        Ok(())
    }

    pub fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
        let key = NSString::from_str("posta_cards");

        unsafe {
            let value: Option<Retained<NSString>> = msg_send![self.store_ptr, stringForKey: &*key];

            match value {
                Some(s) => {
                    let json = s.to_string();
                    if json.is_empty() {
                        return Ok(None);
                    }
                    let cards: Vec<Card> =
                        serde_json::from_str(&json).map_err(|e| e.to_string())?;
                    Ok(Some(cards))
                }
                None => Ok(None),
            }
        }
    }

    /// Sync account mappings (account_id -> email) to iCloud
    pub fn sync_account_mappings(&self, mappings: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string(mappings).map_err(|e| e.to_string())?;
        let key = NSString::from_str("posta_account_mappings");
        let value = NSString::from_str(&json);

        unsafe {
            let _: () = msg_send![self.store_ptr, setString: &*value, forKey: &*key];
            let _: bool = msg_send![self.store_ptr, synchronize];
        }
        Ok(())
    }

    /// Load account mappings (account_id -> email) from iCloud
    pub fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String> {
        let key = NSString::from_str("posta_account_mappings");

        unsafe {
            let value: Option<Retained<NSString>> = msg_send![self.store_ptr, stringForKey: &*key];

            match value {
                Some(s) => {
                    let json = s.to_string();
                    if json.is_empty() {
                        return Ok(None);
                    }
                    let mappings: HashMap<String, String> =
                        serde_json::from_str(&json).map_err(|e| e.to_string())?;
                    Ok(Some(mappings))
                }
                None => Ok(None),
            }
        }
    }
}

impl Default for ICloudKVStore {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ICloudKVStore {
    fn drop(&mut self) {
        unsafe {
            // Reconstruct the Retained and let it drop properly
            let _ = Retained::from_raw(self.store_ptr);
        }
    }
}
