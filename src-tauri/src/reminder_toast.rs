use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use crate::{db, ActivityState, ReminderWindowData, ReminderWindowStore};

const TOAST_WINDOW_LABEL: &str = "reminder-toast";
const TOAST_WINDOW_WIDTH: f64 = 360.0;
// 与前端单条通知窗口高度保持一致：卡片 180px + 上下 padding 各 20px
const TOAST_WINDOW_MIN_HEIGHT: f64 = 220.0;

/// 计算并设置 toast 窗口为右下角初始尺寸。
/// 窗口宽度固定 360px，高度固定为单条通知高度，贴靠屏幕右下角。
/// 优先将窗口放到包含鼠标光标的显示器上，否则使用主显示器。
fn position_toast_window(
    window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let monitors = app_handle.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }

    let (mouse_x, mouse_y) = {
        let state = app_handle.state::<Arc<Mutex<ActivityState>>>();
        let s = state.lock().unwrap();
        s.last_cursor
    };

    let monitor = monitors
        .iter()
        .find(|m| {
            let pos = m.position();
            let size = m.size();
            let sf = m.scale_factor();
            let left = (pos.x as f64 / sf) as i32;
            let top = (pos.y as f64 / sf) as i32;
            let right = left + (size.width as f64 / sf) as i32;
            let bottom = top + (size.height as f64 / sf) as i32;
            mouse_x >= left && mouse_x < right && mouse_y >= top && mouse_y < bottom
        })
        .unwrap_or_else(|| monitors.first().unwrap());

    let work_area = monitor.work_area();
    let sf = monitor.scale_factor();

    let x = (work_area.position.x as f64 / sf) + (work_area.size.width as f64 / sf)
        - TOAST_WINDOW_WIDTH;
    let y = (work_area.position.y as f64 / sf) + (work_area.size.height as f64 / sf)
        - TOAST_WINDOW_MIN_HEIGHT;

    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: TOAST_WINDOW_WIDTH,
            height: TOAST_WINDOW_MIN_HEIGHT,
        }))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
        .map_err(|e| e.to_string())
}

/// 创建或复用 toast 通知窗口。
/// - 窗口不存在时创建右下角透明窗口，并通过 store 传递第一条通知。
/// - 窗口已存在时，直接调用前端全局函数 `window.addToastNotification` 追加通知。
/// - 根据 `toast_debug_mode` 设置决定是否使用半透明红色背景。
pub fn create_toast_window(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    title: &str,
    body: &str,
    kind: &str,
    store: &ReminderWindowStore,
) {
    let debug_mode = {
        let db = app_handle.state::<db::Db>();
        db.get_setting("toast_debug_mode", "false") == "true"
    };

    let data = ReminderWindowData {
        kind: kind.to_string(),
        boundary,
        title: title.to_string(),
        body: body.to_string(),
        break_minutes: 0,
        fullscreen_bg: None,
        fullscreen_opacity: 0,
        fullscreen_fit_mode: String::new(),
        fullscreen_element_transforms: String::new(),
    };
    store
        .lock()
        .unwrap()
        .insert(TOAST_WINDOW_LABEL.to_string(), data.clone());

    let app = app_handle.clone();

    // 窗口已存在：直接调用前端全局函数追加通知
    if let Some(window) = app_handle.get_webview_window(TOAST_WINDOW_LABEL) {
        let payload = serde_json::json!({
            "kind": data.kind,
            "boundary": data.boundary,
            "title": data.title,
            "body": data.body,
        });
        let js = format!(
            "if (window.addToastNotification) {{ window.addToastNotification({}); }}",
            payload
        );
        let _ = window.eval(&js);
        // 确保前端路由到 /reminder-toast，并同步调试模式状态
        let debug_js = format!(
            "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.__CATRACE_TOAST_DEBUG__ = {}; window.location.hash = '#/reminder-toast';",
            debug_mode
        );
        let _ = window.eval(&debug_js);
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        return;
    }

    // 窗口不存在：创建新窗口
    tauri::async_runtime::spawn(async move {
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            TOAST_WINDOW_LABEL,
            tauri::WebviewUrl::App("index.html#/reminder-toast".into()),
        )
        .title("Catrace")
        .inner_size(TOAST_WINDOW_WIDTH, TOAST_WINDOW_MIN_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .background_color(if debug_mode {
            tauri::window::Color(255, 0, 0, 128)
        } else {
            tauri::window::Color(0, 0, 0, 0)
        })
        .shadow(false)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                let _ = position_toast_window(&window, &app);
                let _ = window.show();
                let _ = window.set_always_on_top(true);

                tokio::time::sleep(Duration::from_millis(100)).await;
                let debug_js = format!(
                    "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.__CATRACE_TOAST_DEBUG__ = {}; window.location.hash = '#/reminder-toast';",
                    debug_mode
                );
                let _ = window.eval(&debug_js);
                let _ = window.set_focus();
            }
            Err(e) => {
                eprintln!("[ToastWindow] build failed: {}", e);
            }
        }
    });
}
