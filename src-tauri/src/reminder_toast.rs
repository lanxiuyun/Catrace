use device_query::DeviceQuery;
use std::time::Duration;

use tauri::Manager;

use crate::{window_manager, ReminderWindowData, ReminderWindowStore};
use crate::log_error;

const TOAST_WINDOW_LABEL: &str = window_manager::TOAST_WINDOW_LABEL;
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

    // 实时获取当前鼠标坐标，避免读取 ActivityState 锁造成死锁风险
    let (mouse_x, mouse_y) = {
        let device_state = device_query::DeviceState::new();
        let mouse = device_state.get_mouse();
        mouse.coords
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

/// 在应用启动时预创建 Toast 窗口（隐藏），避免通知到达时才动态创建导致抢焦点。
pub fn prepare_toast_window(app_handle: &tauri::AppHandle) {
    if app_handle.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
        return;
    }

    let app = app_handle.clone();
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
        .accept_first_mouse(true)
        .visible_on_all_workspaces(true)
        .maximizable(false)
        // 调试背景由前端 CSS 控制，这里始终使用透明背景
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                // Windows 上 .visible(false) 偶尔不会立即生效，创建后再显式 hide 一次作为防御
                let _ = window.hide();
            }
            Err(e) => {
                log_error!("toast-win", "prepare failed: {}", e);
            }
        }
    });
}

/// 创建或复用 toast 通知窗口。
/// - 窗口已存在时直接复用（优先）。
/// - 窗口不存在时兜底创建。
/// - 调试背景由前端 CSS 控制，Rust 侧窗口背景始终透明。
pub fn create_toast_window(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    title: &str,
    body: &str,
    kind: &str,
    store: &ReminderWindowStore,
) {
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

    // 窗口已存在：先重新定位到正确显示器的右下角，再追加通知
    if let Some(window) = app_handle.get_webview_window(TOAST_WINDOW_LABEL) {
        let payload = serde_json::json!({
            "kind": data.kind,
            "boundary": data.boundary,
            "title": data.title,
            "body": data.body,
        });
        let app = app_handle.clone();
        // position_toast_window / eval / show_reminder_no_activate 都涉及 WebviewWindow 操作，
        // 在 Windows 上部分 API 要求主线程；通过 async_runtime 确保它们跑在主线程。
        tauri::async_runtime::spawn(async move {
            let _ = position_toast_window(&window, &app);
            let js = format!(
                "if (window.addToastNotification) {{ window.addToastNotification({}); }}",
                payload
            );
            let _ = window.eval(&js);
            // 确保前端路由到 /reminder-toast
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
        });
        return;
    }

    // 窗口不存在：兜底创建（通常不应发生，因为 setup 阶段会预创建）
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
        .accept_first_mouse(true)
        .visible_on_all_workspaces(true)
        .maximizable(false)
        // 调试背景由前端 CSS 控制，这里始终使用透明背景
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                let _ = position_toast_window(&window, &app);
                window_manager::show_reminder_no_activate(&app, &window);

                tokio::time::sleep(Duration::from_millis(100)).await;
                let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
                let _ = window.eval(route_js);
            }
            Err(e) => {
                log_error!("toast-win", "build failed: {}", e);
            }
        }
    });
}

/// 弹出「发现新版本」更新通知 Toast。
/// 不写入 ReminderWindowStore，仅通过 eval 向前端追加一条 kind=update 的通知。
pub fn create_update_toast_window(
    app_handle: &tauri::AppHandle,
    version: &str,
    changelog: &str,
) {
    let app = app_handle.clone();
    let payload = serde_json::json!({
        "kind": "update",
        "version": version,
        "updateBody": changelog,
    });
    let js = format!(
        "if (window.addToastNotification) {{ window.addToastNotification({}); }}",
        payload
    );

    // 窗口已存在：先重新定位到正确显示器的右下角，再追加通知
    if let Some(window) = app_handle.get_webview_window(TOAST_WINDOW_LABEL) {
        let app = app_handle.clone();
        let js_payload = js.clone();
        // WebviewWindow 操作需要跑在主线程，避免调用方不在主线程时崩溃。
        tauri::async_runtime::spawn(async move {
            let _ = position_toast_window(&window, &app);
            let _ = window.eval(&js_payload);
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
        });
        return;
    }

    // 窗口不存在：兜底创建（通常不应发生，因为 setup 阶段会预创建）
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
        .accept_first_mouse(true)
        .visible_on_all_workspaces(true)
        .maximizable(false)
        // 调试背景由前端 CSS 控制，这里始终使用透明背景
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                let _ = position_toast_window(&window, &app);
                window_manager::show_reminder_no_activate(&app, &window);

                tokio::time::sleep(Duration::from_millis(100)).await;
                let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
                let _ = window.eval(route_js);
                let _ = window.eval(&js);
            }
            Err(e) => {
                log_error!("toast-win", "build failed: {}", e);
            }
        }
    });
}
