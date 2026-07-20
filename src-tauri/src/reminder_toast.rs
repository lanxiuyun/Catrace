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

/// 确保 Toast 窗口存在并显示（不向页面注入通知内容）。
/// Event Bus 路径：内容由前端 listen `catrace:event` 渲染；此处只负责窗口生命周期。
pub fn ensure_toast_window_visible(app_handle: &tauri::AppHandle) {
    // 已可见：连点堆叠时不必反复抢 mutex / Win32 show / eval
    if let Some(window) = app_handle.get_webview_window(TOAST_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            return;
        }
    }

    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let _guard = TOAST_MUTEX.lock().await;

        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            if window.is_visible().unwrap_or(false) {
                return;
            }
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; if (!location.hash.includes('reminder-toast')) { location.hash = '#/reminder-toast'; }";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
            return;
        }

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
            }
            Err(e) => {
                log_error!("toast-win", "build failed: {}", e);
            }
        }
    });
}

/// 旧路径：创建或复用 toast 并通过 eval 注入通知（agent/update 等尚未迁 Bus 时使用）。
/// - 窗口已存在时直接复用（优先）。
/// - 窗口不存在时兜底创建。
/// - 调试背景由前端 CSS 控制，Rust 侧窗口背景始终透明。
#[allow(dead_code)]
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
/// 经 `catrace:dismiss-agent-session` emit（不再 eval window.dismissAgentSession）。
/// 注意：后端挂起的 /permission 必须由调用方先 timeout 决策（见 agent_hook），这里只管 UI。
pub fn dismiss_agent_session_toast(app_handle: &tauri::AppHandle, session_id: &str) {
    if session_id.is_empty() || session_id == "unknown" {
        return;
    }
    use tauri::Emitter;
    let _ = app_handle.emit("catrace:dismiss-agent-session", session_id.to_string());
}

fn try_publish_toast_event(app_handle: &tauri::AppHandle, event: crate::event::BusEvent) -> bool {
    use tauri::Manager;
    if let Some(bus) = app_handle.try_state::<crate::bus::EventBus>() {
        match bus.inner().publish(event) {
            Ok(_) => true,
            Err(e) => {
                log_error!("toast-win", "bus.publish failed: {}", e);
                false
            }
        }
    } else {
        log_error!("toast-win", "EventBus state missing");
        false
    }
}

/// 弹出 agent 状态通知 Toast（AI agent hook 事件）。
/// mode: "auto" = 到时自动消失；"sticky" = 常驻直到用户手动关闭。
/// 经 Event Bus 下发，Toast 窗订阅渲染。
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
    use crate::event::{
        BusEvent, DisplayMode, EventLevel, EventSource, EventStatus,
    };

    let sticky = mode == "sticky";
    let bus_event = BusEvent {
        id: String::new(),
        event_type: format!("agent.{event}"),
        source: EventSource::AgentHook,
        kind: "agent".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title: String::new(),
        body: String::new(),
        actions: vec![],
        progress: None,
        sticky: Some(sticky),
        payload: serde_json::json!({
            "event": event,
            "agentState": state,
            "mode": mode,
            "sessionId": session_id,
            "cwd": cwd,
            "prompt": prompt,
            "summary": summary,
            "sessionTitle": session_title,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: if session_id.is_empty() {
            None
        } else {
            Some(session_id.to_string())
        },
        dedupe_key: if sticky {
            Some(format!("agent.sticky:{session_id}"))
        } else {
            Some(format!("agent.auto:{session_id}:{event}"))
        },
    };

    if !try_publish_toast_event(app_handle, bus_event) {
        // bus 不可用时兜底：至少保证窗口在
        ensure_toast_window_visible(app_handle);
    }
}

/// 弹出 agent 权限审批卡（P6 阻塞式）。
/// 经 Event Bus 下发 kind=permission。
pub fn create_agent_permission_window(
    app_handle: &tauri::AppHandle,
    request_id: u64,
    tool_name: &str,
    tool_input: Option<&serde_json::Value>,
    session_id: &str,
    cwd: &str,
) {
    use crate::event::{
        BusEvent, DisplayMode, EventLevel, EventSource, EventStatus,
    };

    log_info!(
        "toast-win",
        "permission 卡：bus publish request_id={}",
        request_id
    );

    let bus_event = BusEvent {
        id: String::new(),
        event_type: "agent.permission".into(),
        source: EventSource::AgentHook,
        kind: "permission".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Warning,
        title: String::new(),
        body: String::new(),
        actions: vec![],
        progress: None,
        sticky: Some(true),
        payload: serde_json::json!({
            "requestId": request_id,
            "toolName": tool_name,
            "toolInput": tool_input,
            "sessionId": session_id,
            "cwd": cwd,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: Some(format!("permission:{request_id}")),
        dedupe_key: Some(format!("agent.permission:{request_id}")),
    };

    if !try_publish_toast_event(app_handle, bus_event) {
        ensure_toast_window_visible(app_handle);
    }
}

/// 弹出「发现新版本」更新通知 Toast。经 Event Bus 下发。
pub fn create_update_toast_window(
    app_handle: &tauri::AppHandle,
    version: &str,
    changelog: &str,
) {
    use crate::event::{
        BusEvent, DisplayMode, EventLevel, EventSource, EventStatus,
    };

    let bus_event = BusEvent {
        id: String::new(),
        event_type: "system.update.available".into(),
        source: EventSource::Internal,
        kind: "update".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title: String::new(),
        body: String::new(),
        actions: vec![],
        progress: None,
        sticky: Some(true),
        payload: serde_json::json!({
            "version": version,
            "updateBody": changelog,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some(format!("system.update:{version}")),
    };

    if !try_publish_toast_event(app_handle, bus_event) {
        ensure_toast_window_visible(app_handle);
    }
}
