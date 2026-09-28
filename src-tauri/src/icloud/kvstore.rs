// iOS iCloud Key-Value Store wrapper

use crate::models::Card;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::NSString;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;

const CARDS_KEY: &str = "posta_cards";
const ACCOUNT_MAPPINGS_KEY: &str = "posta_account_mappings";

pub struct ICloudKVStore {
    // Owned +1 reference to the shared NSUbiquitousKeyValueStore, released in Drop
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
            Self {
                store_ptr: Retained::into_raw(store),
            }
        }
    }

    fn synchronize(&self) -> bool {
        unsafe { msg_send![self.store_ptr, synchronize] }
    }

    fn set_json<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        let key = NSString::from_str(key);
        let value = NSString::from_str(&json);
        unsafe {
            let _: () = msg_send![self.store_ptr, setString: &*value, forKey: &*key];
        }
        self.synchronize();
        Ok(())
    }

    fn get_json<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        let key = NSString::from_str(key);
        let value: Option<Retained<NSString>> =
            unsafe { msg_send![self.store_ptr, stringForKey: &*key] };
        let Some(json) = value.map(|s| s.to_string()) else {
            return Ok(None);
        };
        if json.is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&json).map(Some).map_err(|e| e.to_string())
    }

    pub fn sync_cards(&self, cards: &[Card]) -> Result<(), String> {
        self.set_json(CARDS_KEY, cards)
    }

    pub fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
        // Pull the latest values from iCloud before reading
        let synced = self.synchronize();
        tracing::info!("iCloud synchronize result: {}", synced);

        let cards: Option<Vec<Card>> = self.get_json(CARDS_KEY).map_err(|e| {
            tracing::error!("iCloud load_cards parse error: {}", e);
            e
        })?;
        tracing::info!("iCloud load_cards: {} cards", cards.as_ref().map_or(0, Vec::len));
        Ok(cards)
    }

    /// Sync account mappings (account_id -> email) to iCloud
    pub fn sync_account_mappings(&self, mappings: &HashMap<String, String>) -> Result<(), String> {
        self.set_json(ACCOUNT_MAPPINGS_KEY, mappings)
    }

    /// Load account mappings (account_id -> email) from iCloud
    pub fn load_account_mappings(&self) -> Result<Option<HashMap<String, String>>, String> {
        self.get_json(ACCOUNT_MAPPINGS_KEY)
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
            let _ = Retained::from_raw(self.store_ptr);
        }
    }
}
