use device_query::DeviceQuery;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex as StdMutex, OnceLock};
use std::thread;
use std::time::Duration;
use tokio::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::{
    accessibility_permission_granted, log_error, log_info, log_warn, window_manager,
    ReminderWindowData, ReminderWindowStore,
};

const TOAST_WINDOW_LABEL: &str = window_manager::TOAST_WINDOW_LABEL;

/// 全局异步锁，串行化所有 Toast 窗口的创建/显示/追加操作。
/// 防止快速连续触发时并发操作 WebviewWindow 导致崩溃。
static TOAST_MUTEX: Mutex<()> = Mutex::const_new(());

/// 可交互区域的窗口内逻辑坐标（CSS px），由前端周期上报。
#[derive(Clone, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 当前 Toast 全屏覆盖窗的可交互矩形集合。
static HIT_RECTS: StdMutex<Vec<HitRect>> = StdMutex::new(Vec::new());

/// 全局 AppHandle：穿透轮询线程取窗口用。
static TOAST_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// 穿透轮询线程只启动一次。
static HIT_POLL_STARTED: AtomicBool = AtomicBool::new(false);

/// 穿透轮询：窗口句柄消失（窗口被销毁）与否，只在状态翻转时记日志。
static HIT_POLL_WINDOW_MISSING: AtomicBool = AtomicBool::new(false);
/// 穿透轮询：窗口可见性翻转记录（tao 缓存 vs 实际 Win32 可能不同步，靠日志观察）。
static HIT_POLL_PREV_VISIBLE: AtomicBool = AtomicBool::new(false);

/// 当前窗口的实际穿透状态（true=整窗穿透），穿透轮询与 show 路径共享，
/// 避免两者各自维护状态导致不同步。
static TOAST_IGNORING: AtomicBool = AtomicBool::new(true);

/// 跨平台取窗口句柄描述（仅 Windows 有意义，macOS 返回占位）。
#[cfg(target_os = "windows")]
fn toast_hwnd_debug(window: &tauri::WebviewWindow) -> String {
    format!("{:?}", window.hwnd())
}
#[cfg(not(target_os = "windows"))]
fn toast_hwnd_debug(_window: &tauri::WebviewWindow) -> String {
    "n/a".to_string()
}

/// 获取 HIT_RECTS 锁；容忍被污染（panic 后恢复），避免锁级联崩溃。
fn hit_rects() -> std::sync::MutexGuard<'static, Vec<HitRect>> {
    HIT_RECTS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 前端上报可交互区域（窗口内逻辑坐标）。
#[tauri::command]
pub fn set_toast_hit_regions(rects: Vec<HitRect>) {
    let changed = {
        let mut guard = hit_rects();
        if *guard == rects {
            return;
        }
        let len = rects.len();
        *guard = rects;
        len
    };
    log_info!("toast-win", "hit regions updated: {} rects", changed);
}

/// 穿透轮询线程入口：捕获内层 panic 后自动重启，避免丢失穿透控制。
fn hit_poll_loop() {
    loop {
        let result = std::panic::catch_unwind(|| hit_poll_loop_inner());
        if result.is_err() {
            log_error!("toast-hit", "hit poll loop panicked; restarting in 500ms");
            thread::sleep(Duration::from_millis(500));
        }
    }
}

/// 在主线程上 emit hover-exit 事件（与其它 emit 保持一致的主线程上下文）。
fn emit_hover_exit(app: &tauri::AppHandle) {
    let app = app.clone();
    let app_inner = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = app_inner.emit("catrace:toast-hover-exit", ());
    });
}

/// 穿透轮询线程：每 50ms 检查光标是否落在任一可交互矩形内，
/// 动态切换 `set_ignore_cursor_events`（整窗穿透 ↔ 卡片可交互）。
/// 窗口隐藏 / 无矩形时强制回到穿透态；退出可交互态时 emit 事件，
/// 让前端清 hover 并恢复自动消失计时（否则 WebView 收不到 mouseleave）。
/// 注意：所有窗口/emit 调用都必须在释放 HIT_RECTS 锁之后执行，
/// 否则与 `set_toast_hit_regions` 命令构成跨线程锁序死锁。
fn hit_poll_loop_inner() {
    let device_state = device_query::DeviceState::new();
    loop {
        thread::sleep(Duration::from_millis(50));
        let Some(app) = TOAST_APP_HANDLE.get() else {
            continue;
        };
        let Some(window) = app.get_webview_window(TOAST_WINDOW_LABEL) else {
            if !HIT_POLL_WINDOW_MISSING.swap(true, Ordering::SeqCst) {
                log_warn!(
                    "toast-win",
                    "hit-poll: toast window GONE from app (destroyed?), poll goes dormant"
                );
            }
            continue;
        };
        if HIT_POLL_WINDOW_MISSING.swap(false, Ordering::SeqCst) {
            log_info!("toast-win", "hit-poll: toast window present again (rebuilt)");
        }

        let visible = window.is_visible().unwrap_or(false);
        let prev_visible = HIT_POLL_PREV_VISIBLE.swap(visible, Ordering::SeqCst);
        if prev_visible != visible {
            log_info!(
                "toast-win",
                "hit-poll: visible {} -> {} (tao is_visible)",
                prev_visible,
                visible
            );
        }
        let ignoring = TOAST_IGNORING.load(Ordering::SeqCst);

        if !visible {
            // 即使状态没变也强制同步一次：tao 的 apply_diff 可能随时把
            // WS_EX_TRANSPARENT 冲掉（例如 fit 期间的 set_size/set_position），
            // 只按状态翻转调用会让样式永久失步。raw 无变化时只是读一次，开销可忽略。
            window_manager::set_ignore_cursor_events_raw(&window, true);
            if !ignoring {
                TOAST_IGNORING.store(true, Ordering::SeqCst);
            }
            continue;
        }

        // 先克隆矩形、释放锁，再做任何窗口调用（避免跨线程锁序死锁）
        let rects = hit_rects().clone();
        if rects.is_empty() {
            window_manager::set_ignore_cursor_events_raw(&window, true);
            if !ignoring {
                emit_hover_exit(app);
                TOAST_IGNORING.store(true, Ordering::SeqCst);
            }
            continue;
        }

        let sf = window.scale_factor().unwrap_or(1.0);
        let (wx, wy) = match window.inner_position() {
            Ok(p) => (p.x as f64, p.y as f64),
            Err(_) => continue,
        };
        let (mx, my) = {
            let mouse = device_state.get_mouse();
            (mouse.coords.0 as f64, mouse.coords.1 as f64)
        };

        let hit = rects.iter().any(|r| {
            let left = wx + r.x * sf;
            let top = wy + r.y * sf;
            let right = left + r.width * sf;
            let bottom = top + r.height * sf;
            mx >= left && mx < right && my >= top && my < bottom
        });

        let should_ignore = !hit;
        // 每 tick 无条件强制同步实际样式：tao 的 apply_diff 可能在任何时刻
        // （fit、WebView 重建、resize）把 WS_EX_TRANSPARENT 冲掉，状态机必须
        // 自愈。raw 在样式未变化时只是 GetWindowLongPtr 读一次，开销可忽略。
        window_manager::set_ignore_cursor_events_raw(&window, should_ignore);
        if should_ignore != ignoring {
            if should_ignore {
                emit_hover_exit(app);
            }
            TOAST_IGNORING.store(should_ignore, Ordering::SeqCst);
        }
    }
}

/// 把 Toast 窗口铺满光标所在显示器的工作区（去掉任务栏等系统区域）。
/// 默认整窗穿透由 `set_ignore_cursor_events(true)` 保证。
fn fit_toast_window_to_cursor_monitor(
    window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let monitors = app_handle.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }

    let monitor = if accessibility_permission_granted() {
        // 实时读取光标物理坐标，避免读取 ActivityState 锁造成死锁风险
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
                let left = pos.x;
                let top = pos.y;
                let right = left + size.width as i32;
                let bottom = top + size.height as i32;
                mouse_x >= left && mouse_x < right && mouse_y >= top && mouse_y < bottom
            })
            .unwrap_or_else(|| monitors.first().unwrap())
    } else {
        monitors.first().unwrap()
    };

    // 使用工作区（work_area）而非整块屏幕，避免覆盖任务栏 / macOS Dock。
    // 用 PhysicalPosition/PhysicalSize 直接设置，避免跨屏时窗口当前 scale factor
    // 与新显示器不一致导致逻辑坐标被错误转换（第一张 Toast 偏移且无法命中）。
    let area = monitor.work_area();

    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: area.size.width,
            height: area.size.height,
        }))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: area.position.x,
            y: area.position.y,
        }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 挂载 Toast 窗口生命周期诊断日志：窗口是否被真正销毁（前端兜底 close 会走这条路），
/// 以及是否收到意外的 CloseRequested。
fn attach_toast_diagnostics(window: &tauri::WebviewWindow) {
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
            _ => {}
        }
    });
}

/// 在应用启动时预创建 Toast 窗口（隐藏），避免通知到达时才动态创建导致抢焦点。
/// 同时启动穿透轮询线程（全局仅一次）。
pub fn prepare_toast_window(app_handle: &tauri::AppHandle) {
    log_info!("toast-win", "prepare: start");
    let _ = TOAST_APP_HANDLE.set(app_handle.clone());
    if !HIT_POLL_STARTED.swap(true, Ordering::SeqCst) {
        log_info!("toast-win", "prepare: spawning hit-poll thread");
        thread::spawn(hit_poll_loop);
    }

    if app_handle.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
        log_info!("toast-win", "prepare: window already exists, skip build");
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
        .inner_size(360.0, 160.0)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .accept_first_mouse(true)
        .focused(false)
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
                log_info!("toast-win", "prepare: built fresh window");
                attach_toast_diagnostics(&window);
                // 全屏铺满光标所在屏，默认整窗穿透
                if let Err(e) = fit_toast_window_to_cursor_monitor(&window, &app) {
                    log_error!("toast-win", "prepare: fit failed: {}", e);
                }
                TOAST_IGNORING.store(true, Ordering::SeqCst);
                let _ = window_manager::set_ignore_cursor_events_raw(&window, true);
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
            // 光标可能已换屏：重新铺满光标所在屏；show 前强制回到整窗穿透态，
            // 避免窗口刚出现时吞掉整屏点击（卡片可交互由穿透轮询接管）。
            if let Err(e) = fit_toast_window_to_cursor_monitor(&window, &app) {
                log_error!("toast-win", "ensure: reuse fit failed: {}", e);
            }
            TOAST_IGNORING.store(true, Ordering::SeqCst);
            let _ = window_manager::set_ignore_cursor_events_raw(&window, true);
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

        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            TOAST_WINDOW_LABEL,
            tauri::WebviewUrl::App("index.html#/reminder-toast".into()),
        )
        .title("Catrace")
        .inner_size(360.0, 160.0)
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
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                log_info!("toast-win", "ensure: built fresh window (rebuild path)");
                attach_toast_diagnostics(&window);
                if let Err(e) = fit_toast_window_to_cursor_monitor(&window, &app) {
                    log_error!("toast-win", "ensure: build fit failed: {}", e);
                }
                TOAST_IGNORING.store(true, Ordering::SeqCst);
                let _ = window_manager::set_ignore_cursor_events_raw(&window, true);
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

        // 窗口已存在：前端会在 adjustWindowSize 里自己贴到当前显示器右下角，
        // Rust 端只需追加通知并显示，避免两边 reposition 打架。
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
            // 确保前端路由到 /reminder-toast
            let route_js = "window.__CATRACE_REMINDER_TYPE__ = 'toast'; window.location.hash = '#/reminder-toast';";
            let _ = window.eval(route_js);
            window_manager::show_reminder_no_activate(&app, &window);
            log_info!("toast-win", "create_toast_window: shown (reuse path)");
            return;
        }

        // 窗口不存在：兜底创建（通常不应发生，因为 setup 阶段会预创建）
        // 加锁期间二次检查，避免重复创建窗口
        if app.get_webview_window(TOAST_WINDOW_LABEL).is_some() {
            log_info!("toast-win", "create_toast_window: appeared between checks, skip");
            return;
        }
        log_warn!(
            "toast-win",
            "create_toast_window: window missing — legacy fallback creating fresh"
        );

        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            TOAST_WINDOW_LABEL,
            tauri::WebviewUrl::App("index.html#/reminder-toast".into()),
        )
        .title("Catrace")
        .inner_size(360.0, 160.0)
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
                log_info!("toast-win", "create_toast_window: built fresh window");
                attach_toast_diagnostics(&window);
                if let Err(e) = fit_toast_window_to_cursor_monitor(&window, &app) {
                    log_error!("toast-win", "create_toast_window: fit failed: {}", e);
                }
                TOAST_IGNORING.store(true, Ordering::SeqCst);
                let _ = window_manager::set_ignore_cursor_events_raw(&window, true);
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
