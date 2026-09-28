// SQLite cache for offline access

use crate::models::{Account, Card};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Lock error")]
    Lock,
    #[error("This card no longer exists. It may have been deleted on another device.")]
    CardNotFound,
}

/// Cached thread groups, next page token, and cache time in Unix seconds
pub type CachedThreads = (Vec<crate::models::ThreadGroup>, Option<String>, i64);

pub struct CacheDb {
    conn: Mutex<Connection>,
}

impl CacheDb {
    pub fn new(db_path: &Path) -> Result<Self, CacheError> {
        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        db.run_column_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                picture TEXT
            );

            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                name TEXT NOT NULL,
                query TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                collapsed INTEGER NOT NULL DEFAULT 0
            );

            -- Never read by any release
            DROP TABLE IF EXISTS messages;
            DROP TABLE IF EXISTS threads;

            CREATE INDEX IF NOT EXISTS idx_cards_account ON cards(account_id);

            -- Card thread cache: stores thread data per card
            CREATE TABLE IF NOT EXISTS card_thread_cache (
                card_id TEXT NOT NULL,
                thread_data TEXT NOT NULL,
                next_page_token TEXT,
                cached_at INTEGER NOT NULL,
                PRIMARY KEY (card_id)
            );

            -- Sync state: stores history ID for incremental sync
            CREATE TABLE IF NOT EXISTS sync_state (
                account_id TEXT PRIMARY KEY,
                history_id TEXT NOT NULL
            );

            -- Card calendar cache: stores calendar event data per card
            CREATE TABLE IF NOT EXISTS card_calendar_cache (
                card_id TEXT NOT NULL,
                events_data TEXT NOT NULL,
                cached_at INTEGER NOT NULL,
                PRIMARY KEY (card_id)
            );
            "#,
        )?;
        Ok(())
    }

    fn run_column_migrations(&self) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        const COLUMNS: &[(&str, &str, &str)] = &[
            ("accounts", "picture", "TEXT"),
            ("accounts", "signature", "TEXT"),
            ("cards", "color", "TEXT"),
            ("cards", "group_by", "TEXT NOT NULL DEFAULT 'date'"),
            ("cards", "card_type", "TEXT NOT NULL DEFAULT 'email'"),
        ];
        for (table, column, decl) in COLUMNS {
            if !has_column(&conn, table, column)? {
                conn.execute(&format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl), [])?;
            }
        }
        // Written by older builds but never read
        if has_column(&conn, "sync_state", "last_sync_at")? {
            conn.execute("ALTER TABLE sync_state DROP COLUMN last_sync_at", [])?;
        }
        Ok(())
    }

    // Account operations

    pub fn get_accounts(&self) -> Result<Vec<Account>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare("SELECT id, email, picture, signature FROM accounts ORDER BY email")?;
        let rows = stmt.query_map([], account_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_account_by_email(&self, email: &str) -> Result<Option<Account>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT id, email, picture, signature FROM accounts WHERE email = ?1",
        )?;
        stmt.query_row(params![email], account_from_row)
            .optional()
            .map_err(Into::into)
    }

    /// Insert or update by id. Another id with the same email is an error:
    /// replacing that row would orphan its cards.
    pub fn insert_account(&self, account: &Account) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute(
            "INSERT INTO accounts (id, email, picture, signature) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET email = excluded.email, picture = excluded.picture, signature = excluded.signature",
            params![account.id, account.email, account.picture, account.signature],
        )?;
        Ok(())
    }

    pub fn update_account_signature(&self, account_id: &str, signature: Option<&str>) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute(
            "UPDATE accounts SET signature = ?1 WHERE id = ?2",
            params![signature, account_id],
        )?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), CacheError> {
        let mut conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let tx = conn.transaction()?;
        // Delete card caches before the cards rows they are keyed by
        tx.execute(
            "DELETE FROM card_thread_cache WHERE card_id IN (SELECT id FROM cards WHERE account_id = ?1)",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM card_calendar_cache WHERE card_id IN (SELECT id FROM cards WHERE account_id = ?1)",
            params![id],
        )?;
        tx.execute("DELETE FROM cards WHERE account_id = ?1", params![id])?;
        tx.execute("DELETE FROM sync_state WHERE account_id = ?1", params![id])?;
        tx.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    // Card operations

    pub fn get_cards(&self, account_id: &str) -> Result<Vec<Card>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(&format!("SELECT {CARD_COLUMNS} FROM cards WHERE account_id = ?1 ORDER BY position"))?;
        let rows = stmt.query_map(params![account_id], card_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_card(&self, account_id: &str, card_id: &str) -> Result<Option<Card>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(&format!("SELECT {CARD_COLUMNS} FROM cards WHERE account_id = ?1 AND id = ?2"))?;
        stmt.query_row(params![account_id, card_id], card_from_row)
            .optional()
            .map_err(Into::into)
    }

    pub fn card_exists(&self, card_id: &str) -> Result<bool, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.query_row("SELECT 1 FROM cards WHERE id = ?1", params![card_id], |_| Ok(()))
            .optional()
            .map(|row| row.is_some())
            .map_err(Into::into)
    }

    pub fn insert_card(&self, card: &Card) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        insert_card_row(&conn, card)
    }

    /// Save a card edit. The position is left alone: `reorder_cards` owns
    /// it, and the edited copy may predate a reorder.
    pub fn update_card(&self, card: &Card) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let updated = conn.execute(
            "UPDATE cards SET name = ?1, query = ?2, collapsed = ?3, color = ?4, group_by = ?5, card_type = ?6 WHERE id = ?7",
            params![card.name, card.query, card.collapsed as i32, card.color, card.group_by, card.card_type, card.id],
        )?;
        if updated == 0 {
            return Err(CacheError::CardNotFound);
        }
        Ok(())
    }

    pub fn delete_card(&self, id: &str) -> Result<(), CacheError> {
        let mut conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let tx = conn.transaction()?;
        delete_card_rows(&tx, id)?;
        tx.commit()?;
        Ok(())
    }

    /// All of the writes land, or none do
    pub fn apply_card_changes(&self, insert: &[Card], update: &[Card], delete: &[String]) -> Result<(), CacheError> {
        let mut conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let tx = conn.transaction()?;
        for card in insert {
            insert_card_row(&tx, card)?;
        }
        for card in update {
            update_card_row(&tx, card)?;
        }
        for id in delete {
            delete_card_rows(&tx, id)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn reorder_cards(&self, orders: &[(String, i32)]) -> Result<(), CacheError> {
        let mut conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let tx = conn.transaction()?;
        for (card_id, position) in orders {
            tx.execute(
                "UPDATE cards SET position = ?1 WHERE id = ?2",
                params![position, card_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Remove cached threads and events of cards that no longer exist. Caches
    /// of existing cards are kept however old: they are shown until the
    /// refresh replaces them.
    pub fn clear_orphaned_card_cache(&self) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let thread_count = conn.execute(
            "DELETE FROM card_thread_cache WHERE card_id NOT IN (SELECT id FROM cards)",
            [],
        )?;
        let calendar_count = conn.execute(
            "DELETE FROM card_calendar_cache WHERE card_id NOT IN (SELECT id FROM cards)",
            [],
        )?;
        Ok(thread_count + calendar_count)
    }

    // Card thread cache operations

    pub fn save_card_threads(
        &self,
        card_id: &str,
        threads: &[crate::models::ThreadGroup],
        next_page_token: Option<&str>,
    ) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let now = chrono::Utc::now().timestamp();
        let thread_data = serde_json::to_string(threads).unwrap_or_default();

        conn.execute(
            "INSERT OR REPLACE INTO card_thread_cache (card_id, thread_data, next_page_token, cached_at) VALUES (?1, ?2, ?3, ?4)",
            params![card_id, thread_data, next_page_token, now],
        )?;
        Ok(())
    }

    pub fn get_card_threads(
        &self,
        card_id: &str,
    ) -> Result<Option<CachedThreads>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT thread_data, next_page_token, cached_at FROM card_thread_cache WHERE card_id = ?1",
        )?;

        let row = stmt
            .query_row(params![card_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .optional()?;

        // Data written by an older build may no longer deserialize; treat it
        // as a miss so the caller refetches
        Ok(row.and_then(|(thread_data, next_page_token, cached_at)| {
            let threads = serde_json::from_str(&thread_data).ok()?;
            Some((threads, next_page_token, cached_at))
        }))
    }

    pub fn clear_card_cache(&self, card_id: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute("DELETE FROM card_thread_cache WHERE card_id = ?1", params![card_id])?;
        conn.execute("DELETE FROM card_calendar_cache WHERE card_id = ?1", params![card_id])?;
        Ok(())
    }

    // Card calendar cache operations

    pub fn save_card_events(
        &self,
        card_id: &str,
        events: &[crate::models::GoogleCalendarEvent],
    ) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let now = chrono::Utc::now().timestamp();
        let events_data = serde_json::to_string(events).unwrap_or_default();

        conn.execute(
            "INSERT OR REPLACE INTO card_calendar_cache (card_id, events_data, cached_at) VALUES (?1, ?2, ?3)",
            params![card_id, events_data, now],
        )?;
        Ok(())
    }

    pub fn get_card_events(
        &self,
        card_id: &str,
    ) -> Result<Option<(Vec<crate::models::GoogleCalendarEvent>, i64)>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT events_data, cached_at FROM card_calendar_cache WHERE card_id = ?1",
        )?;

        let row = stmt
            .query_row(params![card_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()?;

        Ok(row.and_then(|(events_data, cached_at)| {
            let events = serde_json::from_str(&events_data).ok()?;
            Some((events, cached_at))
        }))
    }

    // Sync state operations (for incremental sync via History API)

    pub fn get_history_id(&self, account_id: &str) -> Result<Option<String>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare("SELECT history_id FROM sync_state WHERE account_id = ?1")?;
        stmt.query_row(params![account_id], |row| row.get(0))
            .optional()
            .map_err(Into::into)
    }

    pub fn set_history_id(&self, account_id: &str, history_id: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute(
            "INSERT OR REPLACE INTO sync_state (account_id, history_id) VALUES (?1, ?2)",
            params![account_id, history_id],
        )?;
        Ok(())
    }

}

fn insert_card_row(conn: &Connection, card: &Card) -> Result<(), CacheError> {
    conn.execute(
        "INSERT INTO cards (id, account_id, name, query, position, collapsed, color, group_by, card_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![card.id, card.account_id, card.name, card.query, card.position, card.collapsed as i32, card.color, card.group_by, card.card_type],
    )?;
    Ok(())
}

fn update_card_row(conn: &Connection, card: &Card) -> Result<(), CacheError> {
    conn.execute(
        "UPDATE cards SET name = ?1, query = ?2, position = ?3, collapsed = ?4, color = ?5, group_by = ?6, card_type = ?7 WHERE id = ?8",
        params![card.name, card.query, card.position, card.collapsed as i32, card.color, card.group_by, card.card_type, card.id],
    )?;
    Ok(())
}

/// The card and the caches keyed by it
fn delete_card_rows(conn: &Connection, id: &str) -> Result<(), CacheError> {
    conn.execute("DELETE FROM cards WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM card_thread_cache WHERE card_id = ?1", params![id])?;
    conn.execute("DELETE FROM card_calendar_cache WHERE card_id = ?1", params![id])?;
    Ok(())
}

const CARD_COLUMNS: &str = "id, account_id, name, query, position, collapsed, color, group_by, card_type";

fn card_from_row(row: &rusqlite::Row) -> rusqlite::Result<Card> {
    Ok(Card {
        id: row.get(0)?,
        account_id: row.get(1)?,
        name: row.get(2)?,
        query: row.get(3)?,
        position: row.get(4)?,
        collapsed: row.get::<_, i32>(5)? != 0,
        color: row.get(6)?,
        group_by: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "date".to_string()),
        card_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "email".to_string()),
    })
}

fn account_from_row(row: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        picture: row.get(2)?,
        signature: row.get(3)?,
    })
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, CacheError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ThreadGroup;

    fn db() -> CacheDb {
        CacheDb::new(Path::new(":memory:")).unwrap()
    }

    fn account(email: &str) -> Account {
        Account::new(email.to_string(), None)
    }

    #[test]
    fn migrates_legacy_schema_without_losing_rows() {
        let dir = std::env::temp_dir().join(format!("posta-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("legacy.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, refresh_token_ref TEXT);
                 CREATE TABLE cards (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
                     query TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, collapsed INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE messages (gmail_msg_id TEXT PRIMARY KEY);
                 CREATE TABLE threads (gmail_thread_id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
                 CREATE INDEX idx_threads_account ON threads(account_id);
                 INSERT INTO accounts (id, email) VALUES ('a1', 'me@x.com');
                 INSERT INTO cards (id, account_id, name, query) VALUES ('c1', 'a1', 'Inbox', 'in:inbox');",
            )
            .unwrap();
        }

        let db = CacheDb::new(&path).unwrap();
        let accounts = db.get_accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].picture, None);
        let cards = db.get_cards("a1").unwrap();
        assert_eq!(cards[0].group_by, "date");
        assert_eq!(cards[0].card_type, "email");
        let unused_tables: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('messages', 'threads', 'idx_threads_account')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unused_tables, 0);
        db.insert_account(&account("new@x.com")).unwrap();
        assert!(db.get_account_by_email("new@x.com").unwrap().is_some());

        // Reopening an already-migrated database must also succeed
        drop(db);
        CacheDb::new(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn drops_unread_sync_timestamp_and_keeps_history_ids() {
        let dir = std::env::temp_dir().join(format!("posta-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sync.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE sync_state (account_id TEXT PRIMARY KEY, history_id TEXT NOT NULL,
                     last_sync_at INTEGER NOT NULL);
                 INSERT INTO sync_state VALUES ('a1', '42', 1700000000);",
            )
            .unwrap();
        }

        let db = CacheDb::new(&path).unwrap();
        assert_eq!(db.get_history_id("a1").unwrap().as_deref(), Some("42"));
        assert!(!has_column(&db.conn.lock().unwrap(), "sync_state", "last_sync_at").unwrap());
        db.set_history_id("a2", "7").unwrap();
        assert_eq!(db.get_history_id("a2").unwrap().as_deref(), Some("7"));
        assert!(!has_column(&self::db().conn.lock().unwrap(), "sync_state", "last_sync_at").unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_column_migration_is_reported() {
        let dir = std::env::temp_dir().join(format!("posta-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("broken.db");
        {
            let conn = Connection::open(&path).unwrap();
            // ALTER TABLE cannot add a column to a view
            conn.execute_batch("CREATE VIEW accounts AS SELECT 'a1' AS id, 'me@x.com' AS email;")
                .unwrap();
        }
        let result = CacheDb::new(&path);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(result.is_err());
    }

    #[test]
    fn account_roundtrip_and_lookup_by_email() {
        let db = db();
        let mut a = account("me@x.com");
        a.picture = Some("pic".into());
        db.insert_account(&a).unwrap();

        let found = db.get_account_by_email("me@x.com").unwrap().unwrap();
        assert_eq!(found.id, a.id);
        assert_eq!(found.picture.as_deref(), Some("pic"));
        assert!(db.get_account_by_email("other@x.com").unwrap().is_none());

        db.update_account_signature(&a.id, Some("-- me")).unwrap();
        assert_eq!(db.get_accounts().unwrap()[0].signature.as_deref(), Some("-- me"));
    }

    #[test]
    fn cards_are_ordered_updated_and_reordered() {
        let db = db();
        let a = account("me@x.com");
        db.insert_account(&a).unwrap();
        let c1 = Card::new(a.id.clone(), "One".into(), "q1".into(), 0);
        let mut c2 = Card::new_calendar(a.id.clone(), "Two".into(), "calendar:7d".into(), 1);
        db.insert_card(&c1).unwrap();
        db.insert_card(&c2).unwrap();

        c2.collapsed = true;
        c2.color = Some("red".into());
        c2.group_by = "sender".into();
        db.update_card(&c2).unwrap();

        db.reorder_cards(&[(c1.id.clone(), 5), (c2.id.clone(), 2)]).unwrap();
        let cards = db.get_cards(&a.id).unwrap();
        assert_eq!(cards.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Two", "One"]);
        assert!(cards[0].collapsed);
        assert_eq!(cards[0].color.as_deref(), Some("red"));
        assert_eq!(cards[0].group_by, "sender");
        assert_eq!(cards[0].card_type, "calendar");
    }

    #[test]
    fn saving_an_account_again_updates_it_in_place() {
        let db = db();
        let mut a = account("me@x.com");
        db.insert_account(&a).unwrap();
        db.update_account_signature(&a.id, Some("-- me")).unwrap();
        a.picture = Some("new-pic".into());
        a.signature = Some("-- me".into());
        db.insert_account(&a).unwrap();

        let accounts = db.get_accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].picture.as_deref(), Some("new-pic"));
        assert_eq!(accounts[0].signature.as_deref(), Some("-- me"));
    }

    #[test]
    fn a_second_account_id_for_the_same_email_does_not_replace_the_first() {
        let db = db();
        let first = account("me@x.com");
        db.insert_account(&first).unwrap();
        db.insert_card(&Card::new(first.id.clone(), "Inbox".into(), "in:inbox".into(), 0)).unwrap();

        assert!(db.insert_account(&account("me@x.com")).is_err());

        let accounts = db.get_accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, first.id, "the cards' account must stay");
    }

    #[test]
    fn editing_a_card_from_a_stale_copy_keeps_its_current_position() {
        let db = db();
        let card = Card::new("a".into(), "One".into(), "q1".into(), 0);
        db.insert_card(&card).unwrap();
        db.reorder_cards(&[(card.id.clone(), 4)]).unwrap();

        let mut edited = card.clone();
        edited.name = "Renamed".into();
        db.update_card(&edited).unwrap();

        let stored = &db.get_cards("a").unwrap()[0];
        assert_eq!(stored.name, "Renamed");
        assert_eq!(stored.position, 4);
    }

    #[test]
    fn editing_a_card_deleted_meanwhile_is_an_error() {
        let db = db();
        let card = Card::new("a".into(), "One".into(), "q1".into(), 0);
        let err = db.update_card(&card).unwrap_err();
        assert!(err.to_string().contains("deleted on another device"), "{}", err);
        assert!(db.get_cards("a").unwrap().is_empty());
    }

    #[test]
    fn a_card_is_found_by_id_only_under_its_own_account() {
        let db = db();
        let card = Card::new("a".into(), "One".into(), "q1".into(), 0);
        db.insert_card(&card).unwrap();
        assert!(db.card_exists(&card.id).unwrap());
        assert!(!db.card_exists("missing").unwrap());
        let found = db.get_card("a", &card.id).unwrap().unwrap();
        assert_eq!((found.id, found.name, found.query), (card.id.clone(), card.name.clone(), card.query.clone()));
        assert!(db.get_card("b", &card.id).unwrap().is_none());
        assert!(db.get_card("a", "missing").unwrap().is_none());
    }

    #[test]
    fn pulled_card_changes_carry_their_position() {
        let db = db();
        let card = Card::new("a".into(), "One".into(), "q1".into(), 0);
        db.insert_card(&card).unwrap();
        let moved = Card { position: 3, ..card };
        db.apply_card_changes(&[], std::slice::from_ref(&moved), &[]).unwrap();
        assert_eq!(db.get_cards("a").unwrap()[0].position, 3);
    }

    #[test]
    fn deleting_account_removes_only_its_data() {
        let db = db();
        let a = account("a@x.com");
        let b = account("b@x.com");
        db.insert_account(&a).unwrap();
        db.insert_account(&b).unwrap();
        let ca = Card::new(a.id.clone(), "A".into(), "q".into(), 0);
        let cb = Card::new(b.id.clone(), "B".into(), "q".into(), 0);
        db.insert_card(&ca).unwrap();
        db.insert_card(&cb).unwrap();
        db.save_card_threads(&ca.id, &[], None).unwrap();
        db.save_card_threads(&cb.id, &[], None).unwrap();
        db.save_card_events(&ca.id, &[]).unwrap();
        db.set_history_id(&a.id, "1").unwrap();
        db.set_history_id(&b.id, "2").unwrap();

        db.delete_account(&a.id).unwrap();

        assert!(db.get_account_by_email("a@x.com").unwrap().is_none());
        assert!(db.get_cards(&a.id).unwrap().is_empty());
        assert!(db.get_card_threads(&ca.id).unwrap().is_none());
        assert!(db.get_card_events(&ca.id).unwrap().is_none());
        assert!(db.get_history_id(&a.id).unwrap().is_none());

        assert_eq!(db.get_cards(&b.id).unwrap().len(), 1);
        assert!(db.get_card_threads(&cb.id).unwrap().is_some());
        assert_eq!(db.get_history_id(&b.id).unwrap().as_deref(), Some("2"));
    }

    #[test]
    fn deleting_card_clears_its_caches() {
        let db = db();
        let card = Card::new("a".into(), "A".into(), "q".into(), 0);
        db.insert_card(&card).unwrap();
        db.save_card_threads(&card.id, &[], Some("tok")).unwrap();
        db.save_card_events(&card.id, &[]).unwrap();
        db.delete_card(&card.id).unwrap();
        assert!(db.get_card_threads(&card.id).unwrap().is_none());
        assert!(db.get_card_events(&card.id).unwrap().is_none());
    }

    #[test]
    fn card_thread_cache_roundtrip() {
        let db = db();
        let groups = vec![ThreadGroup { label: "Today".into(), threads: vec![] }];
        db.save_card_threads("c", &groups, Some("next")).unwrap();
        let (got, token, cached_at) = db.get_card_threads("c").unwrap().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].label, "Today");
        assert_eq!(token.as_deref(), Some("next"));
        assert!((chrono::Utc::now().timestamp() - cached_at).abs() < 60);

        db.clear_card_cache("c").unwrap();
        assert!(db.get_card_threads("c").unwrap().is_none());
    }

    #[test]
    fn unreadable_card_cache_is_a_miss() {
        let db = db();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO card_thread_cache (card_id, thread_data, cached_at) VALUES ('c', '[{\"old\":1}]', 0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO card_calendar_cache (card_id, events_data, cached_at) VALUES ('c', 'not json', 0)",
                [],
            )
            .unwrap();
        }
        assert!(db.get_card_threads("c").unwrap().is_none());
        assert!(db.get_card_events("c").unwrap().is_none());
    }

    #[test]
    fn card_changes_apply_together() {
        let db = db();
        let keep = Card::new("a".into(), "Keep".into(), "q".into(), 0);
        let gone = Card::new("a".into(), "Gone".into(), "q".into(), 1);
        db.insert_card(&keep).unwrap();
        db.insert_card(&gone).unwrap();
        db.save_card_threads(&gone.id, &[], None).unwrap();
        db.save_card_events(&gone.id, &[]).unwrap();
        let added = Card::new("a".into(), "Added".into(), "q".into(), 2);
        let mut renamed = keep.clone();
        renamed.name = "Renamed".into();

        db.apply_card_changes(&[added], &[renamed], std::slice::from_ref(&gone.id)).unwrap();

        let names: Vec<_> = db.get_cards("a").unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["Renamed", "Added"]);
        assert!(db.get_card_threads(&gone.id).unwrap().is_none());
        assert!(db.get_card_events(&gone.id).unwrap().is_none());
    }

    #[test]
    fn failed_card_change_leaves_every_card_untouched() {
        let db = db();
        let keep = Card::new("a".into(), "Keep".into(), "q".into(), 0);
        let gone = Card::new("a".into(), "Gone".into(), "q".into(), 1);
        db.insert_card(&keep).unwrap();
        db.insert_card(&gone).unwrap();
        db.save_card_threads(&gone.id, &[], None).unwrap();
        let mut renamed = keep.clone();
        renamed.name = "Renamed".into();
        let fresh = Card::new("a".into(), "Fresh".into(), "q".into(), 2);
        // Same id as an existing card: the insert violates the primary key
        let duplicate = Card::new("a".into(), "Dup".into(), "q".into(), 3);
        let duplicate = Card { id: keep.id.clone(), ..duplicate };

        let result = db.apply_card_changes(&[fresh, duplicate], &[renamed], std::slice::from_ref(&gone.id));

        assert!(result.is_err());
        let names: Vec<_> = db.get_cards("a").unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["Keep", "Gone"]);
        assert!(db.get_card_threads(&gone.id).unwrap().is_some());
    }

    #[test]
    fn old_cache_of_an_existing_card_survives_and_orphans_go() {
        let db = db();
        let card = Card::new("a".into(), "A".into(), "q".into(), 0);
        db.insert_card(&card).unwrap();
        let two_days_ago = chrono::Utc::now().timestamp() - 2 * 24 * 3600;
        {
            let conn = db.conn.lock().unwrap();
            for id in [card.id.as_str(), "deleted-card"] {
                conn.execute(
                    "INSERT INTO card_thread_cache (card_id, thread_data, cached_at) VALUES (?1, '[]', ?2)",
                    params![id, two_days_ago],
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO card_calendar_cache (card_id, events_data, cached_at) VALUES (?1, '[]', ?2)",
                    params![id, two_days_ago],
                )
                .unwrap();
            }
        }

        assert_eq!(db.clear_orphaned_card_cache().unwrap(), 2);

        assert_eq!(db.get_card_threads(&card.id).unwrap().unwrap().2, two_days_ago);
        assert!(db.get_card_events(&card.id).unwrap().is_some());
        assert!(db.get_card_threads("deleted-card").unwrap().is_none());
        assert!(db.get_card_events("deleted-card").unwrap().is_none());
    }

    #[test]
    fn history_id_set_and_replace() {
        let db = db();
        assert!(db.get_history_id("a").unwrap().is_none());
        db.set_history_id("a", "10").unwrap();
        db.set_history_id("a", "11").unwrap();
        assert_eq!(db.get_history_id("a").unwrap().as_deref(), Some("11"));
    }
}
