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

    /// 获取从今天首个记录到最新记录的每分钟数据（缺失视为休息）
    fn get_today_minutes(&self) -> Result<Vec<(i64, bool)>> {
        let start_of_day = chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            .timestamp();

        let records = self.get_records_since(start_of_day)?;
        if records.is_empty() {
            return Ok(Vec::new());
        }

        let first_ts = records[0].0;
        let last_ts = records.last().unwrap().0;

        let mut map = std::collections::BTreeMap::new();
        for (ts, active) in records {
            map.insert(ts, active);
        }

        let mut result = Vec::new();
        let mut t = first_ts;
        while t <= last_ts {
            let active = *map.get(&t).unwrap_or(&false);
            result.push((t, active));
            t += 60;
        }

        Ok(result)
    }

    /// 检查是否应该提醒
    /// 返回 (should_notify, boundary_timestamp)
    /// boundary_timestamp 保留用于定位触发提醒的 block 边界（lib.rs 已不再做重）
    pub fn check_should_notify(&self, window_minutes: i64, break_minutes: i64) -> Result<(bool, Option<i64>)> {
        let records = self.get_today_minutes()?;
        if records.is_empty() {
            return Ok((false, None));
        }

        let window = window_minutes as usize;
        let break_m = break_minutes as usize;

        let (completed, current_start) = compute_completed_blocks(&records, window, break_m);
        let current_slice = &records[current_start..];

        // 条件 A：当前进行中 block 内存在连续 break_m 休息 → 视为休息，不提醒
        if has_consecutive_rest(current_slice, break_m) {
            return Ok((false, None));
        }

        // 条件 B：当前进行中 block 长度 >= window → 休息后又工作满一波，提醒
        if current_slice.len() >= window {
            return Ok((true, Some(records[current_start].0)));
        }

        // 条件 C：看前一个已完成 block
        if let Some(prev) = completed.last() {
            if prev.kind == BlockKind::Active {
                return Ok((true, Some(records[prev.end - 1].0)));
            }
        }

        Ok((false, None))
    }
}

// ------------------------------------------------------------------
// Block 切分核心逻辑（与前端 computeTimeBlocks 对齐）
// ------------------------------------------------------------------

#[derive(Debug, PartialEq)]
enum BlockKind {
    Active,
    Rest,
}

#[derive(Debug)]
#[allow(dead_code)]
struct Block {
    kind: BlockKind,
    start: usize,
    end: usize,
}

/// 在 [start, start + max_scan) 范围内找连续 break_m 休息
/// 找到后延伸至所有连续休息结束，返回结束索引（不包含）
fn find_break_end(
    records: &[(i64, bool)],
    start: usize,
    max_scan: usize,
    break_m: usize,
) -> Option<usize> {
    let mut rest_streak = 0;
    for i in start..std::cmp::min(start + max_scan, records.len()) {
        if !records[i].1 {
            rest_streak += 1;
            if rest_streak >= break_m {
                let mut end = i + 1;
                while end < records.len() && !records[end].1 {
                    end += 1;
                }
                return Some(end);
            }
        } else {
            rest_streak = 0;
        }
    }
    None
}

/// 检查切片中是否存在连续 break_m 分钟休息
fn has_consecutive_rest(records: &[(i64, bool)], break_m: usize) -> bool {
    let mut streak = 0;
    for (_, active) in records {
        if !active {
            streak += 1;
            if streak >= break_m {
                return true;
            }
        } else {
            streak = 0;
        }
    }
    false
}

/// 从首个记录开始向后切分已完成 block
/// 返回 (已完成 blocks, 当前进行中 block 起点索引)
fn compute_completed_blocks(
    records: &[(i64, bool)],
    window: usize,
    break_m: usize,
) -> (Vec<Block>, usize) {
    let mut blocks = Vec::new();
    let mut s = 0;

    while s < records.len() {
        let remaining = records.len() - s;

        // 在当前 window 范围内找连续 break
        if let Some(end) = find_break_end(records, s, window, break_m) {
            blocks.push(Block {
                kind: BlockKind::Rest,
                start: s,
                end,
            });
            s = end;
            continue;
        }

        // 没有连续休息，检查能否切活跃 block
        if remaining >= window {
            blocks.push(Block {
                kind: BlockKind::Active,
                start: s,
                end: s + window,
            });
            s += window;
        } else {
            // 未完成
            break;
        }
    }

    (blocks, s)
}

// ------------------------------------------------------------------
// 测试
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn start_of_day_ts() -> i64 {
        chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            .timestamp()
    }

    #[test]
    fn test_notify_after_active_block_completes() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        // 活跃 45 分钟
        for i in 0..45 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        // 第 45 分钟继续活跃 → active block 完成后继续干活，should_notify=true
        db.insert_record(base + 45 * 60, true, "test.exe").unwrap();
        let (should, boundary) = db.check_should_notify(45, 5).unwrap();
        assert!(should);
        assert_eq!(boundary, Some(base + 44 * 60));
    }

    #[test]
    fn test_notify_no_duplicate_boundary() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        for i in 0..45 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        // 第 45、46 分钟继续活跃
        db.insert_record(base + 45 * 60, true, "test.exe").unwrap();
        db.insert_record(base + 46 * 60, true, "test.exe").unwrap();

        let (should1, boundary1) = db.check_should_notify(45, 5).unwrap();
        assert!(should1);
        assert_eq!(boundary1, Some(base + 44 * 60));

        // 再插一条活跃，boundary 仍不变
        db.insert_record(base + 47 * 60, true, "test.exe").unwrap();
        let (should2, boundary2) = db.check_should_notify(45, 5).unwrap();
        assert!(should2);
        assert_eq!(boundary2, Some(base + 44 * 60));
    }

    // 场景4完整版：活跃 45min → 休息，前 4min 休息时 should_notify 仍为 true，第 5min 停
    #[test]
    fn test_notify_active_then_rest_until_break() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        // 0-44 活跃
        for i in 0..45 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }

        // 第 45min 休息 → should_notify=true（prev=Active，current_slice 未达 5 连休）
        db.insert_record(base + 45 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);

        // 第 46min 休息 → should_notify=true
        db.insert_record(base + 46 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);

        // 第 47min 休息 → should_notify=true
        db.insert_record(base + 47 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);

        // 第 48min 休息 → should_notify=true
        db.insert_record(base + 48 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);

        // 第 49min 休息 → 连续休息够 5，should_notify=false
        db.insert_record(base + 49 * 60, false, "test.exe").unwrap();
        assert!(!db.check_should_notify(45, 5).unwrap().0);
    }

    // 场景1延长版：活跃 45min → 继续活跃 10min，should_notify 持续为 true
    #[test]
    fn test_notify_active_then_keep_active() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        // 0-54 活跃（45 + 继续 10）
        for i in 0..55 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }

        // prev=Active(0,45)，current_slice=活跃×10，无连续休息 → should_notify=true
        let (should, _) = db.check_should_notify(45, 5).unwrap();
        assert!(should);
    }

    // 场景5完整版：活跃 45min → 休息 5min → 再活跃 45min
    #[test]
    fn test_notify_full_cycle_active_rest_active() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();

        // 0-44 活跃
        for i in 0..45 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }

        // 第 45min 休息 → should_notify=true（prev=Active，未达 5 连休）
        db.insert_record(base + 45 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);

        // 第 46-48min 休息 → should_notify=true
        db.insert_record(base + 46 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);
        db.insert_record(base + 47 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);
        db.insert_record(base + 48 * 60, false, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);

        // 第 49min 休息 → 连续够 5，should_notify=false
        db.insert_record(base + 49 * 60, false, "test.exe").unwrap();
        assert!(!db.check_should_notify(45, 5).unwrap().0);

        // 0:50~1:35 再活跃 45min（50-94）
        for i in 50..95 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }

        // 第 94min（1:35）完成第二个 Active block → should_notify=true
        let (should, boundary) = db.check_should_notify(45, 5).unwrap();
        assert!(should);
        assert_eq!(boundary, Some(base + 94 * 60));

        // 第 95min（1:36）继续活跃 → should_notify=true
        db.insert_record(base + 95 * 60, true, "test.exe").unwrap();
        assert!(db.check_should_notify(45, 5).unwrap().0);
    }

    // 场景6：活跃 40min → 休息 5min → 再活跃中（3min），不提醒
    #[test]
    fn test_no_notify_rest_then_short_active() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        // 0-39 活跃
        for i in 0..40 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        // 40-44 休息
        for i in 40..45 {
            db.insert_record(base + i * 60, false, "test.exe").unwrap();
        }
        // 45-47 活跃（再活跃 3min，未满 45）
        for i in 45..48 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }

        let (should, _) = db.check_should_notify(45, 5).unwrap();
        assert!(!should);
    }

    #[test]
    fn test_no_notify_after_rest_block() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        // 活跃 40，休息 5
        for i in 0..40 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        for i in 40..45 {
            db.insert_record(base + i * 60, false, "test.exe").unwrap();
        }
        // 当前在第 45 分钟（休息后）
        db.insert_record(base + 45 * 60, false, "test.exe").unwrap();
        let (should, _) = db.check_should_notify(45, 5).unwrap();
        assert!(!should);
    }

    #[test]
    fn test_notify_after_rest_then_active() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        for i in 0..40 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        for i in 40..45 {
            db.insert_record(base + i * 60, false, "test.exe").unwrap();
        }
        // 再活跃 45 分钟
        for i in 45..90 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        let (should, boundary) = db.check_should_notify(45, 5).unwrap();
        assert!(should);
        assert_eq!(boundary, Some(base + 89 * 60));
    }

    #[test]
    fn test_no_notify_during_ongoing() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        for i in 0..40 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        // 当前只有 40 分钟，不够 45
        let (should, _) = db.check_should_notify(45, 5).unwrap();
        assert!(!should);
    }

    #[test]
    fn test_no_notify_empty() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let (should, _) = db.check_should_notify(45, 5).unwrap();
        assert!(!should);
    }

    #[test]
    fn test_notify_short_rest_then_active() {
        let db = Db::new(Path::new(":memory:")).unwrap();
        let base = start_of_day_ts();
        // 活跃 45，休息 1，再活跃 45
        for i in 0..45 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        db.insert_record(base + 45 * 60, false, "test.exe").unwrap();
        for i in 46..91 {
            db.insert_record(base + i * 60, true, "test.exe").unwrap();
        }
        let (should, boundary) = db.check_should_notify(45, 5).unwrap();
        assert!(should);
        // ActiveBlock(45, 90) 的最后一条记录索引为 89
        assert_eq!(boundary, Some(base + 89 * 60));
    }

    #[test]
    fn test_compute_blocks_basic() {
        // 模拟 45 活跃 + 5 休息 + 45 活跃
        let records: Vec<(i64, bool)> = (0..95)
            .map(|i| {
                let active = !(i >= 40 && i < 45);
                (i as i64 * 60, active)
            })
            .collect();

        let (blocks, current) = compute_completed_blocks(&records, 45, 5);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].kind, BlockKind::Rest);
        assert_eq!(blocks[0].start, 0);
        assert_eq!(blocks[0].end, 45);
        assert_eq!(blocks[1].kind, BlockKind::Active);
        assert_eq!(blocks[1].start, 45);
        assert_eq!(blocks[1].end, 90);
        assert_eq!(current, 90);
    }

    #[test]
    fn test_compute_blocks_all_active() {
        let records: Vec<(i64, bool)> = (0..100)
            .map(|i| (i as i64 * 60, true))
            .collect();

        let (blocks, current) = compute_completed_blocks(&records, 45, 5);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].kind, BlockKind::Active);
        assert_eq!(blocks[0].start, 0);
        assert_eq!(blocks[0].end, 45);
        assert_eq!(blocks[1].kind, BlockKind::Active);
        assert_eq!(blocks[1].start, 45);
        assert_eq!(blocks[1].end, 90);
        assert_eq!(current, 90);
    }

    #[test]
    fn test_compute_blocks_all_rest() {
        let records: Vec<(i64, bool)> = (0..20)
            .map(|i| (i as i64 * 60, false))
            .collect();

        let (blocks, current) = compute_completed_blocks(&records, 45, 5);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, BlockKind::Rest);
        assert_eq!(blocks[0].start, 0);
        assert_eq!(blocks[0].end, 20);
        assert_eq!(current, 20);
    }
}
