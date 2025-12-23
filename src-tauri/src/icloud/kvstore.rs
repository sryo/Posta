// iOS iCloud Key-Value Store wrapper

use crate::models::Card;
use objc2::rc::Retained;
use objc2::runtime::AnyClass;
use objc2::{class, msg_send, msg_send_id};
use objc2_foundation::NSString;

pub struct ICloudKVStore {
    store: Retained<objc2::runtime::AnyObject>,
}

impl ICloudKVStore {
    pub fn new() -> Self {
        unsafe {
            let cls = class!(NSUbiquitousKeyValueStore);
            let store: Retained<objc2::runtime::AnyObject> = msg_send_id![cls, defaultStore];
            Self { store }
        }
    }

    pub fn sync_cards(&self, cards: &[Card]) -> Result<(), String> {
        let json = serde_json::to_string(cards).map_err(|e| e.to_string())?;
        let key = NSString::from_str("posta_cards");
        let value = NSString::from_str(&json);

        unsafe {
            let _: () = msg_send![&*self.store, setString:&*value forKey:&*key];
            let _: bool = msg_send![&*self.store, synchronize];
        }
        Ok(())
    }

    pub fn load_cards(&self) -> Result<Option<Vec<Card>>, String> {
        let key = NSString::from_str("posta_cards");

        unsafe {
            let value: Option<Retained<NSString>> = msg_send_id![&*self.store, stringForKey:&*key];

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
}
