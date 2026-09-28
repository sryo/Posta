// SQLite cache for offline access

use crate::models::{Account, Card, Thread};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Lock error")]
    Lock,
}

pub struct CacheDb {
    conn: Arc<Mutex<Connection>>,
}

impl CacheDb {
    pub fn new(db_path: &Path) -> Result<Self, CacheError> {
        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
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
                picture TEXT,
                refresh_token_ref TEXT
            );

            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                name TEXT NOT NULL,
                query TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                collapsed INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS threads (
                gmail_thread_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                subject TEXT,
                snippet TEXT,
                last_message_date INTEGER NOT NULL,
                unread_count INTEGER NOT NULL DEFAULT 0,
                labels TEXT,
                participants TEXT,
                cached_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                gmail_msg_id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                from_addr TEXT,
                to_addrs TEXT,
                date INTEGER NOT NULL,
                body_text TEXT,
                body_html TEXT,
                cached_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cards_account ON cards(account_id);
            CREATE INDEX IF NOT EXISTS idx_threads_account ON threads(account_id);
            CREATE INDEX IF NOT EXISTS idx_threads_date ON threads(last_message_date DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

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
                history_id TEXT NOT NULL,
                last_sync_at INTEGER NOT NULL
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
        // Add picture column if it doesn't exist (for existing databases)
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN picture TEXT", []);
        // Add color and group_by columns to cards
        let _ = conn.execute("ALTER TABLE cards ADD COLUMN color TEXT", []);
        let _ = conn.execute("ALTER TABLE cards ADD COLUMN group_by TEXT NOT NULL DEFAULT 'date'", []);
        // Add card_type column to cards
        let _ = conn.execute("ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'email'", []);
        // Add signature column to accounts
        let _ = conn.execute("ALTER TABLE accounts ADD COLUMN signature TEXT", []);
        Ok(())
    }

    // Account operations

    pub fn get_accounts(&self) -> Result<Vec<Account>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare("SELECT id, email, picture, signature, refresh_token_ref FROM accounts ORDER BY email")?;
        let rows = stmt.query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                email: row.get(1)?,
                picture: row.get(2)?,
                signature: row.get(3)?,
                refresh_token_ref: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_account_by_email(&self, email: &str) -> Result<Option<Account>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT id, email, picture, signature, refresh_token_ref FROM accounts WHERE email = ?1",
        )?;
        let result = stmt.query_row(params![email], |row| {
            Ok(Account {
                id: row.get(0)?,
                email: row.get(1)?,
                picture: row.get(2)?,
                signature: row.get(3)?,
                refresh_token_ref: row.get(4)?,
            })
        });
        match result {
            Ok(account) => Ok(Some(account)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn insert_account(&self, account: &Account) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute(
            "INSERT OR REPLACE INTO accounts (id, email, picture, signature, refresh_token_ref) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![account.id, account.email, account.picture, account.signature, account.refresh_token_ref],
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
        tx.execute("DELETE FROM threads WHERE account_id = ?1", params![id])?;
        tx.execute("DELETE FROM sync_state WHERE account_id = ?1", params![id])?;
        tx.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    // Card operations

    pub fn get_cards(&self, account_id: &str) -> Result<Vec<Card>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT id, account_id, name, query, position, collapsed, color, group_by, card_type FROM cards WHERE account_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![account_id], |row| {
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
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn insert_card(&self, card: &Card) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let collapsed: i32 = if card.collapsed { 1 } else { 0 };
        conn.execute(
            "INSERT INTO cards (id, account_id, name, query, position, collapsed, color, group_by, card_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![card.id, card.account_id, card.name, card.query, card.position, collapsed, card.color, card.group_by, card.card_type],
        )?;
        Ok(())
    }

    pub fn update_card(&self, card: &Card) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let collapsed: i32 = if card.collapsed { 1 } else { 0 };
        conn.execute(
            "UPDATE cards SET name = ?1, query = ?2, position = ?3, collapsed = ?4, color = ?5, group_by = ?6, card_type = ?7 WHERE id = ?8",
            params![card.name, card.query, card.position, collapsed, card.color, card.group_by, card.card_type, card.id],
        )?;
        Ok(())
    }

    pub fn delete_card(&self, id: &str) -> Result<(), CacheError> {
        let mut conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM cards WHERE id = ?1", params![id])?;
        tx.execute("DELETE FROM card_thread_cache WHERE card_id = ?1", params![id])?;
        tx.execute("DELETE FROM card_calendar_cache WHERE card_id = ?1", params![id])?;
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

    // Thread cache operations

    pub fn cache_threads(&self, threads: &[Thread]) -> Result<(), CacheError> {
        let mut conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let now = chrono::Utc::now().timestamp();

        let tx = conn.transaction()?;
        for thread in threads {
            let date = thread.last_message_date.timestamp();
            let labels = serde_json::to_string(&thread.labels).unwrap_or_default();
            let participants = serde_json::to_string(&thread.participants).unwrap_or_default();

            tx.execute(
                r#"INSERT OR REPLACE INTO threads
                   (gmail_thread_id, account_id, subject, snippet, last_message_date, unread_count, labels, participants, cached_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
                params![
                    thread.gmail_thread_id,
                    thread.account_id,
                    thread.subject,
                    thread.snippet,
                    date,
                    thread.unread_count,
                    labels,
                    participants,
                    now
                ],
            )?;
        }
        tx.commit()?;

        Ok(())
    }

    pub fn clear_old_cache(&self, max_age_hours: i64) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let cutoff = chrono::Utc::now().timestamp() - (max_age_hours * 3600);
        // Keep starred and important threads even if old
        let count = conn.execute(
            "DELETE FROM threads WHERE cached_at < ?1 AND labels NOT LIKE '%STARRED%' AND labels NOT LIKE '%IMPORTANT%'",
            params![cutoff],
        )?;
        Ok(count)
    }

    /// Clear stale card caches (older than max_age_hours)
    pub fn clear_stale_card_cache(&self, max_age_hours: i64) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let cutoff = chrono::Utc::now().timestamp() - (max_age_hours * 3600);
        let thread_count = conn.execute(
            "DELETE FROM card_thread_cache WHERE cached_at < ?1",
            params![cutoff],
        )?;
        let calendar_count = conn.execute(
            "DELETE FROM card_calendar_cache WHERE cached_at < ?1",
            params![cutoff],
        )?;
        Ok(thread_count + calendar_count)
    }

    /// Get threads that should be prioritized for caching (starred, important, recent)
    pub fn get_priority_thread_ids(&self, account_id: &str, limit: i64) -> Result<Vec<String>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT gmail_thread_id FROM threads
             WHERE account_id = ?1
             AND (labels LIKE '%STARRED%' OR labels LIKE '%IMPORTANT%')
             ORDER BY last_message_date DESC
             LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![account_id, limit], |row| row.get(0))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
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
    ) -> Result<Option<(Vec<crate::models::ThreadGroup>, Option<String>, i64)>, CacheError> {
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

    pub fn clear_all_card_caches(&self) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let count_threads = conn.execute("DELETE FROM card_thread_cache", [])?;
        let count_calendar = conn.execute("DELETE FROM card_calendar_cache", [])?;
        Ok(count_threads + count_calendar)
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
        let result = stmt.query_row(params![account_id], |row| row.get(0));

        match result {
            Ok(history_id) => Ok(Some(history_id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_history_id(&self, account_id: &str, history_id: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT OR REPLACE INTO sync_state (account_id, history_id, last_sync_at) VALUES (?1, ?2, ?3)",
            params![account_id, history_id, now],
        )?;
        Ok(())
    }

    pub fn clear_history_id(&self, account_id: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute("DELETE FROM sync_state WHERE account_id = ?1", params![account_id])?;
        Ok(())
    }
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

        // Reopening an already-migrated database must also succeed
        drop(db);
        CacheDb::new(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
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
    fn stale_card_cache_is_pruned() {
        let db = db();
        db.save_card_threads("fresh", &[], None).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO card_thread_cache (card_id, thread_data, cached_at) VALUES ('old', '[]', 0)",
                [],
            )
            .unwrap();
        }
        assert_eq!(db.clear_stale_card_cache(24).unwrap(), 1);
        assert!(db.get_card_threads("old").unwrap().is_none());
        assert!(db.get_card_threads("fresh").unwrap().is_some());
    }

    #[test]
    fn history_id_set_replace_clear() {
        let db = db();
        assert!(db.get_history_id("a").unwrap().is_none());
        db.set_history_id("a", "10").unwrap();
        db.set_history_id("a", "11").unwrap();
        assert_eq!(db.get_history_id("a").unwrap().as_deref(), Some("11"));
        db.clear_history_id("a").unwrap();
        assert!(db.get_history_id("a").unwrap().is_none());
    }
}
