// SQLite cache for offline access

use crate::models::{Account, Card, Thread};
use rusqlite::{params, Connection};
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
        Ok(())
    }

    // Account operations

    pub fn get_accounts(&self) -> Result<Vec<Account>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let mut stmt = conn.prepare("SELECT id, email, picture, refresh_token_ref FROM accounts ORDER BY email")?;
        let rows = stmt.query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                email: row.get(1)?,
                picture: row.get(2)?,
                refresh_token_ref: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn insert_account(&self, account: &Account) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute(
            "INSERT OR REPLACE INTO accounts (id, email, picture, refresh_token_ref) VALUES (?1, ?2, ?3, ?4)",
            params![account.id, account.email, account.picture, account.refresh_token_ref],
        )?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        // Also delete related cards
        conn.execute("DELETE FROM cards WHERE account_id = ?1", params![id])?;
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
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        conn.execute("DELETE FROM cards WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Thread cache operations

    pub fn cache_threads(&self, threads: &[Thread]) -> Result<(), CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let now = chrono::Utc::now().timestamp();

        for thread in threads {
            let date = thread.last_message_date.timestamp();
            let labels = serde_json::to_string(&thread.labels).unwrap_or_default();
            let participants = serde_json::to_string(&thread.participants).unwrap_or_default();

            conn.execute(
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

        Ok(())
    }

    pub fn clear_old_cache(&self, max_age_hours: i64) -> Result<usize, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Lock)?;
        let cutoff = chrono::Utc::now().timestamp() - (max_age_hours * 3600);
        let count = conn.execute("DELETE FROM threads WHERE cached_at < ?1", params![cutoff])?;
        Ok(count)
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

        let result = stmt.query_row(params![card_id], |row| {
            let thread_data: String = row.get(0)?;
            let next_page_token: Option<String> = row.get(1)?;
            let cached_at: i64 = row.get(2)?;
            Ok((thread_data, next_page_token, cached_at))
        });

        match result {
            Ok((thread_data, next_page_token, cached_at)) => {
                let threads: Vec<crate::models::ThreadGroup> =
                    serde_json::from_str(&thread_data).unwrap_or_default();
                Ok(Some((threads, next_page_token, cached_at)))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
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

        let result = stmt.query_row(params![card_id], |row| {
            let events_data: String = row.get(0)?;
            let cached_at: i64 = row.get(1)?;
            Ok((events_data, cached_at))
        });

        match result {
            Ok((events_data, cached_at)) => {
                let events: Vec<crate::models::GoogleCalendarEvent> =
                    serde_json::from_str(&events_data).unwrap_or_default();
                Ok(Some((events, cached_at)))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
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
