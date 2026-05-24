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

    /// 检查当前连续 block 是否为活跃且达到 window_minutes 分钟
    /// 返回 true = 应该提醒
    pub fn check_should_notify(&self, window_minutes: i64, _break_minutes: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Local::now().timestamp();
        let start_of_day = chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            .timestamp();

        let mut stmt = conn.prepare(
            "SELECT timestamp, is_active FROM records
             WHERE timestamp >= ?1 AND timestamp <= ?2
             ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([start_of_day, now], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i32>(1)?))
        })?;

        let records: Vec<(i64, i32)> = rows.filter_map(|r| r.ok()).collect();

        if records.is_empty() {
            return Ok(false);
        }

        // 从最新记录往前找当前连续 block（时间戳连续且状态相同）
        let current_active = records[0].1 == 1;
        let mut block_len = 1;

        for i in 1..records.len() {
            let expected_ts = records[i - 1].0 - 60;
            if records[i].0 == expected_ts && records[i].1 == records[0].1 {
                block_len += 1;
            } else {
                break;
            }
        }

        if current_active {
            // 活跃 block 达到 window_minutes 就提醒
            Ok(block_len >= window_minutes as usize)
        } else {
            // 休息 block 不提醒
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_should_notify_active_block_reaches_window() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 600;
        // 插入 10 分钟活跃，当前 block = 10 分钟
        for i in 0..10 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        assert!(db.check_should_notify(10, 5).unwrap());
    }

    #[test]
    fn test_check_should_notify_active_block_not_enough() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 300;
        // 只插入 5 条活跃，当前 block = 5 < 10
        for i in 0..5 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        assert!(!db.check_should_notify(10, 5).unwrap());
    }

    #[test]
    fn test_check_should_notify_rest_block() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 600;
        // 先活跃 5 分钟，再休息 5 分钟
        for i in 0..5 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        for i in 5..10 {
            db.insert_record(base + i * 60, false, "test.exe")
                .unwrap();
        }
        // 当前 block 是休息，不提醒
        assert!(!db.check_should_notify(10, 5).unwrap());
    }

    #[test]
    fn test_check_should_notify_active_after_rest() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = chrono::Local::now().timestamp() - 900;
        // 先活跃 12 分钟，再休息 3 分钟，再活跃 2 分钟
        for i in 0..12 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        for i in 12..15 {
            db.insert_record(base + i * 60, false, "test.exe")
                .unwrap();
        }
        for i in 15..17 {
            db.insert_record(base + i * 60, true, "test.exe")
                .unwrap();
        }
        // 当前活跃 block 只有 2 分钟 < 10，不提醒
        assert!(!db.check_should_notify(10, 5).unwrap());
    }
}
