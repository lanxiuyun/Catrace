use device_query::DeviceQuery;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tokio::sync::Mutex;

use tauri::Manager;

use crate::{
    accessibility_permission_granted, log_error, log_info, log_warn, window_manager,
    ReminderWindowData, ReminderWindowStore,
};

const TOAST_WINDOW_LABEL: &str = window_manager::TOAST_WINDOW_LABEL;

/// 逻辑像素：卡片 360 + 左右阴影出血 16×2。
const TOAST_WINDOW_WIDTH_LOGICAL: f64 = 392.0;
/// 逻辑像素：单卡约 128 + 上下出血 16×2。
const TOAST_WINDOW_MIN_HEIGHT_LOGICAL: f64 = 160.0;

/// 全局异步锁，串行化所有 Toast 窗口的创建/显示/追加操作。
/// 防止快速连续触发时并发操作 WebviewWindow 导致崩溃。
static TOAST_MUTEX: Mutex<()> = Mutex::const_new(());

struct ToastContentSize {
    width: f64,
    height: f64,
}

/// 前端最近一次上报的内容逻辑尺寸（未 clamp）。
static TOAST_CONTENT: StdMutex<ToastContentSize> = StdMutex::new(ToastContentSize {
    width: TOAST_WINDOW_WIDTH_LOGICAL,
    height: TOAST_WINDOW_MIN_HEIGHT_LOGICAL,
});

/// `fit` 期间 SetWindowPos 会同步触发 WM_DPICHANGED → ScaleFactorChanged；
/// 重入时跳过，避免事件回调再 fit 形成循环。
static TOAST_REFITTING: AtomicBool = AtomicBool::new(false);

/// 跨平台取窗口句柄描述（仅 Windows 有意义，macOS 返回占位）。
#[cfg(target_os = "windows")]
fn toast_hwnd_debug(window: &tauri::WebviewWindow) -> String {
    format!("{:?}", window.hwnd())
}
#[cfg(not(target_os = "windows"))]
fn toast_hwnd_debug(_window: &tauri::WebviewWindow) -> String {
    "n/a".to_string()
}

fn toast_content_size() -> ToastContentSize {
    let guard = TOAST_CONTENT.lock().unwrap_or_else(|e| e.into_inner());
    ToastContentSize {
        width: guard.width,
        height: guard.height,
    }
}

fn store_toast_content_size(width: f64, height: f64) -> bool {
    let width = if width.is_finite() && width > 0.0 {
        width
    } else {
        TOAST_WINDOW_WIDTH_LOGICAL
    };
    let height = if height.is_finite() && height > 0.0 {
        height
    } else {
        TOAST_WINDOW_MIN_HEIGHT_LOGICAL
    };
    let mut guard = TOAST_CONTENT.lock().unwrap_or_else(|e| e.into_inner());
    if (guard.width - width).abs() < f64::EPSILON && (guard.height - height).abs() < f64::EPSILON {
        return false;
    }
    guard.width = width;
    guard.height = height;
    true
}

pub fn reset_toast_content_size() {
    let mut guard = TOAST_CONTENT.lock().unwrap_or_else(|e| e.into_inner());
    guard.width = TOAST_WINDOW_WIDTH_LOGICAL;
    guard.height = TOAST_WINDOW_MIN_HEIGHT_LOGICAL;
}

fn monitor_containing<'a>(
    monitors: &'a [tauri::Monitor],
    x: i32,
    y: i32,
) -> Option<&'a tauri::Monitor> {
    monitors.iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        let left = pos.x;
        let top = pos.y;
        let right = left + size.width as i32;
        let bottom = top + size.height as i32;
        x >= left && x < right && y >= top && y < bottom
    })
}

pub(crate) fn resolve_cursor_monitor(app_handle: &tauri::AppHandle) -> Result<tauri::Monitor, String> {
    let monitors = app_handle.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }

    if accessibility_permission_granted() {
        let (mouse_x, mouse_y) = {
            let device_state = device_query::DeviceState::new();
            let mouse = device_state.get_mouse();
            mouse.coords
        };
        if let Some(m) = monitor_containing(&monitors, mouse_x, mouse_y) {
            return Ok(m.clone());
        }
    }

    Ok(monitors.into_iter().next().unwrap())
}

fn resolve_window_monitor(
    window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
) -> Result<tauri::Monitor, String> {
    let monitors = app_handle.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }
    if let Ok(pos) = window.outer_position() {
        if let Some(m) = monitor_containing(&monitors, pos.x, pos.y) {
            return Ok(m.clone());
        }
    }
    resolve_cursor_monitor(app_handle)
}

struct ToastRefitGuard;

impl Drop for ToastRefitGuard {
    fn drop(&mut self) {
        TOAST_REFITTING.store(false, Ordering::SeqCst);
    }
}

/// 把 Toast 小窗钉在目标显示器工作区右下角。
/// 宽高来自前端上报的内容逻辑尺寸，高度不超过 work_area。
fn fit_toast_window(
    window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
    follow_cursor: bool,
) -> Result<(), String> {
    if TOAST_REFITTING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let _guard = ToastRefitGuard;

    let monitor = if follow_cursor {
        resolve_cursor_monitor(app_handle)?
    } else {
        resolve_window_monitor(window, app_handle)?
    };

    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let content = toast_content_size();

    let max_w = area.size.width.max(1);
    let max_h = area.size.height.max(1);
    let width = ((content.width * scale).round() as u32).clamp(1, max_w);
    let height = ((content.height * scale).round() as u32).clamp(1, max_h);
    let x = area.position.x + area.size.width as i32 - width as i32;
    let y = area.position.y + area.size.height as i32 - height as i32;

    log_info!(
        "toast-win",
        "fit: work_area=({},{},{}x{}) scale={} content_logical={}x{} physical=({},{},{}x{}) follow_cursor={}",
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        scale,
        content.width,
        content.height,
        x,
        y,
        width,
        height,
        follow_cursor
    );

    window_manager::set_window_rect_physical(window, x, y, width, height)
}

/// 前端上报 Toast 内容逻辑尺寸（CSS px）。高度随卡片变化，Rust 负责钉右下并 clamp。
#[tauri::command]
pub fn set_toast_content_size(app: tauri::AppHandle, width: f64, height: f64) {
    let changed = store_toast_content_size(width, height);
    let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) else {
        return;
    };
    if !changed && window.is_visible().unwrap_or(false) {
        // 尺寸没变且已可见：不必反复 SetWindowPos。
        return;
    }
    if let Err(e) = fit_toast_window(&window, &app, false) {
        log_error!("toast-win", "content-size fit failed: {}", e);
    }
}

/// 挂载 Toast 窗口生命周期诊断日志：窗口是否被真正销毁（前端兜底 close 会走这条路），
/// 以及是否收到意外的 CloseRequested。
fn attach_toast_diagnostics(window: &tauri::WebviewWindow) {
    let win = window.clone();
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                log_warn!(
                    "toast-win",
                    "on_window_event: CloseRequested (前端可能兜底调了 webview.close())"
                );
            }
            tauri::WindowEvent::Destroyed => {
                log_warn!(
                    "toast-win",
                    "on_window_event: Destroyed — 窗口已销毁，下次显示会重建"
                );
            }
            tauri::WindowEvent::ScaleFactorChanged { .. } => {
                // 切屏后 tao 会为保持逻辑尺寸改物理大小；可见时立刻按当前窗所在屏重钉。
                if win.is_visible().unwrap_or(false) {
                    if let Err(e) = fit_toast_window(&win, &app, false) {
                        log_error!("toast-win", "dpi-change refit failed: {}", e);
                    }
                }
            }
            _ => {}
        }
    });
}

fn build_toast_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(
        app,
        TOAST_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html#/reminder-toast".into()),
    )
    .title("Catrace")
    .inner_size(TOAST_WINDOW_WIDTH_LOGICAL, TOAST_WINDOW_MIN_HEIGHT_LOGICAL)
    .decorations(false)
    .always_on_top(true)
    .transparent(true)
    .accept_first_mouse(true)
    .focused(false)
    .visible_on_all_workspaces(true)
    .maximizable(false)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .shadow(false)
    .visible(false)
    .skip_taskbar(true)
    .resizable(false)
    .build()
}

/// 在应用启动时预创建 Toast 窗口（隐藏），避免通知到达时才动态创建导致抢焦点。
pub fn prepare_toast_window(app_handle: &tauri::AppHandle) {
    log_info!("toast-win", "prepare: start");

    if app_handle.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
        log_info!("toast-win", "prepare: window already exists, skip build");
        return;
    }

    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match build_toast_window(&app) {
            Ok(window) => {
                log_info!("toast-win", "prepare: built fresh window");
                attach_toast_diagnostics(&window);
                if let Err(e) = fit_toast_window(&window, &app, true) {
                    log_error!("toast-win", "prepare: fit failed: {}", e);
                }
                // Windows 上 .visible(false) 偶尔不会立即生效，创建后再显式 hide 一次作为防御
                let hide_ok = window.hide().is_ok();
                let visible_after = window.is_visible().unwrap_or(false);
                log_info!(
                    "toast-win",
                    "prepare: hide ok={} visible_after={}",
                    hide_ok,
                    visible_after
                );
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
        log_info!("toast-win", "ensure: acquired TOAST_MUTEX");

        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            if window.is_visible().unwrap_or(false) {
                log_info!("toast-win", "ensure: already visible (double-check under lock), skip");
                return;
            }
            log_info!(
                "toast-win",
                "ensure: reuse existing window, hwnd={}",
                toast_hwnd_debug(&window)
            );
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; if (!location.hash.includes('reminder-toast')) { location.hash = '#/reminder-toast'; }";
            let _ = window.eval(route_js);
            if let Err(e) = fit_toast_window(&window, &app, true) {
                log_error!("toast-win", "ensure: reuse fit failed: {}", e);
            }
            window_manager::show_reminder_no_activate(&app, &window);
            log_info!("toast-win", "ensure: shown (reuse path)");
            return;
        }

        if app.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
            log_info!("toast-win", "ensure: window appeared between checks, skip");
            return;
        }
        log_warn!(
            "toast-win",
            "ensure: window does NOT exist — previous instance destroyed, rebuilding"
        );

        match build_toast_window(&app) {
            Ok(window) => {
                log_info!("toast-win", "ensure: built fresh window (rebuild path)");
                attach_toast_diagnostics(&window);
                if let Err(e) = fit_toast_window(&window, &app, true) {
                    log_error!("toast-win", "ensure: build fit failed: {}", e);
                }
                window_manager::show_reminder_no_activate(&app, &window);

                tokio::time::sleep(Duration::from_millis(100)).await;
                let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
                let eval_ok = window.eval(route_js).is_ok();
                log_info!(
                    "toast-win",
                    "ensure: rebuild path route eval ok={}",
                    eval_ok
                );
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

        if let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) {
            log_info!("toast-win", "create_toast_window: reuse, injecting kind={}", data.kind);
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
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            if let Err(e) = fit_toast_window(&window, &app, true) {
                log_error!("toast-win", "create_toast_window: reuse fit failed: {}", e);
            }
            window_manager::show_reminder_no_activate(&app, &window);
            log_info!("toast-win", "create_toast_window: shown (reuse path)");
            return;
        }

        if app.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
            log_info!("toast-win", "create_toast_window: appeared between checks, skip");
            return;
        }
        log_warn!(
            "toast-win",
            "create_toast_window: window missing — legacy fallback creating fresh"
        );

        match build_toast_window(&app) {
            Ok(window) => {
                log_info!("toast-win", "create_toast_window: built fresh window");
                attach_toast_diagnostics(&window);
                if let Err(e) = fit_toast_window(&window, &app, true) {
                    log_error!("toast-win", "create_toast_window: fit failed: {}", e);
                }
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
    log_info!(
        "toast-win",
        "bus.publish event_type={} kind={} sticky={:?} dedupe={:?}",
        event.event_type,
        event.kind,
        event.sticky,
        event.dedupe_key
    );
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
