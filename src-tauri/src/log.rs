/// 统一日志模块：所有后端日志写入本地文件，并按天轮转保留最近 7 天。
/// 同时保留 stderr 输出，方便开发者本地调试。
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static CURRENT_FILE: OnceLock<Mutex<Option<std::fs::File>>> = OnceLock::new();
static CURRENT_DATE: OnceLock<Mutex<String>> = OnceLock::new();

const KEEP_DAYS: i64 = 7;

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
