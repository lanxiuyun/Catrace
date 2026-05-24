use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS records (
                timestamp INTEGER PRIMARY KEY,
                is_active INTEGER NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )?;
        // 兼容旧表，加列（已存在则忽略错误）
        conn.execute("ALTER TABLE records ADD COLUMN process_name TEXT", []).ok();
        conn.execute("ALTER TABLE records ADD COLUMN category TEXT", []).ok();
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn insert_record(
        &self,
        timestamp: i64,
        is_active: bool,
        process_name: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO records (timestamp, is_active, process_name) VALUES (?1, ?2, ?3)",
            rusqlite::params![timestamp, if is_active { 1 } else { 0 }, process_name],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str, default: &str) -> String {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT value FROM settings WHERE key = ?1") {
            Ok(s) => s,
            Err(_) => return default.to_string(),
        };
        let mut rows = match stmt.query([key]) {
            Ok(r) => r,
            Err(_) => return default.to_string(),
        };
        if let Ok(Some(row)) = rows.next() {
            row.get(0).unwrap_or_else(|_| default.to_string())
        } else {
            default.to_string()
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
        Ok(())
    }

    pub fn get_today_stats(&self) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let start_of_day = chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            .timestamp();

        let active: i64 = conn.query_row(
            "SELECT COUNT(*) FROM records WHERE timestamp >= ?1 AND is_active = 1",
            [start_of_day],
            |row| row.get(0),
        )?;

        let rest: i64 = conn.query_row(
            "SELECT COUNT(*) FROM records WHERE timestamp >= ?1 AND is_active = 0",
            [start_of_day],
            |row| row.get(0),
        )?;

        Ok((active, rest))
    }

    pub fn get_records_since(&self, start_timestamp: i64) -> Result<Vec<(i64, bool)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT timestamp, is_active FROM records WHERE timestamp >= ?1 ORDER BY timestamp"
        )?;
        let rows = stmt.query_map([start_timestamp], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i32>(1)? == 1))
        })?;
        rows.collect::<Result<Vec<_>>>()
    }

    pub fn get_app_stats(&self) -> Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let start_of_day = chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            .timestamp();

        let mut stmt = conn.prepare(
            "SELECT COALESCE(process_name, 'unknown'), COUNT(*) FROM records 
             WHERE timestamp >= ?1 AND is_active = 1 
             GROUP BY process_name"
        )?;
        let rows = stmt.query_map([start_of_day], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        rows.collect::<Result<Vec<_>>>()
    }

    /// 检查最近 window_minutes 分钟内是否有连续 break_minutes 分钟休息
    /// 返回 true = 应该提醒（没有足够休息）
    pub fn check_should_notify(&self, window_minutes: i64, break_minutes: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().timestamp();
        let start = now - window_minutes * 60;

        let mut stmt = conn.prepare(
            "SELECT timestamp, is_active FROM records
             WHERE timestamp >= ?1 AND timestamp <= ?2
             ORDER BY timestamp"
        )?;

        let rows = stmt.query_map([start, now], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i32>(1)?))
        })?;

        let records: Vec<(i64, i32)> = rows.filter_map(|r| r.ok()).collect();

        // 记录不够，不提醒
        if records.len() < window_minutes as usize {
            return Ok(false);
        }

        // 找最长连续休息
        let mut max_rest = 0_i64;
        let mut current_rest = 0_i64;
        for (_, is_active) in records {
            if is_active == 0 {
                current_rest += 1;
                if current_rest > max_rest {
                    max_rest = current_rest;
                }
            } else {
                current_rest = 0;
            }
        }

        // 没有连续 break_minutes 分钟休息 → 提醒
        Ok(max_rest < break_minutes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_should_notify_remind() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 600;
        // 插入 10 分钟活跃，无连续休息
        for i in 0..10 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        assert!(db.check_should_notify(10, 5).unwrap());
    }

    #[test]
    fn test_check_should_notify_rest() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 600;
        // 插入 10 分钟，中间有连续 5 分钟休息
        for i in 0..3 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        for i in 3..8 {
            db.insert_record(base + i * 60, false, "test.exe")
                .unwrap();
        }
        for i in 8..10 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        assert!(!db.check_should_notify(10, 5).unwrap());
    }

    #[test]
    fn test_check_should_notify_not_enough_records() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 300;
        // 只插入 5 条，不够 window=10
        for i in 0..5 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        assert!(!db.check_should_notify(10, 5).unwrap());
    }
}
