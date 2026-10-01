// Posta's right-click Dock menu: the board's cards and its next event, as
// the frontend last described them. The titles arrive ready to show.

use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct DockMenu {
    pub cards: Vec<DockMenuCard>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DockMenuCard {
    pub id: String,
    pub title: String,
}

#[derive(Debug, PartialEq)]
pub enum Row<'a> {
    Card { id: &'a str, title: &'a str },
    Separator,
    Note(&'a str),
}

pub fn rows(menu: &DockMenu) -> Vec<Row<'_>> {
    let mut rows: Vec<Row> = menu
        .cards
        .iter()
        .map(|card| Row::Card { id: &card.id, title: &card.title })
        .collect();
    if let Some(next) = &menu.next {
        if !rows.is_empty() {
            rows.push(Row::Separator);
        }
        rows.push(Row::Note(next));
    }
    rows
}

/// The menu the Dock shows next, replaced whenever the board changes
static MENU: std::sync::Mutex<Option<DockMenu>> = std::sync::Mutex::new(None);

pub fn set(menu: DockMenu) {
    *MENU.lock().unwrap_or_else(|e| e.into_inner()) = Some(menu);
}

#[cfg(target_os = "macos")]
pub use native::install;

// AppKit asks the application delegate for a Dock menu with
// applicationDockMenu:. Tauri has no API for it and tao owns the delegate,
// so `install` adds that one method to the delegate's class at runtime.
#[cfg(target_os = "macos")]
mod native {
    use super::{rows, Row, MENU};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Imp, NSObject, Sel};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
    use objc2_foundation::NSString;
    use std::sync::OnceLock;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "PostaDockMenuTarget"]
        struct MenuTarget;

        impl MenuTarget {
            #[unsafe(method(chooseCard:))]
            fn choose_card(&self, item: &NSMenuItem) {
                let card_id = item.representedObject().and_then(|o| o.downcast::<NSString>().ok());
                if let (Some(app), Some(card_id)) = (APP.get(), card_id) {
                    crate::show_card(app, &card_id.to_string());
                }
            }
        }
    );

    thread_local! {
        // Menu items hold their target weakly
        static TARGET: Retained<MenuTarget> = {
            let mtm = MainThreadMarker::new().expect("the Dock menu is built on the main thread");
            unsafe { msg_send![MenuTarget::alloc(mtm), init] }
        };
    }

    fn build(mtm: MainThreadMarker) -> Retained<NSMenu> {
        let menu = NSMenu::new(mtm);
        menu.setAutoenablesItems(false);
        let model = MENU.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
        for row in rows(&model) {
            let item = match row {
                Row::Separator => NSMenuItem::separatorItem(mtm),
                Row::Card { id, title } => {
                    // SAFETY: chooseCard: is MenuTarget's method taking the
                    // item, and the target outlives the menu (thread-local)
                    unsafe {
                        let item = NSMenuItem::initWithTitle_action_keyEquivalent(
                            NSMenuItem::alloc(mtm),
                            &NSString::from_str(title),
                            Some(sel!(chooseCard:)),
                            &NSString::new(),
                        );
                        TARGET.with(|target| item.setTarget(Some(target)));
                        item.setRepresentedObject(Some(&NSString::from_str(id)));
                        item
                    }
                }
                Row::Note(text) => {
                    // SAFETY: no action, so nothing is ever sent
                    let item = unsafe {
                        NSMenuItem::initWithTitle_action_keyEquivalent(
                            NSMenuItem::alloc(mtm),
                            &NSString::from_str(text),
                            None,
                            &NSString::new(),
                        )
                    };
                    item.setEnabled(false);
                    item
                }
            };
            menu.addItem(&item);
        }
        menu
    }

    extern "C-unwind" fn application_dock_menu(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> *mut NSMenu {
        match MainThreadMarker::new() {
            Some(mtm) => Retained::autorelease_return(build(mtm)),
            None => std::ptr::null_mut(),
        }
    }

    /// Must run on the main thread, after tao has set the app delegate.
    /// Leaves the Dock menu alone when there's no delegate or it already
    /// answers applicationDockMenu:.
    pub fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        let Some(mtm) = MainThreadMarker::new() else {
            tracing::warn!("Dock menu not installed: not on the main thread");
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        let Some(delegate) = ns_app.delegate() else {
            tracing::warn!("Dock menu not installed: the app has no delegate");
            return;
        };
        let selector = sel!(applicationDockMenu:);
        let class = AsRef::<AnyObject>::as_ref(&*delegate).class();
        if class.responds_to(selector) {
            tracing::warn!("Dock menu not installed: {} already provides one", class.name().to_string_lossy());
            return;
        }
        let function: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut NSMenu = application_dock_menu;
        // SAFETY: the function matches the "@@:@" signature AppKit calls
        // applicationDockMenu: with (object self, selector, object sender,
        // returning an autoreleased NSMenu), and adding a method that the
        // class doesn't have changes nothing else about it
        let added = unsafe {
            objc2::ffi::class_addMethod(
                (class as *const objc2::runtime::AnyClass).cast_mut(),
                selector,
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut NSMenu, Imp>(function),
                c"@@:@".as_ptr(),
            )
        };
        if !added.as_bool() {
            tracing::warn!("Dock menu not installed: the delegate's class refused the method");
            return;
        }
        // Handed back so AppKit sees the method even if it noted what the
        // delegate answers when it was first set
        ns_app.setDelegate(Some(&delegate));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn menu(cards: &[(&str, &str)], next: Option<&str>) -> DockMenu {
        DockMenu {
            cards: cards
                .iter()
                .map(|(id, title)| DockMenuCard { id: id.to_string(), title: title.to_string() })
                .collect(),
            next: next.map(str::to_string),
        }
    }

    #[test]
    fn cards_come_first_then_the_next_event_under_a_separator() {
        let menu = menu(&[("i", "Inbox (7)"), ("r", "Receipts")], Some("Nothing else today"));
        assert_eq!(
            rows(&menu),
            vec![
                Row::Card { id: "i", title: "Inbox (7)" },
                Row::Card { id: "r", title: "Receipts" },
                Row::Separator,
                Row::Note("Nothing else today"),
            ]
        );
    }

    #[test]
    fn a_menu_without_an_event_line_or_cards_has_no_separator() {
        assert_eq!(rows(&menu(&[("i", "Inbox")], None)), vec![Row::Card { id: "i", title: "Inbox" }]);
        assert_eq!(rows(&menu(&[], Some("Nothing else today"))), vec![Row::Note("Nothing else today")]);
        assert!(rows(&DockMenu::default()).is_empty());
    }

    #[test]
    fn reads_the_model_the_frontend_sends() {
        let menu: DockMenu =
            serde_json::from_str(r#"{"cards":[{"id":"i","title":"Inbox (7)"}],"next":null}"#).unwrap();
        assert_eq!(rows(&menu), vec![Row::Card { id: "i", title: "Inbox (7)" }]);
    }
}
