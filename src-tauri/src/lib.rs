mod agent_hook;
mod bus;
mod db;
mod event;
mod event_http;
mod eye;
mod log;
mod media_audio;
mod reminder;
mod reminder_toast;
mod report;
mod signal;
mod water;
mod window_manager;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use active_win_pos_rs::get_active_window;
use base64::Engine;
use chrono::Timelike;
use std::fs;
use std::path::Path;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tokio::time::interval;
// 窗口状态由 tauri-plugin-window-state 自动管理（启动恢复 / 退出保存）

// 启动时自动检查更新，整个生命周期只执行一次
static UPDATE_CHECK_DONE: AtomicBool = AtomicBool::new(false);
/// 手动「发送测试」防抖：先限流稳住连点，后续再做无限制堆叠加固。
static LAST_TEST_NOTIFICATION_AT: Mutex<Option<Instant>> = Mutex::new(None);

#[cfg(target_os = "macos")]
pub(crate) fn accessibility_permission_granted() -> bool {
    macos_accessibility_client::accessibility::application_is_trusted()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn accessibility_permission_granted() -> bool {
    true
}

#[tauri::command]
fn get_accessibility_permission_status() -> bool {
    accessibility_permission_granted()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn request_accessibility_permission() -> bool {
    macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn request_accessibility_permission() -> bool {
    true
}

fn start_input_sampling(
    state: Arc<Mutex<ActivityState>>,
    signal_core: Arc<signal::SignalCore>,
    started: Arc<AtomicBool>,
) {
    // 键盘/鼠标采集下沉到 signal 模块：
    // - 保留 legacy ActivityState.count 的 2s 去重语义（休息判定不变）
    // - 同时写入 Signal 分钟桶（键计数/可选序列、鼠标每秒位移）
    signal::start_input_sampling(state, signal_core, started);
}

// ------------------------------------------------------------------
// 媒体计入活跃检测
// ------------------------------------------------------------------

// ---------- 调试结构体 ----------

#[derive(serde::Serialize)]
struct MediaDebugInfo {
    audio_sessions: Vec<media_audio::AudioSessionInfo>,
    audio_active: bool,
    audio_error: Option<String>,

    focus_window_title: String,
    focus_app_name: String,
    focus_process_path: String,

    media_active: bool,
    mouse_keyboard_count: u32,
}

// ---------- Windows 媒体检测 ----------

/// Windows：枚举有音频输出的进程，若任一进程不在白名单内，则视为媒体活跃。
/// - 无音频输出 → 不活跃（接受静音看视频被误判为不活跃）。
/// - 有音频输出 → 检查每个音频输出进程自身是否在白名单；
///   任一非白名单进程 → 活跃，全部白名单 → 不活跃。
/// - 音频检测失败 → 不活跃。
#[cfg(windows)]
fn is_media_active(whitelist: &[String]) -> bool {
    media_audio::is_media_audio_active(whitelist)
}

/// 非 Windows：目前尚未实现系统级音频检测，媒体计入活跃暂不可用。
#[cfg(not(windows))]
fn is_media_active(_whitelist: &[String]) -> bool {
    false
}

#[derive(Default)]
pub struct ActivityState {
    pub count: u32,
    pub last_cursor: (i32, i32),
    pub key_debounce: Option<Instant>,
    /// 最近一次分钟结算时的媒体活跃结果，供 get_activity_snapshot 复用
    pub media_active_snapshot: bool,
    /// 最近一次分钟结算时的全屏状态快照
    pub fullscreen_snapshot: bool,
}

/// 轻量活跃快照，供休息计时卡片每 2 秒轮询使用。
/// 只读键鼠累计计数与媒体/全屏状态，避免 get_media_debug_info 的会话枚举开销。
#[derive(serde::Serialize)]
struct ActivitySnapshot {
    count: u32,
    media_active: bool,
    fullscreen_active: bool,
}

#[tauri::command]
async fn get_activity_snapshot(
    activity: tauri::State<'_, Arc<Mutex<ActivityState>>>,
) -> Result<ActivitySnapshot, String> {
    let s = activity.lock().unwrap();
    Ok(ActivitySnapshot {
        count: s.count,
        // 复用最近一次分钟结算的媒体/全屏快照，避免每次轮询都枚举音频会话
        media_active: s.media_active_snapshot,
        // 全屏期间前端不应把键鼠活动视为恢复活跃
        fullscreen_active: s.fullscreen_snapshot,
    })
}

use eye::EyeReminderState;
use reminder::ReminderState;
use water::WaterReminderState;

// ---------- 提醒窗口数据 ----------

#[derive(Default, serde::Serialize, Clone)]
pub struct ReminderWindowData {
    pub kind: String,
    pub boundary: i64,
    pub title: String,
    pub body: String,
    pub break_minutes: i64,
    pub fullscreen_bg: Option<String>,
    pub fullscreen_opacity: i64,
    pub fullscreen_fit_mode: String,
    pub fullscreen_element_transforms: String,
}

pub type ReminderWindowStore = Arc<Mutex<HashMap<String, ReminderWindowData>>>;

/// Debug 页通知循环测试状态
pub struct NotificationTestState {
    running: AtomicBool,
}

impl NotificationTestState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn start(&self) {
        self.running.store(true, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

impl Default for NotificationTestState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------- i18n helpers ----------

fn notify_title(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "休息提醒",
        _ => "Rest Reminder",
    }
}

fn notify_body(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "站起来，喝口水，伸伸脖子和懒腰。",
        _ => "Stand up, drink some water, stretch your neck and back.",
    }
}

fn test_notify_msg(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "这是一条测试提醒",
        _ => "This is a test notification",
    }
}

fn tray_show(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "显示主窗口",
        _ => "Show Main Window",
    }
}

fn tray_quit(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "退出",
        _ => "Quit",
    }
}

/** 获取媒体检测的实时调试信息，供 Debug 页面展示。
 * 音频会话检测有内部超时保护，均无需额外 spawn_blocking。 */
#[tauri::command]
async fn get_media_debug_info(
    activity: tauri::State<'_, Arc<Mutex<ActivityState>>>,
    db: tauri::State<'_, db::Db>,
    whitelist: tauri::State<'_, Arc<Mutex<Vec<String>>>>,
) -> Result<MediaDebugInfo, String> {
    let mouse_keyboard_count = {
        let s = activity.lock().unwrap();
        s.count
    };
    let _locale = db.get_setting("locale", "zh-CN");

    // 获取音频会话信息（Windows），避免长时间持有 state 锁
    let whitelist_clone = whitelist.lock().unwrap().clone();
    let (audio_sessions, audio_active, audio_error) = match media_audio::list_audio_sessions() {
        Ok(mut sessions) => {
            for session in &mut sessions {
                session.whitelisted = media_audio::is_session_whitelisted(session, &whitelist_clone);
            }
            let active = media_audio::is_media_audio_active(&whitelist_clone);
            (sessions, active, None)
        }
        Err(e) => (Vec::new(), false, Some(e)),
    };

    // 获取当前焦点窗口信息（仅用于展示，不再参与媒体活跃判定）
    let (focus_title, focus_app, focus_path) = match get_active_window() {
        Ok(win) => {
            let title = win.title;
            let app_name = win.app_name;
            let process_path = win.process_path.to_string_lossy().to_string();
            (title, app_name, process_path)
        }
        Err(_) => (
            "Unknown".to_string(),
            "Unknown".to_string(),
            "Unknown".to_string(),
        ),
    };

    let media_active = is_media_active(&whitelist_clone);

    Ok(MediaDebugInfo {
        audio_sessions,
        audio_active,
        audio_error,
        focus_window_title: focus_title,
        focus_app_name: focus_app,
        focus_process_path: focus_path,
        media_active,
        mouse_keyboard_count,
    })
}

/** 获取当前运行平台。 */
#[tauri::command]
fn get_platform() -> &'static str {
    std::env::consts::OS
}

/** 获取「媒体计入活跃」开关状态（默认 true）。
 * 底层 key 仍为 video_active_enabled，以兼容老用户设置。 */
#[tauri::command]
fn get_media_active_enabled(db: tauri::State<db::Db>) -> bool {
    db.get_setting("video_active_enabled", "true") == "true"
}

/** 设置「媒体计入活跃」开关状态。 */
#[tauri::command]
fn set_media_active_enabled(enabled: bool, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("video_active_enabled", &enabled.to_string())
        .map_err(|e| e.to_string())
}

/** 获取媒体排除白名单文本（一行一个进程名，首次读取时自动初始化默认值）。 */
#[tauri::command]
fn get_media_whitelist_text(db: tauri::State<db::Db>) -> String {
    media_audio::whitelist_to_text(&media_audio::load_whitelist(&db))
}

/** 设置媒体排除白名单文本；空文本视为恢复默认白名单。 */
#[tauri::command]
fn set_media_whitelist_text(
    text: String,
    db: tauri::State<db::Db>,
    state: tauri::State<'_, Arc<Mutex<Vec<String>>>>,
) -> Result<(), String> {
    let mut list = media_audio::parse_whitelist_text(&text);
    if list.is_empty() {
        list = media_audio::default_whitelist();
    }
    media_audio::save_whitelist(&db, &list)?;
    *state.lock().unwrap() = list;
    Ok(())
}

/** 打开日志目录，方便用户打包日志文件反馈问题。 */
#[tauri::command]
fn open_logs_dir() -> Result<(), String> {
    if let Some(dir) = log::logs_dir() {
        tauri_plugin_opener::open_path(dir, None::<&str>)
            .map_err(|e| format!("Failed to open logs dir: {}", e))?;
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct FrontendLogPayload {
    level: String,
    message: String,
}

/** 接收前端 console 日志并写入同一日志文件。 */
#[tauri::command]
fn log_frontend(payload: FrontendLogPayload) {
    let level = payload.level.as_str();
    match level {
        "error" => log_error!("frontend", "{}", payload.message),
        "warn" => log_warn!("frontend", "{}", payload.message),
        _ => log_info!("frontend", "{}", payload.message),
    }
}

/** 获取 Toast 调试模式开关状态（默认 false）。 */
#[tauri::command]
fn get_toast_debug_mode(db: tauri::State<db::Db>) -> bool {
    db.get_setting("toast_debug_mode", "false") == "true"
}

/** 设置 Toast 调试模式开关状态。 */
#[tauri::command]
fn set_toast_debug_mode(
    enabled: bool,
    db: tauri::State<db::Db>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    db.set_setting("toast_debug_mode", &enabled.to_string())
        .map_err(|e| e.to_string())?;

    // 通过 Tauri 事件广播状态变更，Toast 窗口前端监听并实时更新背景
    app.emit("catrace-toast-debug-changed", enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config(db: tauri::State<db::Db>) -> serde_json::Value {
    let window: i64 = db.get_setting("window_minutes", "45").parse().unwrap_or(45);
    let break_m: i64 = db.get_setting("break_minutes", "5").parse().unwrap_or(5);
    let snooze_interval: i64 = db
        .get_setting("snooze_interval_minutes", "3")
        .parse()
        .unwrap_or(3);
    serde_json::json!({ "window_minutes": window, "break_minutes": break_m, "snooze_interval_minutes": snooze_interval })
}

#[tauri::command]
fn set_config(config: serde_json::Value, db: tauri::State<db::Db>) -> Result<(), String> {
    if let Some(v) = config.get("window_minutes").and_then(|v| v.as_i64()) {
        db.set_setting("window_minutes", &v.to_string())
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = config.get("break_minutes").and_then(|v| v.as_i64()) {
        db.set_setting("break_minutes", &v.to_string())
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = config
        .get("snooze_interval_minutes")
        .and_then(|v| v.as_i64())
    {
        db.set_setting("snooze_interval_minutes", &v.to_string())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn skip_reminder(
    boundary: i64,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
) {
    let mut s = state.lock().unwrap();
    s.skip_until_boundary = Some(boundary);
    s.snooze_until = None;
    s.break_timer_active = false;
    // 用户操作后恢复正常活动追踪
    fullscreen_active.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn snooze_reminder(
    minutes: u64,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
) {
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(minutes * 60));
    s.break_timer_active = false;
    // 用户操作后恢复正常活动追踪
    fullscreen_active.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn dismiss_rest_timer(
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    bus: tauri::State<crate::bus::EventBus>,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.break_timer_active = false;
    drop(s);
    // Clear sticky rest-timer card on bus if present
    if let Ok(Some(ev)) = bus.find_active_by_dedupe_key("reminder.rest.timer") {
        use crate::event::{EventResolution, ResolutionKind};
        let _ = bus.resolve(
            ev.id,
            EventResolution {
                kind: ResolutionKind::Dismissed,
                action_id: None,
                payload: None,
            },
        );
    }
    Ok(())
}

#[tauri::command]
fn get_today_stats(db: tauri::State<db::Db>) -> Result<serde_json::Value, String> {
    let (active, rest) = db.get_today_stats().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "active_minutes": active, "rest_minutes": rest }))
}

#[tauri::command]
fn get_today_records(db: tauri::State<db::Db>) -> Result<Vec<(i64, bool)>, String> {
    let start_of_day = chrono::Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(chrono::Local)
        .unwrap()
        .timestamp();
    db.get_records_since(start_of_day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_stats(db: tauri::State<db::Db>) -> Result<Vec<(String, i64)>, String> {
    db.get_app_stats().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_silent_start(db: tauri::State<db::Db>) -> bool {
    db.get_setting("silent_start", "false") == "true"
}

#[tauri::command]
fn set_silent_start(enabled: bool, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("silent_start", &enabled.to_string())
        .map_err(|e| e.to_string())
}

/** 获取「隐藏统计面板」开关状态（默认 false）。 */
#[tauri::command]
fn get_hide_stats(db: tauri::State<db::Db>) -> bool {
    db.get_setting("hide_stats", "false") == "true"
}

/** 设置「隐藏统计面板」开关状态。 */
#[tauri::command]
fn set_hide_stats(enabled: bool, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("hide_stats", &enabled.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_locale(db: tauri::State<db::Db>) -> Option<String> {
    let val = db.get_setting("locale", "");
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

#[tauri::command]
fn set_locale(locale: String, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("locale", &locale).map_err(|e| e.to_string())
}

// ---------- 提醒模式与自定义文本 ----------

#[tauri::command]
fn get_reminder_mode(db: tauri::State<db::Db>) -> String {
    db.get_setting("reminder_mode", "toast")
}

#[tauri::command]
fn set_reminder_mode(mode: String, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("reminder_mode", &mode)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_reminder_text(db: tauri::State<db::Db>) -> serde_json::Value {
    let title = db.get_setting("reminder_title", "");
    let body = db.get_setting("reminder_body", "");
    serde_json::json!({ "title": title, "body": body })
}

#[tauri::command]
fn set_reminder_text(title: String, body: String, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("reminder_title", &title)
        .map_err(|e| e.to_string())?;
    db.set_setting("reminder_body", &body)
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------------
// 全屏背景图：保存到磁盘文件，数据库只存路径
// ------------------------------------------------------------------

/// 解析 data URL，返回 (扩展名, 解码后的二进制数据)
fn parse_data_url(data_url: &str) -> Option<(String, Vec<u8>)> {
    let rest = data_url.strip_prefix("data:")?;
    let comma_idx = rest.find(',')?;
    let meta = &rest[..comma_idx];
    let b64_data = &rest[comma_idx + 1..];

    let mime = meta.split(';').next()?;
    let ext = match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "png",
    };

    let padded = match b64_data.len() % 4 {
        2 => format!("{}==", b64_data),
        3 => format!("{}=", b64_data),
        _ => b64_data.to_string(),
    };
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&padded)
        .ok()?;
    Some((ext.to_string(), decoded))
}

/// 将 data URL 保存为磁盘文件，返回文件路径
fn save_bg_image_to_disk(app_data_dir: &Path, data_url: &str) -> Result<String, String> {
    let (ext, bytes) =
        parse_data_url(data_url).ok_or_else(|| "Invalid data URL format".to_string())?;

    let bg_dir = app_data_dir.join("bg");
    fs::create_dir_all(&bg_dir).map_err(|e| e.to_string())?;

    remove_bg_image_from_disk(app_data_dir);

    let file_path = bg_dir.join(format!("fullscreen_bg.{}", ext));
    fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

/// 默认背景图编译进二进制，写入 app_data_dir/bg/，返回文件路径
fn ensure_default_bg(app_data_dir: &Path) -> Result<String, String> {
    let bg_dir = app_data_dir.join("bg");
    fs::create_dir_all(&bg_dir).map_err(|e| e.to_string())?;
    let dest = bg_dir.join("fullscreen_bg.png");
    if !dest.exists() {
        let bytes = include_bytes!("../assets/catrace.png");
        fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    }
    Ok(dest.to_string_lossy().to_string())
}

/// 删除磁盘上的背景图文件（只删文件，保留目录）
fn remove_bg_image_from_disk(app_data_dir: &Path) {
    let bg_dir = app_data_dir.join("bg");
    if bg_dir.exists() {
        if let Ok(entries) = fs::read_dir(&bg_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Err(e) = fs::remove_file(&path) {
                        log_error!("bg", "failed to delete {}: {}", path.display(), e);
                    }
                }
            }
        }
    }
}

/// 将磁盘上的图片文件读取为 data URL
fn file_path_to_data_url(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    if !path.exists() {
        log_warn!("bg", "file does NOT exist: {}", file_path);
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let ext = path.extension()?.to_str()?;
    let mime = match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime, encoded))
}

/// 将 DB 中存储的 bg 值（文件路径或 data URL）解析为 data URL
fn resolve_bg_for_frontend(raw: &str) -> Option<String> {
    if raw.is_empty() {
        None
    } else if raw.starts_with("data:") {
        Some(raw.to_string())
    } else {
        file_path_to_data_url(raw)
    }
}

#[tauri::command]
fn get_fullscreen_settings(db: tauri::State<db::Db>) -> serde_json::Value {
    let bg = db.get_setting("fullscreen_bg_image", "");
    let opacity: i64 = db
        .get_setting("fullscreen_opacity", "80")
        .parse()
        .unwrap_or(80);
    let fit_mode = db.get_setting("fullscreen_fit_mode", "contain");
    let element_transforms = db.get_setting("fullscreen_element_transforms", "");
    let bg_data_url = resolve_bg_for_frontend(&bg).unwrap_or_default();
    serde_json::json!({
        "bg_image": bg_data_url,
        "opacity": opacity,
        "fit_mode": fit_mode,
        "element_transforms": element_transforms,
    })
}

#[tauri::command]
fn set_fullscreen_settings(
    bg_image: String,
    opacity: i64,
    fit_mode: String,
    element_transforms: String,
    db: tauri::State<db::Db>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    if bg_image.is_empty() {
        remove_bg_image_from_disk(&app_data_dir);
        // 恢复默认背景图（bundled catrace.png）
        match ensure_default_bg(&app_data_dir) {
            Ok(default_path) => {
                db.set_setting("fullscreen_bg_image", &default_path)
                    .map_err(|e| e.to_string())?;
            }
            Err(e) => {
                log_error!("bg", "ensure_default_bg failed: {}, clearing setting", e);
                db.set_setting("fullscreen_bg_image", "")
                    .map_err(|e| e.to_string())?;
            }
        }
    } else if bg_image.starts_with("data:") {
        let file_path = save_bg_image_to_disk(&app_data_dir, &bg_image)?;
        db.set_setting("fullscreen_bg_image", &file_path)
            .map_err(|e| e.to_string())?;
    } else {
        db.set_setting("fullscreen_bg_image", &bg_image)
            .map_err(|e| e.to_string())?;
    }

    db.set_setting("fullscreen_opacity", &opacity.to_string())
        .map_err(|e| e.to_string())?;
    db.set_setting("fullscreen_fit_mode", &fit_mode)
        .map_err(|e| e.to_string())?;
    // 空字符串表示调用方不想修改元素变换（如 Settings.vue 只改背景/透明度/填充模式），
    // 此时保留已有值，避免覆盖用户在 ReminderFullscreen.vue 中调整的位置/缩放/旋转。
    if !element_transforms.is_empty() {
        db.set_setting("fullscreen_element_transforms", &element_transforms)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_mouse_position(state: tauri::State<Arc<Mutex<ActivityState>>>) -> (i32, i32) {
    state.lock().unwrap().last_cursor
}

#[tauri::command]
fn get_reminder_data(
    label: String,
    store: tauri::State<ReminderWindowStore>,
) -> Option<ReminderWindowData> {
    store.lock().unwrap().get(&label).cloned()
}

#[tauri::command]
fn close_reminder_window(
    label: String,
    app_handle: tauri::AppHandle,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        // Toast/Popup 复用窗口，隐藏而非关闭，避免下次创建时抢焦点
        if label == window_manager::TOAST_WINDOW_LABEL || label == window_manager::POPUP_WINDOW_LABEL {
            window_manager::hide_window_internal(&app_handle, &window);
        } else {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    if label == window_manager::FULLSCREEN_WINDOW_LABEL {
        fullscreen_active.store(false, Ordering::SeqCst);
    }
    Ok(())
}


/// Rest-timer toast via Event Bus (stable dedupe_key; upsert avoids flicker).
fn emit_rest_timer_event(
    bus: &crate::bus::EventBus,
    locale: &str,
    break_minutes: i64,
    rest_start_ts: i64,
    rest_streak: i64,
    remaining_minutes: i64,
    is_complete: bool,
) {
    use crate::event::{
        BusEvent, DisplayMode, EventLevel, EventProgress, EventSource, EventStatus,
    };

    let (title, body) = if is_complete {
        if locale == "zh-CN" {
            (
                "休息已完成".to_string(),
                format!("已连续休息 {rest_streak} 分钟"),
            )
        } else {
            (
                "Break Complete".to_string(),
                format!("Rested for {rest_streak} minutes"),
            )
        }
    } else if locale == "zh-CN" {
        (
            "休息计时".to_string(),
            format!("已连续休息 {rest_streak} 分钟，还需 {remaining_minutes} 分钟"),
        )
    } else {
        (
            "Rest Timer".to_string(),
            format!("Rested for {rest_streak} minutes, {remaining_minutes} minutes to go"),
        )
    };

    let progress = if break_minutes > 0 {
        Some(EventProgress {
            current: rest_streak as f64,
            total: break_minutes as f64,
            label: None,
        })
    } else {
        None
    };

    let event = BusEvent {
        id: String::new(),
        event_type: "reminder.rest.timer".into(),
        source: EventSource::Internal,
        kind: "rest-timer".into(),
        display_mode: DisplayMode::Toast,
        level: if is_complete {
            EventLevel::Success
        } else {
            EventLevel::Info
        },
        title,
        body,
        actions: vec![],
        progress,
        sticky: Some(true),
        payload: serde_json::json!({
            "break_minutes": break_minutes,
            "rest_start_ts": rest_start_ts,
            "rest_streak": rest_streak,
            "remaining_minutes": remaining_minutes,
            "is_complete": is_complete,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some("reminder.rest.timer".into()),
    };
    if let Err(e) = bus.upsert_by_dedupe_key(event) {
        log_error!("rest-timer", "bus upsert failed: {}", e);
    }
}

#[tauri::command]
fn test_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
    bus: tauri::State<crate::bus::EventBus>,
) {
    {
        let mut last = LAST_TEST_NOTIFICATION_AT.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < Duration::from_secs(1) {
                return;
            }
        }
        *last = Some(Instant::now());
    }

    let locale = db.get_setting("locale", "zh-CN");

    // Toast 模式：先走统一通知入口（bus 会 ensure 窗口），再补休息计时卡。
    // 不再在这里额外 show，避免与 bus 的 ensure_toast 并发抢 Win32 show。
    show_notification(
        &app_handle,
        0,
        test_notify_msg(&locale),
        state.inner().clone(),
        &locale,
        &db,
        &store,
        fullscreen_active.inner().clone(),
        &bus,
    );

    // 仅在 Toast 模式下追加/刷新休息计时测试卡片（走 bus，ensure 由 publish/update 负责）
    let reminder_mode = db.get_setting("reminder_mode", "toast");
    if reminder_mode == "toast" {
        let break_m: i64 = db.get_setting("break_minutes", "5").parse().unwrap_or(5);
        let now_ts = chrono::Local::now().timestamp();
        let rest_start_ts = (now_ts / 60) * 60;
        let rest_streak: i64 = std::cmp::min(3, break_m);
        let remaining_minutes = (break_m - rest_streak).max(0);
        let is_complete = rest_streak >= break_m;
        emit_rest_timer_event(
            &bus,
            &locale,
            break_m,
            rest_start_ts,
            rest_streak,
            remaining_minutes,
            is_complete,
        );
    }
}

#[tauri::command]
fn start_notification_test(
    interval_seconds: u64,
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
    test_state: tauri::State<Arc<NotificationTestState>>,
    bus: tauri::State<crate::bus::EventBus>,
) -> Result<(), String> {
    if interval_seconds == 0 {
        return Err("interval must be greater than 0".to_string());
    }
    if test_state.is_running() {
        return Ok(());
    }
    test_state.start();

    let app_handle = app_handle.clone();
    let state = state.inner().clone();
    let db = db.inner().clone();
    let store = store.inner().clone();
    let fullscreen_active = fullscreen_active.inner().clone();
    let test_state = test_state.inner().clone();
    let bus = bus.inner().clone();

    tauri::async_runtime::spawn(async move {
        let mut interval = interval(Duration::from_secs(interval_seconds));
        loop {
            interval.tick().await;
            if !test_state.is_running() {
                break;
            }
            let locale = db.get_setting("locale", "zh-CN");
            show_notification(
                &app_handle,
                0,
                test_notify_msg(&locale),
                state.clone(),
                &locale,
                &db,
                &store,
                fullscreen_active.clone(),
                &bus,
            );
        }
    });

    Ok(())
}

#[tauri::command]
fn stop_notification_test(test_state: tauri::State<Arc<NotificationTestState>>) {
    test_state.stop();
}

// ------------------------------------------------------------------
// 通知：统一入口（支持 toast / popup / fullscreen）
// ------------------------------------------------------------------

fn show_notification(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    default_body: &str,
    reminder_state: Arc<Mutex<ReminderState>>,
    locale: &str,
    db: &db::Db,
    store: &ReminderWindowStore,
    fullscreen_active: Arc<AtomicBool>,
    bus: &crate::bus::EventBus,
) {
    let mode = db.get_setting("reminder_mode", "toast");

    // 优先使用用户自定义文本，空则回退到 i18n 默认值
    let custom_title = db.get_setting("reminder_title", "");
    let custom_body = db.get_setting("reminder_body", "");
    let title = if custom_title.is_empty() {
        notify_title(locale).to_string()
    } else {
        custom_title
    };
    let body = if custom_body.is_empty() {
        default_body.to_string()
    } else {
        custom_body
    };

    match mode.as_str() {
        "popup" => {
            create_popup_window(app_handle, boundary, &title, &body, reminder_state, store);
        }
        "fullscreen" => {
            let break_m: i64 = db.get_setting("break_minutes", "5").parse().unwrap_or(5);
            let fullscreen_bg_raw = db.get_setting("fullscreen_bg_image", "");
            let fullscreen_bg_opt = resolve_bg_for_frontend(&fullscreen_bg_raw);
            let fullscreen_opacity: i64 = db
                .get_setting("fullscreen_opacity", "80")
                .parse()
                .unwrap_or(80);
            let fullscreen_fit_mode = db.get_setting("fullscreen_fit_mode", "contain");
            let fullscreen_element_transforms = db.get_setting("fullscreen_element_transforms", "");
            create_fullscreen_window(
                app_handle,
                boundary,
                &title,
                &body,
                break_m,
                fullscreen_bg_opt,
                fullscreen_opacity,
                fullscreen_fit_mode,
                fullscreen_element_transforms,
                reminder_state,
                store,
                fullscreen_active,
            );
        }
        _ => {
            // toast（默认）：只 publish 到 Event Bus，由 Toast 窗订阅渲染
            use crate::event::{
                BusEvent, DisplayMode, EventAction, EventLevel, EventSource, EventStatus,
            };
            let event = BusEvent {
                id: String::new(),
                event_type: "reminder.rest.due".into(),
                source: EventSource::Internal,
                kind: "rest".into(),
                display_mode: DisplayMode::Toast,
                level: EventLevel::Warning,
                title: title.clone(),
                body: body.clone(),
                actions: vec![
                    EventAction {
                        id: "snooze".into(),
                        label: if locale == "zh-CN" {
                            "稍后".into()
                        } else {
                            "Snooze".into()
                        },
                        payload: None,
                    },
                    EventAction {
                        id: "skip".into(),
                        label: if locale == "zh-CN" {
                            "跳过".into()
                        } else {
                            "Skip".into()
                        },
                        payload: None,
                    },
                ],
                progress: None,
                sticky: Some(false),
                payload: serde_json::json!({ "boundary": boundary }),
                created_at: 0,
                updated_at: 0,
                status: EventStatus::Active,
                revision: 0,
                resolved_at: None,
                resolution: None,
                expires_at: None,
                correlation_id: None,
                // 测试 boundary=0 允许堆叠；真实结算同 boundary 去重替换
                dedupe_key: if boundary == 0 {
                    None
                } else {
                    Some(format!("reminder.rest.due:{boundary}"))
                },
            };
            if let Err(e) = bus.publish(event) {
                log_error!("rest", "bus.publish failed: {}", e);
            }
        }
    }
}

fn create_popup_window(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    title: &str,
    body: &str,
    _reminder_state: Arc<Mutex<ReminderState>>,
    store: &ReminderWindowStore,
) {
    let label = window_manager::POPUP_WINDOW_LABEL;

    let data = ReminderWindowData {
        kind: "rest".to_string(),
        boundary,
        title: title.to_string(),
        body: body.to_string(),
        break_minutes: 0,
        fullscreen_bg: None,
        fullscreen_opacity: 0,
        fullscreen_fit_mode: String::new(),
        fullscreen_element_transforms: String::new(),
    };
    store.lock().unwrap().insert(label.to_string(), data);

    let app = app_handle.clone();

    // 计算弹窗位置：以主窗口为中心
    let position_popup = |window: &tauri::WebviewWindow| {
        if let Some(main) = window.app_handle().get_webview_window("main") {
            if let (Ok(pos), Ok(size), Ok(sf)) =
                (main.outer_position(), main.outer_size(), main.scale_factor())
            {
                let pw = 440.0;
                let ph = 300.0;
                let x = pos.x as f64 / sf + (size.width as f64 / sf - pw) / 2.0;
                let y = pos.y as f64 / sf + (size.height as f64 / sf - ph) / 2.0;
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }
        }
    };

    // 复用已有窗口
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.hide();
        position_popup(&window);
        window_manager::show_reminder_no_activate(app_handle, &window);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let _ = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup'; window.location.hash = '#/reminder-popup';");
        });
        return;
    }

    tauri::async_runtime::spawn(async move {
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("index.html#/reminder-popup".into()),
        )
        .title("Catrace")
        .inner_size(440.0, 300.0)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                position_popup(&window);
                window_manager::show_reminder_no_activate(&app, &window);

                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Err(e) = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup';") {
                    log_error!("popup-win", "eval failed: {}", e);
                }
            }
            Err(e) => {
                log_error!("popup-win", "build failed: {}", e);
            }
        }
    });
}

fn create_fullscreen_window(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    title: &str,
    body: &str,
    break_minutes: i64,
    fullscreen_bg: Option<String>,
    fullscreen_opacity: i64,
    fullscreen_fit_mode: String,
    fullscreen_element_transforms: String,
    _reminder_state: Arc<Mutex<ReminderState>>,
    store: &ReminderWindowStore,
    fullscreen_active: Arc<AtomicBool>,
) {
    let label = "reminder-fullscreen";

    // 标记全屏窗口已打开，结算循环将停止计活跃
    fullscreen_active.store(true, Ordering::SeqCst);

    let data = ReminderWindowData {
        kind: "rest".to_string(),
        boundary,
        title: title.to_string(),
        body: body.to_string(),
        break_minutes,
        fullscreen_bg,
        fullscreen_opacity,
        fullscreen_fit_mode,
        fullscreen_element_transforms,
    };
    store.lock().unwrap().insert(label.to_string(), data);

    let app = app_handle.clone();

    // 如果窗口已存在，复用它而不是关闭重建
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'fullscreen'; window.location.hash = '#/reminder-fullscreen';");
        });
        return;
    }

    tauri::async_runtime::spawn(async move {
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Catrace")
        .fullscreen(true)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                tokio::time::sleep(Duration::from_millis(300)).await;
                if let Err(e) = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'fullscreen'; window.location.hash = '#/reminder-fullscreen';") {
                    log_error!("fullscreen-win", "eval failed: {}", e);
                }
            }
            Err(e) => {
                log_error!("fullscreen-win", "build failed: {}", e);
            }
        }
    });
}

// ------------------------------------------------------------------
// 自动更新检查
// ------------------------------------------------------------------

async fn check_update_and_notify(
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let updater = app_handle
        .updater_builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    if let Some(update) = updater.check().await? {
        let version = update.version.clone();
        let changelog = update.body.clone().unwrap_or_default();
        reminder_toast::create_update_toast_window(app_handle, &version, &changelog);
    }
    Ok(())
}

// ------------------------------------------------------------------
// 主入口
// ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(ActivityState::default()));
    let reminder_state = Arc::new(Mutex::new(ReminderState::default()));
    let water_state = Arc::new(Mutex::new(WaterReminderState::default()));
    let input_sampling_started = Arc::new(AtomicBool::new(false));

    let reminder_state_clone = reminder_state.clone();
    let water_state_clone = water_state.clone();
    let eye_state = Arc::new(Mutex::new(EyeReminderState::default()));
    let eye_state_clone = eye_state.clone();
    let fullscreen_active = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(window_manager::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 单例模式：当用户尝试启动第二个实例时，聚焦到已有实例的主窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let settle_state = state.clone();

            // 初始化统一日志系统（写入本地文件）
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            log::init(&app_data_dir);

            // 初始化数据库
            let db_path = app_data_dir.join("catrace.db");
            let db = db::Db::new(&db_path).expect("Failed to initialize database");

            // 初始化事件总线
            let event_bus = crate::bus::EventBus::new(app.app_handle().clone());
            app.manage(event_bus);

            // Signal 采集内核（前台 1Hz 不依赖辅助功能；键鼠仍走 accessibility 门闩）
            let signal_core = Arc::new(signal::SignalCore::new());
            app.manage(signal_core.clone());
            signal::start_foreground_sampling(signal_core.clone());

            // 加载媒体排除白名单（Windows 音频检测使用）
            let media_whitelist = Arc::new(Mutex::new(media_audio::load_whitelist(&db)));
            app.manage(media_whitelist.clone());

            // 首次启动：将 bundled catrace.png 复制为默认全屏背景
            {
                let current_bg = db.get_setting("fullscreen_bg_image", "");
                if current_bg.is_empty() {
                    match ensure_default_bg(&app_data_dir) {
                        Ok(default_path) => {
                            let _ = db.set_setting("fullscreen_bg_image", &default_path);
                        }
                        Err(e) => log_error!("startup", "ensure_default_bg failed: {}", e),
                    }
                }
            }

            // 上报应用启动事件到 UpgradeLink
            report::spawn_report_app_start(app.app_handle().clone(), db.clone());

            let store: ReminderWindowStore = Arc::new(Mutex::new(HashMap::new()));
            app.manage(db.clone());
            app.manage(reminder_state_clone.clone());
            app.manage(water_state_clone.clone());
            app.manage(eye_state_clone.clone());
            app.manage(state.clone());
            app.manage(store.clone());
            app.manage(fullscreen_active.clone());
            app.manage(Arc::new(NotificationTestState::new()));

            if accessibility_permission_granted() {
                start_input_sampling(
                    state.clone(),
                    signal_core.clone(),
                    input_sampling_started.clone(),
                );
            } else {
                eprintln!(
                    "[accessibility] permission not granted; waiting to start input sampling"
                );
                let sampling_state = state.clone();
                let sampling_signal = signal_core.clone();
                let sampling_started = input_sampling_started.clone();
                thread::spawn(move || loop {
                    if sampling_started.load(Ordering::SeqCst) {
                        break;
                    }
                    if accessibility_permission_granted() {
                        start_input_sampling(
                            sampling_state.clone(),
                            sampling_signal.clone(),
                            sampling_started.clone(),
                        );
                        break;
                    }
                    thread::sleep(Duration::from_secs(3));
                });
            }

            // 预创建 Toast 窗口（隐藏），避免通知到达时动态创建抢焦点
            reminder_toast::prepare_toast_window(app.app_handle());

            // 启动 agent 通知 HTTP 服务（127.0.0.1:23456），接收 AI agent hook 事件
            agent_hook::start_server(app.app_handle().clone(), db.clone());
            // Event SDK HTTP API (127.0.0.1:23457) — external publish/update/resolve
            let event_bus_for_http = app.state::<crate::bus::EventBus>().inner().clone();
            event_http::start_server(event_bus_for_http, db.clone());
            // 启动后异步检查更新，若存在新版本则弹出更新 Toast
            let update_app_handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if UPDATE_CHECK_DONE.swap(true, Ordering::SeqCst) {
                    return;
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
                if let Err(e) = check_update_and_notify(&update_app_handle).await {
                    log_info!("update", "auto update check failed: {}", e);
                }
            });

            // 每分钟结算一次（在每分钟的00秒触发）
            let db_clone = db.clone();
            let app_handle = app.app_handle().clone();
            let reminder_state_for_settle = reminder_state_clone.clone();
            let water_state_for_settle = water_state_clone.clone();
            let eye_state_for_settle = eye_state_clone.clone();
            let store_for_settle = store.clone();
            let fullscreen_active_for_settle = fullscreen_active.clone();
            let media_whitelist_for_settle = media_whitelist.clone();
            let signal_for_settle = signal_core.clone();
            let event_bus_for_settle = app.state::<crate::bus::EventBus>().inner().clone();
            tauri::async_runtime::spawn(async move {
                // 计算距离下一个整分钟还有多少秒
                let now = chrono::Local::now();
                let seconds_until_next_minute = 60 - now.second();
                tokio::time::sleep(Duration::from_secs(seconds_until_next_minute as u64)).await;

                let mut minute = interval(Duration::from_secs(60));
                loop {
                    minute.tick().await;
                    // 在获取 settle_state 锁之前，先完成所有可能阻塞的系统调用。
                    // 如果 is_media_active() 卡住，不会阻塞键鼠计数线程。
                    // 前台应用改由 signal 1Hz 采样，settle 不再同步 get_active_window。
                    let media_enabled =
                        db_clone.get_setting("video_active_enabled", "true") == "true";
                    let media_active = if media_enabled {
                        let whitelist = media_whitelist_for_settle.lock().unwrap().clone();
                        is_media_active(&whitelist)
                    } else {
                        false
                    };
                    let is_fullscreen = fullscreen_active_for_settle.load(Ordering::SeqCst);
                    let timestamp = chrono::Local::now().timestamp() / 60 * 60;

                    // Drain completed signal minutes; use dominant app for this settle row.
                    let process_name = signal::persist_drained(
                        &db_clone,
                        &signal_for_settle,
                        timestamp,
                    )
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "unknown".to_string());

                    // 先短暂取出并清零键鼠计数，同时保存媒体/全屏快照，
                    // 后续写 DB、提醒、Toast 都不再持有 ActivityState 锁。
                    // 避免 Toast 定位读取同一个锁导致死锁。
                    let count = {
                        let mut s = settle_state.lock().unwrap();
                        let count = s.count;
                        s.count = 0;
                        // 保存快照，供 get_activity_snapshot 复用，避免前端轮询重复枚举音频会话
                        s.media_active_snapshot = media_active;
                        s.fullscreen_snapshot = is_fullscreen;
                        count
                    };

                    // 全屏提醒期间：鼠标键盘不计活跃，视为休息
                    let active = if is_fullscreen { false } else { count >= 3 || media_active };
                    log_info!("settle", "ts={} count={} media={} fscreen={} active={}",
                        timestamp, count, media_active, is_fullscreen, active);
                    if let Err(e) = db_clone.insert_record(timestamp, active, &process_name) {
                        log_error!("db", "Failed to write to database: {}", e);
                    }

                    // 读取配置
                    let window: i64 = db_clone
                        .get_setting("window_minutes", "45")
                        .parse()
                        .unwrap_or(45);
                    let break_m: i64 = db_clone
                        .get_setting("break_minutes", "5")
                        .parse()
                        .unwrap_or(5);
                    let locale = db_clone.get_setting("locale", "zh-CN");

                    // 提醒逻辑：
                    // 1. 当前分钟在休息 → 不提醒，同时清除 snooze
                    //    （用户已经开始自然休息，不需要再催）
                    // 2. 当前分钟在活跃 → 检查 should_notify，再经过 ReminderState 过滤：
                    //    · skip_until_boundary：用户点了「跳过本次」
                    //    · snooze_until：用户点了「5/10分钟后提醒」或自动间隔提醒
                    if active {
                        // 休息被打断，结束休息计时（前端 poll 已自行隐藏卡片，此处只清状态）
                        {
                            let mut r = reminder_state_for_settle.lock().unwrap();
                            r.break_timer_active = false;
                        }

                        match db_clone.check_should_notify(window, break_m) {
                            Ok((should_notify, boundary)) => {
                                let mut r = reminder_state_for_settle.lock().unwrap();

                                if should_notify {
                                    if let Some(b) = boundary {
                                        if r.is_skipped(b) || r.is_snoozed() {
                                            // 被用户操作过滤，不提醒，也不进入休息计时等待
                                            r.break_timer_active = false;
                                        } else {
                                            drop(r);
                                            show_notification(
                                                &app_handle,
                                                b,
                                                notify_body(&locale),
                                                reminder_state_for_settle.clone(),
                                                &locale,
                                                &db_clone,
                                                &store_for_settle,
                                                fullscreen_active_for_settle.clone(),
                                                &event_bus_for_settle,
                                            );
                                            // 自动设置下次提醒间隔（默认3分钟）
                                            let interval_m: i64 = db_clone
                                                .get_setting("snooze_interval_minutes", "3")
                                                .parse()
                                                .unwrap_or(3);
                                            let mut rs = reminder_state_for_settle.lock().unwrap();
                                            rs.snooze_until = Some(
                                                Instant::now()
                                                    + Duration::from_secs((interval_m * 60) as u64),
                                            );
                                            rs.break_timer_active = true;
                                        }
                                    }
                                }
                            }
                            Err(e) => log_error!("notify", "Notification check failed: {}", e),
                        }
                    } else {
                        // 当前分钟在休息 → 清除 snooze，不提醒
                        let mut r = reminder_state_for_settle.lock().unwrap();
                        r.snooze_until = None;

                        // 如果正在等待有效休息，推送倒计时状态到 Event Bus → Toast
                        if r.break_timer_active {
                            drop(r);
                            if let Ok((rest_streak, rest_start_ts)) = db_clone.get_current_rest_streak() {
                                let remaining = (break_m - rest_streak as i64).max(0);
                                let is_complete = rest_streak as i64 >= break_m;
                                emit_rest_timer_event(
                                    &event_bus_for_settle,
                                    &locale,
                                    break_m,
                                    rest_start_ts,
                                    rest_streak as i64,
                                    remaining,
                                    is_complete,
                                );
                            }
                        }
                    }

                    // 喝水提醒逻辑（仅在当前分钟活跃时检查）
                    if active {
                        water::check_and_notify(
                            &db_clone,
                            &water_state_for_settle,
                            &locale,
                            &event_bus_for_settle,
                        );

                        // 护眼提醒逻辑（仅在当前分钟活跃时检查）
                        eye::check_and_notify(
                            break_m,
                            &db_clone,
                            &eye_state_for_settle,
                            &locale,
                            &event_bus_for_settle,
                        );
                    }
                }
            });

            // 主窗口：静默启动时隐藏，拦截关闭事件改为最小化到托盘
            let window = app.get_webview_window("main").unwrap();
            let args: Vec<String> = std::env::args().collect();
            let is_autostart = args.contains(&"--autostart".to_string());
            let silent_start = db.get_setting("silent_start", "false") == "true";
            if is_autostart && silent_start {
                let _ = window.hide();
            }

            let win_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = win_clone.hide();
                }
            });

            // 系统托盘：先移除可能已存在的旧图标，防止重复创建
            let _ = app.remove_tray_by_id("main");

            let locale = db.get_setting("locale", "zh-CN");
            let show_i = MenuItem::with_id(app, "show", tray_show(&locale), true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", tray_quit(&locale), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            skip_reminder,
            snooze_reminder,
            get_silent_start,
            set_silent_start,
            get_hide_stats,
            set_hide_stats,
            get_locale,
            set_locale,
            get_platform,
            get_accessibility_permission_status,
            request_accessibility_permission,
            get_media_active_enabled,
            set_media_active_enabled,
            get_media_whitelist_text,
            set_media_whitelist_text,
            get_toast_debug_mode,
            set_toast_debug_mode,
            open_logs_dir,
            log_frontend,
            show_main_window,
            hide_main_window,
            get_today_stats,
            get_today_records,
            get_app_stats,
            test_notification,
            start_notification_test,
            stop_notification_test,
            water::test_water_notification,
            eye::get_eye_settings,
            eye::set_eye_settings,
            eye::test_eye_notification,
            eye::snooze_eye_reminder,
            eye::skip_eye_reminder,
            get_media_debug_info,
            get_activity_snapshot,
            dismiss_rest_timer,
            get_reminder_mode,
            set_reminder_mode,
            get_reminder_text,
            set_reminder_text,
            get_fullscreen_settings,
            set_fullscreen_settings,
            get_mouse_position,
            get_reminder_data,
            close_reminder_window,
            water::get_water_settings,
            water::set_water_settings,
            water::record_water,
            water::get_water_stats,
            water::get_water_records,
            water::delete_last_water,
            water::snooze_water_reminder,
            water::skip_water_reminder,
            agent_hook::get_agent_notification_enabled,
            agent_hook::set_agent_notification_enabled,
            agent_hook::get_agent_event_modes,
            agent_hook::set_agent_event_mode,
            agent_hook::get_supported_agents,
            agent_hook::install_agent_hooks,
            agent_hook::uninstall_agent_hooks,
            agent_hook::is_agent_hook_installed,
            agent_hook::open_agent_session,
            agent_hook::resolve_permission,
            agent_hook::get_agent_sound_settings,
            agent_hook::set_agent_sound_settings,
            agent_hook::get_agent_sound_data_url,
            crate::bus::publish_event,
            crate::bus::update_event,
            crate::bus::resolve_event,
            crate::bus::resolve_event_action,
            crate::bus::get_active_events,
            event_http::get_event_sdk_status,
            event_http::set_event_sdk_enabled,
            event_http::rotate_event_sdk_token,
            signal::set_signal_key_sequence_enabled,
            signal::set_signal_key_sequence_retention_hours,
            signal::get_signal_runtime_config,
            signal::purge_key_sequences,
            signal::get_recent_signal_minutes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
