// The Mac's sleep and wake, told to the frontend so the mail that came in
// the meantime gets one note per card, posted here through
// UNUserNotificationCenter with the card as its thread so Notification
// Centre groups them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Woke {
    pub slept_at: i64,
    pub woke_at: i64,
}

/// When the Mac last went to sleep, until it wakes
#[derive(Debug, Default)]
pub struct SleepClock {
    slept_at: Option<i64>,
}

impl SleepClock {
    pub fn slept(&mut self, at: i64) {
        self.slept_at = Some(at);
    }

    pub fn woke(&mut self, at: i64) -> Option<Woke> {
        self.slept_at.take().map(|slept_at| Woke { slept_at, woke_at: at })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CardNote {
    pub card_id: String,
    pub title: String,
    pub body: String,
}

/// UNUserNotificationCenter throws, ending the process, unless it runs in an
/// app bundle with an identifier; `tauri dev` runs the bare binary
pub fn can_notify(bundle_path: &str, bundle_id: Option<&str>) -> bool {
    bundle_path.ends_with(".app") && bundle_id.is_some_and(|id| !id.is_empty())
}

#[cfg(target_os = "macos")]
pub use native::{install, post};

#[cfg(target_os = "macos")]
mod native {
    use super::{can_notify, CardNote, SleepClock};
    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread};
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification};
    use objc2_foundation::{NSBundle, NSError, NSNotification, NSNotificationName, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };
    use std::ptr::NonNull;
    use std::sync::{Mutex, OnceLock};
    use tauri::Emitter;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static CLOCK: Mutex<SleepClock> = Mutex::new(SleepClock { slept_at: None });

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "PostaNotificationDelegate"]
        struct NotificationDelegate;

        unsafe impl NSObjectProtocol for NotificationDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
            // Shown even while Posta is in front, as it may be right after waking
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion_handler.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,));
            }

            // A note's thread is its card
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion_handler: &DynBlock<dyn Fn()>,
            ) {
                let card_id = response.notification().request().content().threadIdentifier().to_string();
                if let Some(app) = APP.get() {
                    if !card_id.is_empty() {
                        crate::show_card(app, &card_id);
                    }
                }
                completion_handler.call(());
            }
        }
    );

    fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    fn notifications_available() -> bool {
        let bundle = NSBundle::mainBundle();
        let id = bundle.bundleIdentifier().map(|id| id.to_string());
        can_notify(&bundle.bundlePath().to_string(), id.as_deref())
    }

    fn observe(name: &NSNotificationName, on_notification: impl Fn() + 'static) {
        let block = RcBlock::new(move |_: NonNull<NSNotification>| on_notification());
        // SAFETY: the block takes the notification as declared, and with no
        // queue it runs on the thread that posts, which is the main thread
        // for NSWorkspace's sleep and wake
        let observer = unsafe {
            NSWorkspace::sharedWorkspace()
                .notificationCenter()
                .addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
        };
        // Observed for as long as the app runs
        std::mem::forget(observer);
    }

    /// Watches the Mac sleep and wake, and routes clicks on notes to their
    /// card. Call once at launch.
    pub fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        observe(
            // SAFETY: an AppKit constant, valid for the life of the process
            unsafe { NSWorkspaceWillSleepNotification },
            || CLOCK.lock().unwrap_or_else(|e| e.into_inner()).slept(now_ms()),
        );
        observe(unsafe { NSWorkspaceDidWakeNotification }, || {
            let woke = CLOCK.lock().unwrap_or_else(|e| e.into_inner()).woke(now_ms());
            if let (Some(app), Some(woke)) = (APP.get(), woke) {
                let _ = app.emit("system-woke", woke);
            }
        });
        if notifications_available() {
            // SAFETY: NSObject's init on a freshly allocated subclass with no
            // instance variables
            let delegate: Retained<NotificationDelegate> = unsafe { msg_send![NotificationDelegate::alloc(), init] };
            UNUserNotificationCenter::currentNotificationCenter().setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            // The center holds its delegate weakly; this one lives as long as the app
            std::mem::forget(delegate);
        }
    }

    /// Asks for permission the first time, then posts each note under its
    /// card. Outside an app bundle (`tauri dev`) there's nowhere to post.
    pub fn post(notes: Vec<CardNote>) {
        if notes.is_empty() || !notifications_available() {
            return;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
        let handler = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            if !granted.as_bool() {
                return;
            }
            let center = UNUserNotificationCenter::currentNotificationCenter();
            let stamp = now_ms();
            for note in &notes {
                let content = UNMutableNotificationContent::new();
                content.setTitle(&NSString::from_str(&note.title));
                content.setBody(&NSString::from_str(&note.body));
                content.setThreadIdentifier(&NSString::from_str(&note.card_id));
                content.setSound(Some(&UNNotificationSound::defaultSound()));
                let id = NSString::from_str(&format!("wake-{}-{}", note.card_id, stamp));
                let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
                center.addNotificationRequest_withCompletionHandler(&request, None);
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(options, &handler);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wake_says_when_the_mac_went_to_sleep() {
        let mut clock = SleepClock::default();
        clock.slept(1_000);
        assert_eq!(clock.woke(9_000), Some(Woke { slept_at: 1_000, woke_at: 9_000 }));
    }

    #[test]
    fn a_wake_without_a_sleep_before_it_says_nothing() {
        let mut clock = SleepClock::default();
        assert_eq!(clock.woke(9_000), None);
        clock.slept(1_000);
        clock.woke(9_000);
        assert_eq!(clock.woke(10_000), None, "each sleep is told once");
    }

    #[test]
    fn notifies_only_from_an_identified_app_bundle() {
        assert!(can_notify("/Applications/Posta.app", Some("com.sryo.posta")));
        assert!(!can_notify("/Users/me/posta/src-tauri/target/debug", None));
        assert!(!can_notify("/Users/me/posta/src-tauri/target/debug", Some("com.sryo.posta")));
        assert!(!can_notify("/Applications/Posta.app", None));
    }
}
