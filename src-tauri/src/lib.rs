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

#[derive(Default)]
struct ActivityState {
    count: u32,
    last_cursor: (i32, i32),
    key_debounce: Option<Instant>,
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

fn start_of_day_with_offset(offset_days: i64) -> i64 {
    let now = chrono::Local::now();
    let target = now + chrono::Duration::days(offset_days);
    target
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(chrono::Local)
        .unwrap()
        .timestamp()
}

#[tauri::command]
fn get_today_stats(db: tauri::State<db::Db>) -> Result<serde_json::Value, String> {
    let (active, rest) = db.get_today_stats().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "active_minutes": active, "rest_minutes": rest }))
}

#[tauri::command]
fn get_day_stats(offset_days: i64, db: tauri::State<db::Db>) -> Result<serde_json::Value, String> {
    let start = start_of_day_with_offset(offset_days);
    let (active, rest) = db.get_day_stats(start).map_err(|e| e.to_string())?;
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
fn get_day_records(offset_days: i64, db: tauri::State<db::Db>) -> Result<Vec<(i64, bool)>, String> {
    let start = start_of_day_with_offset(offset_days);
    let end = start + 86400;
    let all = db.get_records_since(start).map_err(|e| e.to_string())?;
    Ok(all.into_iter().filter(|(ts, _)| *ts < end).collect())
}

#[tauri::command]
fn get_app_stats(db: tauri::State<db::Db>) -> Result<Vec<(String, i64)>, String> {
    db.get_app_stats().map_err(|e| e.to_string())
}

#[tauri::command]
fn test_notification(app_handle: tauri::AppHandle) -> Result<(), String> {
    app_handle.notification().builder()
        .title("测试通知")
        .body("Catrace 通知正常工作")
        .show()
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(ActivityState::default()));

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let mouse_state = state.clone();
            let settle_state = state.clone();

            // 初始化数据库
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("catrace.db");
            let db = db::Db::new(&db_path).expect("数据库初始化失败");
            app.manage(db.clone());

            // 每 2 秒采样鼠标位置
            tauri::async_runtime::spawn(async move {
                let device_state = DeviceState::new();
                let mut ticker = interval(Duration::from_secs(2));
                loop {
                    ticker.tick().await;
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
            tauri::async_runtime::spawn(async move {
                let mut minute = interval(Duration::from_secs(60));
                loop {
                    minute.tick().await;
                    let mut s = settle_state.lock().unwrap();
                    let active = s.count >= 3;
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

                    // 读取配置（后续可缓存，避免每分钟查 DB）
                    let window: i64 = db_clone
                        .get_setting("window_minutes", "45")
                        .parse()
                        .unwrap_or(45);
                    let break_m: i64 = db_clone
                        .get_setting("break_minutes", "5")
                        .parse()
                        .unwrap_or(5);

                    // 滑动窗口检测：只要 should_notify=true 就直接弹通知，
                    // 不做边界去重（用户要求条件满足时每分钟都催）。
                    match db_clone.check_should_notify(window, break_m) {
                        Ok((should_notify, _boundary)) => {
                            if should_notify {
                                let _ = app_handle.notification().builder()
                                    .title("休息提醒")
                                    .body("连续工作过久，该休息啦")
                                    .show();
                            }
                        }
                        Err(e) => eprintln!("检测失败: {}", e),
                    }

                    s.count = 0;
                }
            });

            // 系统托盘
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, set_config, get_today_stats, get_day_stats, get_today_records, get_day_records, get_app_stats, test_notification])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
