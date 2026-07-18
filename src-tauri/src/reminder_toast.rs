use device_query::DeviceQuery;
use std::time::Duration;
use tokio::sync::Mutex;

use tauri::Manager;

use crate::{
    accessibility_permission_granted, log_error, log_info, window_manager, ReminderWindowData,
    ReminderWindowStore,
};

const TOAST_WINDOW_LABEL: &str = window_manager::TOAST_WINDOW_LABEL;
const TOAST_WINDOW_WIDTH: f64 = 360.0;
// 与前端单条通知窗口高度保持一致：卡片 128px + 上下 padding 各 16px
const TOAST_WINDOW_MIN_HEIGHT: f64 = 160.0;

/// 全局异步锁，串行化所有 Toast 窗口的创建/显示/追加操作。
/// 防止快速连续触发时并发操作 WebviewWindow 导致崩溃。
static TOAST_MUTEX: Mutex<()> = Mutex::const_new(());

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

    let monitor = if accessibility_permission_granted() {
        // 实时获取当前鼠标坐标，避免读取 ActivityState 锁造成死锁风险
        let (mouse_x, mouse_y) = {
            let device_state = device_query::DeviceState::new();
            let mouse = device_state.get_mouse();
            mouse.coords
        };

        monitors
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
            .unwrap_or_else(|| monitors.first().unwrap())
    } else {
        monitors.first().unwrap()
    };

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
    tauri::async_runtime::spawn(async move {
        // 串行化 WebviewWindow 操作，防止快速连续触发导致并发崩溃
        let _guard = TOAST_MUTEX.lock().await;

        // 窗口已存在：前端会在 adjustWindowSize 里自己贴到当前显示器右下角，
        // Rust 端只需追加通知并显示，避免两边 reposition 打架。
        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
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
            // 确保前端路由到 /reminder-toast
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
            return;
        }

        // 窗口不存在：兜底创建（通常不应发生，因为 setup 阶段会预创建）
        // 加锁期间二次检查，避免重复创建窗口
        if app.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
            return;
        }

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

/// 自动销项：用户已回到某 agent 会话时，从前端 sticky 待办卡 + 该 session 的审批卡里移除。
/// 通过 eval 调 `window.dismissAgentSession`；窗口不存在则无需处理。
/// 注意：后端挂起的 /permission 必须由调用方先 timeout 决策（见 agent_hook），这里只管 UI。
pub fn dismiss_agent_session_toast(app_handle: &tauri::AppHandle, session_id: &str) {
    if session_id.is_empty() || session_id == "unknown" {
        return;
    }
    let app = app_handle.clone();
    let payload = serde_json::json!(session_id);
    let js = format!(
        "if (window.dismissAgentSession) {{ window.dismissAgentSession({}); }}",
        payload
    );

    tauri::async_runtime::spawn(async move {
        let _guard = TOAST_MUTEX.lock().await;
        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            let _ = window.eval(&js);
        }
    });
}

/// 弹出 agent 状态通知 Toast（AI agent hook 事件）。
/// mode: "auto" = 到时自动消失；"sticky" = 常驻直到用户手动关闭。
/// summary: 从 transcript 提取的任务摘要，可能为 None（前端降级为默认文案）。
/// session_title: 会话名（Claude 侧栏名 / ai-title），没有则前端用 cwd 项目名。
/// 不写入 ReminderWindowStore，仅通过 eval 向前端追加一条 kind=agent 的通知。
pub fn create_agent_toast_window(
    app_handle: &tauri::AppHandle,
    event: &str,
    state: &str,
    mode: &str,
    session_id: &str,
    cwd: &str,
    prompt: &str,
    summary: Option<&str>,
    session_title: Option<&str>,
) {
    let app = app_handle.clone();
    let payload = serde_json::json!({
        "kind": "agent",
        "event": event,
        "agentState": state,
        "mode": mode,
        "sessionId": session_id,
        "cwd": cwd,
        "prompt": prompt,
        "summary": summary,
        "sessionTitle": session_title,
    });
    let js = format!(
        "if (window.addToastNotification) {{ window.addToastNotification({}); }}",
        payload
    );

    tauri::async_runtime::spawn(async move {
        // 串行化 WebviewWindow 操作，防止快速连续触发导致并发崩溃
        let _guard = TOAST_MUTEX.lock().await;

        // 窗口已存在：前端会自己定位，Rust 端只追加通知并显示
        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            let _ = window.eval(&js);
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
            return;
        }

        // 窗口不存在：兜底创建（通常不应发生，因为 setup 阶段会预创建）
        if app.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
            return;
        }

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

/// 弹出 agent 权限审批卡（P6 阻塞式）。
/// 与待办 sticky 不同：这条通知挂在一个阻塞 HTTP 请求上，用户点 Allow/Deny 才会回决策给 agent。
/// request_id 关联后端挂起的请求；tool_input 是工具输入（bash 命令等），前端截断展示。
/// 不写入 ReminderWindowStore，仅通过 eval 向前端追加一条 kind=permission 的通知。
pub fn create_agent_permission_window(
    app_handle: &tauri::AppHandle,
    request_id: u64,
    tool_name: &str,
    tool_input: Option<&serde_json::Value>,
    session_id: &str,
    cwd: &str,
) {
    let app = app_handle.clone();
    let payload = serde_json::json!({
        "kind": "permission",
        "requestId": request_id,
        "toolName": tool_name,
        "toolInput": tool_input,
        "sessionId": session_id,
        "cwd": cwd,
    });
    let js = format!(
        "if (window.addToastNotification) {{ window.addToastNotification({}); }}",
        payload
    );

    tauri::async_runtime::spawn(async move {
        let _guard = TOAST_MUTEX.lock().await;
        let window_exists = app.get_webview_window(TOAST_WINDOW_LABEL).is_some();
        log_info!(
            "toast-win",
            "permission 卡：进入建窗协程 request_id={} window_exists={}",
            request_id,
            window_exists
        );
        // 窗口已存在：直接 eval 追加审批卡
        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            log_info!("toast-win", "permission 卡 eval request_id={}", request_id);
            if let Err(e) = window.eval(&js) {
                log_error!("toast-win", "permission 卡 eval 失败: {}", e);
            }
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
            log_info!("toast-win", "permission 卡：已 show（复用窗口）request_id={}", request_id);
            return;
        }

        // 窗口不存在：兜底创建（真 Claude 触发时窗口常是关的，缺了这步审批卡就永远弹不出）
        log_info!("toast-win", "permission 卡：toast 窗口不存在，新建 request_id={}", request_id);
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
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                log_info!("toast-win", "permission 卡：新窗 build 成功 request_id={}", request_id);
                let _ = position_toast_window(&window, &app);
                window_manager::show_reminder_no_activate(&app, &window);
                tokio::time::sleep(Duration::from_millis(100)).await;
                let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
                let _ = window.eval(route_js);
                let _ = window.eval(&js);
                log_info!("toast-win", "permission 卡：新窗已 show+eval request_id={}", request_id);
            }
            Err(e) => {
                log_error!("toast-win", "permission 卡建窗失败: {}", e);
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

    tauri::async_runtime::spawn(async move {
        // 串行化 WebviewWindow 操作，防止快速连续触发导致并发崩溃
        let _guard = TOAST_MUTEX.lock().await;

        // 窗口已存在：前端会自己定位，Rust 端只追加通知并显示
        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            let _ = window.eval(&js);
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
            return;
        }

        // 窗口不存在：兜底创建（通常不应发生，因为 setup 阶段会预创建）
        // 加锁期间二次检查，避免重复创建窗口
        if app.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
            return;
        }

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
