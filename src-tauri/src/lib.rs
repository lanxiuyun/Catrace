mod db;
mod media_audio;
mod reminder;
mod reminder_toast;
mod report;
mod water;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use active_win_pos_rs::get_active_window;
use base64::Engine;
use chrono::Timelike;
use device_query::{DeviceQuery, DeviceState};
#[cfg(not(target_os = "macos"))]
use rdev::{listen, EventType};
use std::fs;
use std::path::Path;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tokio::time::interval;
// 窗口状态由 tauri-plugin-window-state 自动管理（启动恢复 / 退出保存）

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
}

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

/** 获取 Toast 调试模式开关状态（默认 false）。 */
#[tauri::command]
fn get_toast_debug_mode(db: tauri::State<db::Db>) -> bool {
    db.get_setting("toast_debug_mode", "false") == "true"
}

/** 设置 Toast 调试模式开关状态。 */
#[tauri::command]
fn set_toast_debug_mode(enabled: bool, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("toast_debug_mode", &enabled.to_string())
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
    // 用户操作后恢复正常活动追踪
    fullscreen_active.store(false, Ordering::SeqCst);
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
                        eprintln!(
                            "[remove_bg_image_from_disk] failed to delete {}: {}",
                            path.display(),
                            e
                        );
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
        eprintln!("[file_path_to_data_url] file does NOT exist: {}", file_path);
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
                eprintln!(
                    "[set_fullscreen_settings] ensure_default_bg failed: {}, clearing setting",
                    e
                );
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
        window.close().map_err(|e| e.to_string())?;
    }
    if label == "reminder-fullscreen" {
        fullscreen_active.store(false, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn test_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
) {
    let locale = db.get_setting("locale", "zh-CN");
    show_notification(
        &app_handle,
        0,
        test_notify_msg(&locale),
        state.inner().clone(),
        &locale,
        &db,
        &store,
        fullscreen_active.inner().clone(),
    );
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
            // toast（默认）：使用右下角自定义 Vue 通知窗口
            reminder_toast::create_toast_window(app_handle, boundary, &title, &body, "rest", store);
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
    let label = "reminder-popup";

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

    // 如果窗口已存在，复用它而不是关闭重建
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.hide();
        if let Some(main) = app_handle.get_webview_window("main") {
            if let (Ok(pos), Ok(size), Ok(sf)) = (
                main.outer_position(),
                main.outer_size(),
                main.scale_factor(),
            ) {
                let pw = 440.0;
                let ph = 300.0;
                let x = pos.x as f64 / sf + (size.width as f64 / sf - pw) / 2.0;
                let y = pos.y as f64 / sf + (size.height as f64 / sf - ph) / 2.0;
                let _ =
                    window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }
        }
        let _ = window.show();
        let _ = window.set_focus();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup'; window.location.hash = '#/reminder-popup';");
        });
        return;
    }

    let _url = tauri::WebviewUrl::App("index.html".into());

    tauri::async_runtime::spawn(async move {
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("index.html?reminder=popup".into()),
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
                if let Some(main) = app.get_webview_window("main") {
                    if let (Ok(pos), Ok(size), Ok(sf)) = (
                        main.outer_position(),
                        main.outer_size(),
                        main.scale_factor(),
                    ) {
                        let pw = 440.0;
                        let ph = 300.0;
                        let x = pos.x as f64 / sf + (size.width as f64 / sf - pw) / 2.0;
                        let y = pos.y as f64 / sf + (size.height as f64 / sf - ph) / 2.0;
                        let _ =
                            window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                                x,
                                y,
                            }));
                    }
                }
                let _ = window.show();

                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Err(e) = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup';") {
                    eprintln!("[PopupWindow] eval failed: {}", e);
                }
            }
            Err(e) => {
                eprintln!("[PopupWindow] build failed: {}", e);
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
                    eprintln!("[FullscreenWindow] eval failed: {}", e);
                }
            }
            Err(e) => {
                eprintln!("[FullscreenWindow] build failed: {}", e);
            }
        }
    });
}

// ------------------------------------------------------------------
// 主入口
// ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(ActivityState::default()));
    let reminder_state = Arc::new(Mutex::new(ReminderState::default()));
    let water_state = Arc::new(Mutex::new(WaterReminderState::default()));

    // 键盘监听线程
    // macOS：rdev 在解析按键名称时会调用 TISGetInputSourceProperty，
    // 该 API 在非主线程/某些输入法下会崩溃（Narsil/rdev #103 #146）。
    // 因此 macOS 改用 device_query 的事件回调，仅检测按键发生而不解析字符。
    #[cfg(target_os = "macos")]
    {
        use device_query::{DeviceEvents, DeviceState, Keycode};
        let keyboard_state = state.clone();
        thread::spawn(move || {
            let device_state = DeviceState::new();
            let _guard = device_state.on_key_down(move |_: &Keycode| {
                let mut s = keyboard_state.lock().unwrap();
                if s.key_debounce
                    .map_or(true, |t| t.elapsed() > Duration::from_secs(2))
                {
                    s.count += 1;
                    s.key_debounce = Some(Instant::now());
                }
            });
            loop {
                thread::sleep(Duration::from_secs(60));
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let keyboard_state = state.clone();
        thread::spawn(move || {
            listen(move |event| {
                if let EventType::KeyPress(_) = event.event_type {
                    let mut s = keyboard_state.lock().unwrap();
                    if s.key_debounce
                        .map_or(true, |t| t.elapsed() > Duration::from_secs(2))
                    {
                        s.count += 1;
                        s.key_debounce = Some(Instant::now());
                    }
                }
            })
            .expect("Failed to start keyboard listener");
        });
    }

    let reminder_state_clone = reminder_state.clone();
    let water_state_clone = water_state.clone();
    let fullscreen_active = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            let mouse_state = state.clone();
            let settle_state = state.clone();

            // 初始化数据库
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("catrace.db");
            let db = db::Db::new(&db_path).expect("Failed to initialize database");

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
                        Err(e) => eprintln!("[startup] ensure_default_bg failed: {}", e),
                    }
                }
            }

            // 上报应用启动事件到 UpgradeLink
            report::spawn_report_app_start(app.app_handle().clone(), db.clone());

            let store: ReminderWindowStore = Arc::new(Mutex::new(HashMap::new()));
            app.manage(db.clone());
            app.manage(reminder_state_clone.clone());
            app.manage(water_state_clone.clone());
            app.manage(state.clone());
            app.manage(store.clone());
            app.manage(fullscreen_active.clone());

            // 每 2 秒采样鼠标位置（同步线程：DeviceState 在 Linux 上非 Send，不能放 async）
            thread::spawn(move || {
                let device_state = DeviceState::new();
                loop {
                    thread::sleep(Duration::from_secs(2));
                    let mouse = device_state.get_mouse();
                    let (x, y) = mouse.coords;
                    let mut s = mouse_state.lock().unwrap();
                    if (x, y) != s.last_cursor {
                        s.count += 1;
                        s.last_cursor = (x, y);
                    }
                }
            });

            // 每分钟结算一次（在每分钟的00秒触发）
            let db_clone = db.clone();
            let app_handle = app.app_handle().clone();
            let reminder_state_for_settle = reminder_state_clone.clone();
            let water_state_for_settle = water_state_clone.clone();
            let store_for_settle = store.clone();
            let fullscreen_active_for_settle = fullscreen_active.clone();
            let media_whitelist_for_settle = media_whitelist.clone();
            tauri::async_runtime::spawn(async move {
                // 计算距离下一个整分钟还有多少秒
                let now = chrono::Local::now();
                let seconds_until_next_minute = 60 - now.second();
                tokio::time::sleep(Duration::from_secs(seconds_until_next_minute as u64)).await;

                let mut minute = interval(Duration::from_secs(60));
                loop {
                    minute.tick().await;
                    // 在获取 settle_state 锁之前，先完成所有可能阻塞的系统调用。
                    // 如果 is_media_active() 或 get_active_window() 卡住，不会阻塞键鼠计数线程。
                    let media_enabled =
                        db_clone.get_setting("video_active_enabled", "true") == "true";
                    let media_active = if media_enabled {
                        let whitelist = media_whitelist_for_settle.lock().unwrap().clone();
                        is_media_active(&whitelist)
                    } else {
                        false
                    };
                    let is_fullscreen = fullscreen_active_for_settle.load(Ordering::SeqCst);
                    let process_name = match get_active_window() {
                        Ok(win) => std::path::Path::new(&win.process_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string(),
                        Err(_) => "unknown".to_string(),
                    };
                    let timestamp = chrono::Local::now().timestamp() / 60 * 60;

                    let mut s = settle_state.lock().unwrap();
                    // 全屏提醒期间：鼠标键盘不计活跃，视为休息
                    let active = if is_fullscreen {
                        false
                    } else {
                        s.count >= 3 || media_active
                    };
                    if let Err(e) = db_clone.insert_record(timestamp, active, &process_name) {
                        eprintln!("Failed to write to database: {}", e);
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
                        match db_clone.check_should_notify(window, break_m) {
                            Ok((should_notify, boundary)) => {
                                let r = reminder_state_for_settle.lock().unwrap();

                                if should_notify {
                                    if let Some(b) = boundary {
                                        if r.is_skipped(b) || r.is_snoozed() {
                                            // 被用户操作过滤，不提醒
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
                                        }
                                    }
                                }
                            }
                            Err(e) => eprintln!("Notification check failed: {}", e),
                        }
                    } else {
                        // 当前分钟在休息 → 清除 snooze，不提醒
                        let mut r = reminder_state_for_settle.lock().unwrap();
                        r.snooze_until = None;
                    }

                    // 喝水提醒逻辑（仅在当前分钟活跃时检查）
                    water::check_and_notify(
                        active,
                        &db_clone,
                        &water_state_for_settle,
                        &app_handle,
                        &locale,
                        &store_for_settle,
                    );

                    s.count = 0;
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
            get_media_active_enabled,
            set_media_active_enabled,
            get_media_whitelist_text,
            set_media_whitelist_text,
            get_toast_debug_mode,
            set_toast_debug_mode,
            show_main_window,
            hide_main_window,
            get_today_stats,
            get_today_records,
            get_app_stats,
            test_notification,
            water::test_water_notification,
            get_media_debug_info,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
