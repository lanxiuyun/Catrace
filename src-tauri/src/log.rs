/// 统一日志模块：所有后端日志写入本地文件，并按天轮转保留最近 7 天。
/// 同时保留 stderr 输出，方便开发者本地调试。
///
/// 级别门槛：低于阈值的日志整行丢弃（stderr 与文件都不写）。阈值从环境变量
/// `CATRACE_LOG_LEVEL` 读一次（`error` / `warn` / `info` / `debug`，大小写不敏感，
/// 非法值告警并回退默认），默认 `info`——即 debug 级（逐条/逐轮的诊断细节）默认
/// 不落盘，需要排查时设 `CATRACE_LOG_LEVEL=debug` 再跑即可看到全部。
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static CURRENT_FILE: OnceLock<Mutex<Option<std::fs::File>>> = OnceLock::new();
static CURRENT_DATE: OnceLock<Mutex<String>> = OnceLock::new();
static MIN_LEVEL: OnceLock<u8> = OnceLock::new();

const KEEP_DAYS: i64 = 7;

/// 级别数值越小越严重；emit_log 用它做门槛比较。
fn level_rank(level: &str) -> u8 {
    match level {
        "error" => 0,
        "warn" => 1,
        "info" => 2,
        _ => 3, // debug 及未知级别按最细处理
    }
}

/// 环境变量值 → 门槛数值；非法值返回 None（回退默认 info，不静默放开到 debug）。
fn parse_level_rank(raw: &str) -> Option<u8> {
    match raw.trim().to_lowercase().as_str() {
        "error" => Some(0),
        "warn" => Some(1),
        "info" => Some(2),
        "debug" => Some(3),
        _ => None,
    }
}

fn min_level_rank() -> u8 {
    *MIN_LEVEL.get_or_init(|| match std::env::var("CATRACE_LOG_LEVEL") {
        Ok(v) => parse_level_rank(&v).unwrap_or_else(|| {
            eprintln!(
                "[log] unknown CATRACE_LOG_LEVEL=\"{}\", falling back to \"info\"",
                v.trim()
            );
            2 // 默认 info
        }),
        Err(_) => 2, // 未设置，默认 info
    })
}

pub fn init(app_data_dir: &Path) {
    let logs_dir = app_data_dir.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    let _ = LOG_DIR.set(logs_dir.clone());
    let _ = CURRENT_FILE.set(Mutex::new(None));
    let _ = CURRENT_DATE.set(Mutex::new(String::new()));

    cleanup_old_logs(&logs_dir);
}

fn cleanup_old_logs(logs_dir: &Path) {
    let cutoff = chrono::Local::now() - chrono::Duration::days(KEEP_DAYS);
    if let Ok(entries) = fs::read_dir(logs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if let Some(date_str) = name.strip_prefix("catrace-").and_then(|s| s.strip_suffix(".log")) {
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                        if date < cutoff.naive_local().date() {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
}

fn today_file_path(logs_dir: &Path, date: &str) -> PathBuf {
    logs_dir.join(format!("catrace-{}.log", date))
}

fn ensure_writer() {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    {
        let current = CURRENT_DATE.get().unwrap().lock().unwrap();
        if *current == today {
            return;
        }
    }

    let logs_dir = LOG_DIR.get().expect("log dir not initialized");
    let path = today_file_path(logs_dir, &today);

    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => {
            let mut writer = CURRENT_FILE.get().unwrap().lock().unwrap();
            *writer = Some(file);
            let mut date = CURRENT_DATE.get().unwrap().lock().unwrap();
            *date = today;
        }
        Err(e) => {
            eprintln!("[log] failed to open log file {}: {}", path.display(), e);
        }
    }
}

pub fn emit_log(tag: &str, level: &str, msg: String) {
    // 低于阈值的行直接丢弃，不进 stderr 也不进文件
    if level_rank(level) > min_level_rank() {
        return;
    }

    let ts = chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let line = format!("[{}] [{}] [{}] {}\n", ts, tag, level, msg);

    // 总是输出到 stderr
    eprint!("{}", line);

    // 写入文件
    ensure_writer();
    {
        let mut guard = CURRENT_FILE.get().unwrap().lock().unwrap();
        if let Some(file) = guard.as_mut() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

#[macro_export]
macro_rules! log_info {
    ($tag:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::log::emit_log($tag, "info", msg);
    }};
}

#[macro_export]
macro_rules! log_warn {
    ($tag:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::log::emit_log($tag, "warn", msg);
    }};
}

#[macro_export]
macro_rules! log_error {
    ($tag:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::log::emit_log($tag, "error", msg);
    }};
}

/// 逐条/逐轮的诊断细节：默认（info）级别不落盘，
/// 设 `CATRACE_LOG_LEVEL=debug` 后可见。
#[macro_export]
macro_rules! log_debug {
    ($tag:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::log::emit_log($tag, "debug", msg);
    }};
}

/// 万能宏：根据 tag 内容自动判断 level
/// - tag 包含 "error" 或 "failed" → error
/// - tag 包含 "warn" → warn
/// - 其他 → info
#[macro_export]
macro_rules! log {
    ($tag:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        let tag_str: &str = $tag;
        let level = if tag_str.to_lowercase().contains("error")
            || tag_str.to_lowercase().contains("failed")
        {
            "error"
        } else if tag_str.to_lowercase().contains("warn") {
            "warn"
        } else {
            "info"
        };
        $crate::log::emit_log(tag_str, level, msg);
    }};
}

/// 获取日志目录路径，用于前端打开。
pub fn logs_dir() -> Option<&'static Path> {
    LOG_DIR.get().map(|p| p.as_path())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_level_rank_accepts_all_valid_levels() {
        assert_eq!(parse_level_rank("error"), Some(0));
        assert_eq!(parse_level_rank("WARN"), Some(1));
        assert_eq!(parse_level_rank(" info "), Some(2));
        assert_eq!(parse_level_rank("Debug"), Some(3));
    }

    #[test]
    fn parse_level_rank_rejects_unknown_values() {
        assert_eq!(parse_level_rank(""), None);
        assert_eq!(parse_level_rank("verbose"), None);
        assert_eq!(parse_level_rank("log"), None);
    }
}
