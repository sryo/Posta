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

/// The NSUbiquitousKeyValueStore calls the sync relies on
trait KvBackend: Send + Sync {
    fn set_string(&self, key: &str, value: &str);
    fn string(&self, key: &str) -> Option<String>;
    fn synchronize(&self) -> bool;
}

struct UbiquitousStore(Retained<AnyObject>);

// SAFETY: NSUbiquitousKeyValueStore is thread-safe according to Apple's documentation
// All methods are safe to call from any thread
unsafe impl Send for UbiquitousStore {}
unsafe impl Sync for UbiquitousStore {}

impl KvBackend for UbiquitousStore {
    fn set_string(&self, key: &str, value: &str) {
        let key = NSString::from_str(key);
        let value = NSString::from_str(value);
        unsafe {
            let _: () = msg_send![&*self.0, setString: &*value, forKey: &*key];
        }
    }

    fn string(&self, key: &str) -> Option<String> {
        let key = NSString::from_str(key);
        let value: Option<Retained<NSString>> = unsafe { msg_send![&*self.0, stringForKey: &*key] };
        value.map(|s| s.to_string())
    }

    fn synchronize(&self) -> bool {
        unsafe { msg_send![&*self.0, synchronize] }
    }
}

pub struct ICloudKVStore {
    backend: Box<dyn KvBackend>,
}

impl ICloudKVStore {
    pub fn new() -> Self {
        let store: Retained<AnyObject> = unsafe { msg_send![class!(NSUbiquitousKeyValueStore), defaultStore] };
        Self { backend: Box::new(UbiquitousStore(store)) }
    }

    /// Errors unless the value reached the local store: callers record a
    /// successful write as synced
    fn set_json<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.backend.set_string(key, &json);
        // NO when the app lacks the iCloud entitlement or the store can't be written
        if !self.backend.synchronize() {
            return Err("iCloud key-value store is unavailable".to_string());
        }
        if self.backend.string(key).as_deref() != Some(json.as_str()) {
            return Err("iCloud key-value store did not keep the written value".to_string());
        }
        Ok(())
    }

    fn get_json<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        let Some(json) = self.backend.string(key) else {
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
        let synced = self.backend.synchronize();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// In-memory store; `accepts` false models a store that refuses writes
    /// (synchronize returns NO), `keeps` false one that drops them
    struct FakeStore {
        values: Mutex<HashMap<String, String>>,
        accepts: bool,
        keeps: bool,
    }

    impl KvBackend for FakeStore {
        fn set_string(&self, key: &str, value: &str) {
            if self.keeps {
                self.values.lock().unwrap().insert(key.to_string(), value.to_string());
            }
        }

        fn string(&self, key: &str) -> Option<String> {
            self.values.lock().unwrap().get(key).cloned()
        }

        fn synchronize(&self) -> bool {
            self.accepts
        }
    }

    fn store(accepts: bool, keeps: bool) -> ICloudKVStore {
        ICloudKVStore {
            backend: Box::new(FakeStore { values: Mutex::new(HashMap::new()), accepts, keeps }),
        }
    }

    fn cards() -> Vec<Card> {
        vec![Card::new("a1".into(), "Inbox".into(), "in:inbox".into(), 0)]
    }

    #[test]
    fn written_cards_read_back() {
        let store = store(true, true);
        let cards = cards();
        store.sync_cards(&cards).unwrap();
        assert_eq!(store.load_cards().unwrap(), Some(cards));
    }

    #[test]
    fn write_the_store_refuses_is_an_error() {
        let err = store(false, true).sync_cards(&cards()).unwrap_err();
        assert!(err.contains("unavailable"), "{}", err);
        assert!(store(false, true).sync_account_mappings(&HashMap::new()).is_err());
    }

    #[test]
    fn write_the_store_drops_is_an_error() {
        let store = store(true, false);
        assert!(store.sync_cards(&cards()).is_err());
        assert!(store.sync_account_mappings(&HashMap::from([("a1".into(), "me@x.com".into())])).is_err());
    }
}
