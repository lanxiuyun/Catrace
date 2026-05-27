mod db;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use device_query::{DeviceQuery, DeviceState};
use rdev::{listen, EventType};
use active_win_pos_rs::get_active_window;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_notification::NotificationExt;
use tokio::time::interval;
// 窗口状态由 tauri-plugin-window-state 自动管理（启动恢复 / 退出保存）

// ------------------------------------------------------------------
// 视频/流媒体检测
// ------------------------------------------------------------------

/// 回退方案：通过窗口标题 + 进程名关键词匹配判断是否正在播放视频。
/// 返回 (是否匹配, 匹配到的关键词, 窗口标题, 应用名, 进程路径)
fn check_media_active_by_keywords() -> (bool, Option<String>, String, String, String) {
    match get_active_window() {
        Ok(win) => {
            let title_lower = win.title.to_lowercase();
            let app_name_lower = win.app_name.to_lowercase();
            let path_lower = win.process_path.to_string_lossy().to_lowercase();

            let video_site_keywords = [
                "youtube", "bilibili", "netflix", "twitch",
                "爱奇艺", "腾讯视频", "优酷", "芒果tv",
                "disney+", "hbo max", "prime video", "hulu",
                "crunchyroll", "niconico", "dailymotion", "vimeo",
                "live", "直播",
            ];
            let video_player_keywords = [
                "vlc", "mpv", "potplayer", "mpc-hc", "mpc-be",
                "kmplayer", "gom", "mx player", "infuse",
                "iina", "quicktime", "movies & tv", "电影和电视",
                "windows media player", "媒体播放器",
            ];

            let matched_site = video_site_keywords
                .iter()
                .find(|&&k| title_lower.contains(k))
                .copied();
            let matched_player = video_player_keywords
                .iter()
                .find(|&&k| app_name_lower.contains(k) || path_lower.contains(k))
                .copied();

            let matched = matched_site.or(matched_player).map(|s| s.to_string());
            let is_match = matched.is_some();
            (
                is_match,
                matched,
                win.title,
                win.app_name,
                win.process_path.to_string_lossy().to_string(),
            )
        }
        Err(_) => (
            false,
            None,
            "Unknown".to_string(),
            "Unknown".to_string(),
            "Unknown".to_string(),
        ),
    }
}

fn is_media_active_by_keywords() -> bool {
    check_media_active_by_keywords().0
}

// ---------- 调试结构体 ----------

#[derive(serde::Serialize)]
struct MediaSessionInfo {
    title: String,
    artist: String,
    status: String,
    playback_type: String,
}

#[derive(serde::Serialize)]
struct VideoDebugInfo {
    gsmtcsm_available: bool,
    gsmtcsm_session_count: u32,
    gsmtcsm_sessions: Vec<MediaSessionInfo>,
    gsmtcsm_has_playing: bool,
    gsmtcsm_error: Option<String>,

    focus_window_title: String,
    focus_app_name: String,
    focus_process_path: String,

    keyword_matched: bool,
    matched_keyword: Option<String>,

    media_active: bool,
    mouse_keyboard_count: u32,
}

// ---------- Windows 视频检测 ----------

/// Windows：优先使用系统媒体会话（GSMTCSM）判定。
/// - GSMTCSM API 可用时，完全信任其结果（有 Playing 即活跃，无则不活跃），不再回退关键词匹配。
/// - GSMTCSM 调用失败时才回退到窗口标题+进程名关键词匹配。
#[cfg(windows)]
fn is_media_active() -> bool {
    match try_media_session_active() {
        Some(active) => active,
        None => is_media_active_by_keywords(),
    }
}

/// 尝试通过 GSMTCSM 获取媒体播放状态。
/// 返回 `Some(true)` 表示有会话在 Playing；
/// 返回 `Some(false)` 表示 API 可用但无 Playing 会话；
/// 返回 `None` 表示 API 调用失败（此时应回退关键词匹配）。
#[cfg(windows)]
fn try_media_session_active() -> Option<bool> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let Ok(async_op) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() else {
        return None;
    };
    let Ok(manager) = async_op.get() else {
        return None;
    };
    let Ok(sessions) = manager.GetSessions() else {
        return None;
    };
    let Ok(count) = sessions.Size() else {
        return None;
    };

    for i in 0..count {
        let Ok(session) = sessions.GetAt(i) else { continue };
        let Ok(playback_info) = session.GetPlaybackInfo() else { continue };
        let Ok(status) = playback_info.PlaybackStatus() else { continue };

        if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
            return Some(true);
        }
    }

    Some(false)
}

/** Windows：获取系统媒体会话的详细调试信息。
 * 返回 (是否有 Playing 会话, 会话详情列表)。
 * 用于 Debug 页面展示，不用于正式活跃判定。 */
#[cfg(windows)]
fn get_media_sessions_debug() -> Result<(bool, Vec<MediaSessionInfo>), Box<dyn std::error::Error>> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Media::MediaPlaybackType;

    let async_op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?;
    let manager = async_op.get()?;
    let sessions = manager.GetSessions()?;
    let count = sessions.Size()?;

    let mut has_playing = false;
    let mut infos = Vec::new();

    for i in 0..count {
        let session = sessions.GetAt(i)?;
        let playback_info = session.GetPlaybackInfo()?;
        let status = playback_info.PlaybackStatus()?;

        let status_str = match status {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "Playing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "Paused",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "Stopped",
            _ => "Other",
        }
        .to_string();

        if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
            has_playing = true;
        }

        let mut title = "Unknown".to_string();
        let mut artist = "Unknown".to_string();
        let mut playback_type = "Unknown".to_string();

        if let Ok(props_async) = session.TryGetMediaPropertiesAsync() {
            if let Ok(props) = props_async.get() {
                title = props.Title().unwrap_or_default().to_string();
                artist = props.Artist().unwrap_or_default().to_string();
                if let Ok(type_ref) = props.PlaybackType() {
                    if let Ok(pt) = type_ref.Value() {
                        playback_type = match pt {
                            MediaPlaybackType::Video => "Video",
                            MediaPlaybackType::Music => "Music",
                            _ => "Other",
                        }
                        .to_string();
                    }
                }
            }
        }

        infos.push(MediaSessionInfo {
            title,
            artist,
            status: status_str,
            playback_type,
        });
    }

    Ok((has_playing, infos))
}

/// 非 Windows：直接走关键词匹配
#[cfg(not(windows))]
fn is_media_active() -> bool {
    is_media_active_by_keywords()
}

#[cfg(windows)]
use tauri_winrt_notification::Toast;


#[derive(Default)]
struct ActivityState {
    count: u32,
    last_cursor: (i32, i32),
    key_debounce: Option<Instant>,
}

/// 提醒状态机（进程级，重启后重置）
#[derive(Default)]
struct ReminderState {
    /// 推迟提醒直到该时刻
    snooze_until: Option<Instant>,
    /// 跳过本次提醒直到该 block boundary（时间戳）
    skip_until_boundary: Option<i64>,
}

impl ReminderState {
    fn is_snoozed(&self) -> bool {
        self.snooze_until.map_or(false, |t| t > Instant::now())
    }

    fn is_skipped(&self, boundary: i64) -> bool {
        self.skip_until_boundary.map_or(false, |b| b >= boundary)
    }
}

/** 获取视频检测的实时调试信息，供 Debug 页面展示。 */
#[tauri::command]
fn get_video_debug_info(
    activity: tauri::State<Arc<Mutex<ActivityState>>>,
) -> VideoDebugInfo {
    let mouse_keyboard_count = activity.lock().unwrap().count;

    #[cfg(windows)]
    let (gsmtcsm_available, gsmtcsm_session_count, gsmtcsm_sessions, gsmtcsm_has_playing, gsmtcsm_error) =
        match get_media_sessions_debug() {
            Ok((has_playing, sessions)) => (
                true,
                sessions.len() as u32,
                sessions,
                has_playing,
                None,
            ),
            Err(e) => (false, 0, Vec::new(), false, Some(e.to_string())),
        };

    #[cfg(not(windows))]
    let (gsmtcsm_available, gsmtcsm_session_count, gsmtcsm_sessions, gsmtcsm_has_playing, gsmtcsm_error) = (
        false,
        0,
        Vec::new(),
        false,
        Some("GSMTCSM 仅在 Windows 可用".to_string()),
    );

    let (keyword_matched, matched_keyword, focus_title, focus_app, focus_path) =
        check_media_active_by_keywords();

    let media_active = if cfg!(windows) && gsmtcsm_available {
        gsmtcsm_has_playing
    } else {
        keyword_matched
    };

    VideoDebugInfo {
        gsmtcsm_available,
        gsmtcsm_session_count,
        gsmtcsm_sessions,
        gsmtcsm_has_playing,
        gsmtcsm_error,
        focus_window_title: focus_title,
        focus_app_name: focus_app,
        focus_process_path: focus_path,
        keyword_matched,
        matched_keyword,
        media_active,
        mouse_keyboard_count,
    }
}

/** 获取「视频计入活跃」开关状态（默认 true）。 */
#[tauri::command]
fn get_video_active_enabled(db: tauri::State<db::Db>) -> bool {
    db.get_setting("video_active_enabled", "true") == "true"
}

/** 设置「视频计入活跃」开关状态。 */
#[tauri::command]
fn set_video_active_enabled(enabled: bool, db: tauri::State<db::Db>) -> Result<(), String> {
    db.set_setting("video_active_enabled", &enabled.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config(db: tauri::State<db::Db>) -> serde_json::Value {
    let window: i64 = db.get_setting("window_minutes", "45").parse().unwrap_or(45);
    let break_m: i64 = db.get_setting("break_minutes", "5").parse().unwrap_or(5);
    serde_json::json!({ "window_minutes": window, "break_minutes": break_m })
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
    Ok(())
}

#[tauri::command]
fn skip_reminder(boundary: i64, state: tauri::State<Arc<Mutex<ReminderState>>>) {
    let mut s = state.lock().unwrap();
    s.skip_until_boundary = Some(boundary);
    s.snooze_until = None;
}

#[tauri::command]
fn snooze_reminder(minutes: u64, state: tauri::State<Arc<Mutex<ReminderState>>>) {
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(minutes * 60));
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
    db.get_records_since(start_of_day).map_err(|e| e.to_string())
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
fn test_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
) {
    show_notification(&app_handle, 0, "这是一条测试提醒", state.inner().clone());
}



// ------------------------------------------------------------------
// 通知：Windows Toast（带按钮）
// ------------------------------------------------------------------

#[cfg(windows)]
fn show_notification(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    message: &str,
    reminder_state: Arc<Mutex<ReminderState>>,
) {
    let app = app_handle.clone();
    let aumid = app_handle.config().identifier.clone();
    let state = reminder_state;
    let b = boundary;
    let msg = message.to_string();

    // Toast 通知需要在主线程（STA）上创建，否则 on_activated 回调收不到事件
    if let Err(e) = app.run_on_main_thread(move || {
        let toast = Toast::new(&aumid)
            .title("休息提醒")
            .text1(&msg)
            .add_button("3分钟后提醒", "snooze_3")
            .add_button("5分钟后提醒", "snooze_5")
            .add_button("跳过本次", "skip")
            .on_activated(move |action| {
                eprintln!("[Toast] 按钮点击: {:?}", action);
                let mut s = state.lock().unwrap();
                match action.as_deref() {
                    Some("snooze_3") => {
                        s.snooze_until = Some(Instant::now() + Duration::from_secs(3 * 60));
                    }
                    Some("snooze_5") => {
                        s.snooze_until = Some(Instant::now() + Duration::from_secs(5 * 60));
                    }
                    Some("skip") => {
                        s.skip_until_boundary = Some(b);
                        s.snooze_until = None;
                    }
                    _ => {}
                }
                Ok(())
            });

        if let Err(e) = toast.show() {
            eprintln!("Toast 通知发送失败 (AUMID={}): {}", aumid, e);
        } else {
            eprintln!("[Toast] 通知已发送: AUMID={}", aumid);
        }
    }) {
        eprintln!("调度 Toast 到主线程失败: {}", e);
    }
}

#[cfg(not(windows))]
fn show_notification(
    app_handle: &tauri::AppHandle,
    _boundary: i64,
    message: &str,
    _reminder_state: Arc<Mutex<ReminderState>>,
) {
    if let Err(e) = app_handle.notification().builder()
        .title("休息提醒")
        .body(message)
        .show()
    {
        eprintln!("通知发送失败: {}", e);
    }
}

#[cfg(windows)]
fn register_aumid(aumid: &str, app_name: &str) -> Result<(), Box<dyn std::error::Error>> {
    use windows_registry::CURRENT_USER;
    let key = CURRENT_USER.create(format!(r"SOFTWARE\Classes\AppUserModelId\{}", aumid))?;
    key.set_string("DisplayName", app_name)?;
    key.set_string("IconBackgroundColor", "0")?;
    Ok(())
}

// ------------------------------------------------------------------
// 主入口
// ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(ActivityState::default()));
    let reminder_state = Arc::new(Mutex::new(ReminderState::default()));

    // 键盘监听线程（rdev 会阻塞，必须独立线程）
    let keyboard_state = state.clone();
    thread::spawn(move || {
        listen(move |event| {
            if let EventType::KeyPress(_) = event.event_type {
                let mut s = keyboard_state.lock().unwrap();
                if s.key_debounce.map_or(true, |t| t.elapsed() > Duration::from_secs(2)) {
                    s.count += 1;
                    s.key_debounce = Some(Instant::now());
                }
            }
        })
        .expect("键盘监听启动失败");
    });

    let reminder_state_clone = reminder_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            // 注册 AUMID，让 Windows Toast 通知显示为应用名称
            #[cfg(windows)]
            {
                let aumid = app.config().identifier.clone();
                let app_name = app.config().product_name.clone().unwrap_or_else(|| "Catrace".to_string());
                if let Err(e) = register_aumid(&aumid, &app_name) {
                    eprintln!("AUMID 注册失败: {}", e);
                }
            }

            let mouse_state = state.clone();
            let settle_state = state.clone();

            // 初始化数据库
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("catrace.db");
            let db = db::Db::new(&db_path).expect("数据库初始化失败");
            app.manage(db.clone());
            app.manage(reminder_state_clone.clone());
            app.manage(state.clone());

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

            // 每分钟结算一次
            let db_clone = db.clone();
            let app_handle = app.app_handle().clone();
            let reminder_state_for_settle = reminder_state_clone.clone();
            tauri::async_runtime::spawn(async move {
                let mut minute = interval(Duration::from_secs(60));
                loop {
                    minute.tick().await;
                    let mut s = settle_state.lock().unwrap();
                    let video_enabled = db_clone.get_setting("video_active_enabled", "true") == "true";
                    let media_active = if video_enabled { is_media_active() } else { false };
                    let active = s.count >= 3 || media_active;
                    let timestamp = chrono::Local::now().timestamp() / 60 * 60;

                    let process_name = match get_active_window() {
                        Ok(win) => std::path::Path::new(&win.process_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string(),
                        Err(_) => "unknown".to_string(),
                    };
                    if let Err(e) = db_clone.insert_record(timestamp, active, &process_name) {
                        eprintln!("写入数据库失败: {}", e);
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

                    // 提醒逻辑：
                    // 1. 当前分钟在休息 → 不提醒，同时清除 snooze
                    //    （用户已经开始自然休息，不需要再催）
                    // 2. 当前分钟在活跃 → 检查 should_notify，再经过 ReminderState 过滤：
                    //    · skip_until_boundary：用户点了「跳过本次」
                    //    · snooze_until：用户点了「3/5分钟后提醒」
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
                                                "连续活跃过久，该休息啦",
                                                reminder_state_for_settle.clone(),
                                            );
                                        }
                                    }
                                }
                            }
                            Err(e) => eprintln!("检测失败: {}", e),
                        }
                    } else {
                        // 当前分钟在休息 → 清除 snooze，不提醒
                        let mut r = reminder_state_for_settle.lock().unwrap();
                        r.snooze_until = None;
                    }

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

            let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
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
            get_config, set_config,
            skip_reminder, snooze_reminder,
            get_silent_start, set_silent_start,
            get_video_active_enabled, set_video_active_enabled,
            show_main_window, hide_main_window,
            get_today_stats, get_today_records, get_app_stats,
            test_notification,
            get_video_debug_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
