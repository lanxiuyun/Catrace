//! Windows 系统通知转发 — UserNotificationListener (WinRT) 事件源。
//!
//! 混合模式（参考 WinIsland 实证）：NotificationChanged 事件毫秒级触发，
//! 2s 轮询兜底防丢事件；HashSet 对账去重；「收起系统弹窗」开启时在
//! 发布成功后立即 RemoveNotification 压掉原生 toast。
//!
//! 未打包进程可直接使用该 API（Win11 26200 实测 + WinIsland 裸 EXE 分发印证），
//! 微软未承诺此行为；若未来失效，回退方向是 sparse package 或 wpndatabase 直读。

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::event::{
    BusEvent, DisplayMode, EventLevel, EventResolution, EventSource, ResolutionKind,
};
use crate::{log_error, log_info, log_warn};

const ENABLED_SETTING_KEY: &str = "notification_forward_enabled";
const TAKEOVER_SETTING_KEY: &str = "notification_takeover_enabled";
const MUTED_AUMIDS_SETTING_KEY: &str = "notification_muted_aumids";
const KNOWN_APPS_SETTING_KEY: &str = "notification_known_apps";
const MAX_KNOWN_APPS: usize = 200;
const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// 发布后延迟 resolve，registry 不留永久 active 事件（防 Toast 窗重建时重放旧通知）
const EVENT_TTL: Duration = Duration::from_secs(35);
const BODY_MAX_CHARS: usize = 200;
const AUTO_HIDE_MS: i64 = 6000;
const LOGO_MAX_BYTES: u32 = 256 * 1024;

pub const EVENT_TYPE: &str = "system.notification.received";
pub const KIND: &str = "notification";

const ACCESS_GRANTED: u8 = 1;
const ACCESS_DENIED: u8 = 2;
const ACCESS_UNSPECIFIED: u8 = 3;

#[derive(Default)]
struct StateInner {
    running: AtomicBool,
    access: AtomicU8,
}

/// 应用全局状态：监听线程的停机通道 + 运行/授权快照。
#[derive(Clone, Default)]
pub struct NotificationForwardState {
    inner: Arc<StateInner>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationForwardStatus {
    pub enabled: bool,
    pub takeover: bool,
    pub running: bool,
    /// granted | denied | unspecified | unavailable
    pub access: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationKnownApp {
    pub aumid: String,
    pub name: String,
    pub muted: bool,
}

// ---------------------------------------------------------------------------
// 启停
// ---------------------------------------------------------------------------

/// 应用启动时按设置恢复监听（仅 Windows）。
#[cfg(windows)]
pub fn maybe_start(app: &AppHandle, db: &Db) {
    if db.get_setting(ENABLED_SETTING_KEY, "false") != "true" {
        return;
    }
    if let Err(e) = start(app) {
        log_warn!("notification", "auto start failed: {}", e);
    }
}

#[cfg(windows)]
fn start(app: &AppHandle) -> Result<(), String> {
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::Management::{
        UserNotificationListener, UserNotificationListenerAccessStatus,
    };
    use windows::UI::Notifications::{NotificationKinds, UserNotificationChangedKind};

    let state = app.state::<NotificationForwardState>();
    if state.inner.running.load(Ordering::SeqCst) {
        return Ok(());
    }

    let listener = UserNotificationListener::Current().map_err(|e| e.to_string())?;
    let access = wait_async(listener.RequestAccessAsync()).map_err(|e| e.to_string())?;
    let access_code = match access {
        UserNotificationListenerAccessStatus::Allowed => ACCESS_GRANTED,
        UserNotificationListenerAccessStatus::Denied => ACCESS_DENIED,
        _ => ACCESS_UNSPECIFIED,
    };
    state.inner.access.store(access_code, Ordering::SeqCst);
    if access_code != ACCESS_GRANTED {
        return Err("notification listener access denied".into());
    }

    let bus = app.state::<crate::bus::EventBus>().inner().clone();
    let db = app.state::<Db>().inner().clone();

    let (event_tx, event_rx) = mpsc::channel::<u32>();
    let handler = TypedEventHandler::<
        UserNotificationListener,
        windows::UI::Notifications::UserNotificationChangedEventArgs,
    >::new(move |_, args| {
        let Ok(args) = args.ok() else {
            return Ok(());
        };
        if args.ChangeKind()? == UserNotificationChangedKind::Added {
            let id = args.UserNotificationId()?;
            let _ = event_tx.send(id);
        }
        Ok(())
    });
    let token = listener
        .NotificationChanged(&handler)
        .map_err(|e| e.to_string())?;

    let toast_kind = NotificationKinds::Toast;
    let worker_state = state.inner().clone();
    let worker_listener = listener.clone();
    worker_state.inner.running.store(true, Ordering::SeqCst);

    thread::spawn(move || {
        worker_loop(worker_listener, toast_kind, token, event_rx, bus, db, worker_state.inner);
    });
    Ok(())
}

fn stop(state: &NotificationForwardState) {
    // worker 每轮循环检查 running；注销事件句柄在 worker 退出时完成
    state.inner.running.store(false, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// worker：事件驱动 + 轮询兜底
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn worker_loop(
    listener: windows::UI::Notifications::Management::UserNotificationListener,
    toast_kind: windows::UI::Notifications::NotificationKinds,
    token: i64,
    event_rx: mpsc::Receiver<u32>,
    bus: crate::bus::EventBus,
    db: Db,
    state: Arc<StateInner>,
) {
    let mut known: std::collections::HashSet<u32> = std::collections::HashSet::new();
    // 首轮静默对账：操作中心现存通知只入集合不弹卡，避免启动时轰炸历史
    if let Ok(view) = wait_async(listener.GetNotificationsAsync(toast_kind)) {
        for n in view {
            let _ = known.insert(n.Id().unwrap_or(0));
        }
    }
    log_info!("notification", "listener started (event + 2s poll hybrid)");

    loop {
        if !state.running.load(Ordering::SeqCst) {
            break;
        }
        match event_rx.recv_timeout(POLL_INTERVAL) {
            Ok(id) => {
                if known.insert(id) {
                    process_notification(&listener, &bus, &db, id);
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                match wait_async(listener.GetNotificationsAsync(toast_kind)) {
                    Ok(view) => {
                        let mut current = std::collections::HashSet::new();
                        for n in view {
                            let id = n.Id().unwrap_or(0);
                            current.insert(id);
                            if known.insert(id) {
                                process_notification(&listener, &bus, &db, id);
                            }
                        }
                        // 操作中心里已消失的通知同步移出已知集合
                        known.retain(|id| current.contains(id));
                    }
                    Err(e) => log_warn!("notification", "poll failed: {}", e),
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = listener.RemoveNotificationChanged(token);
    state.running.store(false, Ordering::SeqCst);
    log_info!("notification", "listener stopped");
}

// ---------------------------------------------------------------------------
// 单条通知处理
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn process_notification(
    listener: &windows::UI::Notifications::Management::UserNotificationListener,
    bus: &crate::bus::EventBus,
    db: &Db,
    id: u32,
) {
    let notif = match listener.GetNotification(id) {
        Ok(n) => n,
        Err(_) => return, // 已被用户清掉（事件先于轮询到达时常见）
    };
    let (title, body) = match extract_text(&notif) {
        Some(t) => t,
        None => return,
    };
    let app_info = match notif.AppInfo() {
        Ok(a) => a,
        Err(_) => return,
    };
    let aumid = app_info
        .Id()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let app_name = app_info
        .DisplayInfo()
        .ok()
        .and_then(|d| d.DisplayName().ok())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_app_name(&aumid));

    if is_muted(db, &aumid) {
        return;
    }
    record_known_app(db, &aumid, &app_name);
    let icon = extract_logo_data_url(&app_info);

    let event = BusEvent {
        id: String::new(),
        event_type: EVENT_TYPE.into(),
        source: EventSource::Internal,
        kind: KIND.into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title,
        body,
        actions: vec![],
        progress: None,
        sticky: None,
        payload: serde_json::json!({
            "app_name": app_name,
            "aumid": aumid,
            "icon_data_url": icon,
            "auto_hide_ms": AUTO_HIDE_MS,
        }),
        created_at: 0,
        updated_at: 0,
        status: Default::default(),
        revision: 1,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some(format!("notification:{id}")),
    };

    match bus.publish(event) {
        Ok(published) => {
            // 鸠占鹊巢：发布成功后立刻移除系统通知，原生 toast 来不及渲染。
            // bus 失败时保留系统通知——至少一处可见。
            if db.get_setting(TAKEOVER_SETTING_KEY, "false") == "true" {
                if let Err(e) = listener.RemoveNotification(id) {
                    log_warn!("notification", "remove system notification failed: {}", e);
                }
            }
            let bus2 = bus.clone();
            let event_id = published.id;
            thread::spawn(move || {
                thread::sleep(EVENT_TTL);
                let _ = bus2.resolve(
                    event_id,
                    EventResolution {
                        kind: ResolutionKind::Expired,
                        action_id: None,
                        payload: None,
                    },
                );
            });
        }
        Err(e) => {
            log_error!("notification", "publish failed: {}", e);
        }
    }
}

#[cfg(windows)]
fn extract_text(notif: &windows::UI::Notifications::UserNotification) -> Option<(String, String)> {
    let visual = notif.Notification().ok()?.Visual().ok()?;
    let key = windows::UI::Notifications::KnownNotificationBindings::ToastGeneric().ok()?;
    let binding = visual.GetBinding(&key).ok()?;
    let texts = binding.GetTextElements().ok()?;
    let mut title = String::new();
    let mut body = String::new();
    for item in texts {
        let s = item.Text().map(|s| s.to_string()).unwrap_or_default();
        let s = s.trim();
        if s.is_empty() {
            continue;
        }
        if title.is_empty() {
            title = s.to_string();
        } else {
            if !body.is_empty() {
                body.push('\n');
            }
            body.push_str(s);
        }
    }
    truncate_chars(&mut body, BODY_MAX_CHARS);
    if title.is_empty() && body.is_empty() {
        return None;
    }
    Some((title, body))
}

#[cfg(windows)]
fn extract_logo_data_url(app_info: &windows::ApplicationModel::AppInfo) -> Option<String> {
    use base64::Engine as _;
    use windows::Foundation::Size;
    use windows::Storage::Streams::{DataReader, InputStreamOptions};

    let display = app_info.DisplayInfo().ok()?;
    let logo = display.GetLogo(Size { Width: 32.0, Height: 32.0 }).ok()?;
    let stream = wait_async(logo.OpenReadAsync()).ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > LOGO_MAX_BYTES {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let _ = reader.SetInputStreamOptions(InputStreamOptions::ReadAhead);
    let loaded = wait_async(reader.LoadAsync(size)).ok()? as usize;
    let mut buf = vec![0u8; loaded];
    if loaded > 0 {
        reader.ReadBytes(&mut buf).ok()?;
    }
    let content_type = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| "image/png".into());
    let content_type = if content_type.contains('/') {
        content_type
    } else {
        "image/png".into()
    };
    Some(format!(
        "data:{};base64,{}",
        content_type,
        base64::engine::general_purpose::STANDARD.encode(&buf)
    ))
}

// ---------------------------------------------------------------------------
// 设置存取与命令
// ---------------------------------------------------------------------------

fn muted_list(db: &Db) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&db.get_setting(MUTED_AUMIDS_SETTING_KEY, "[]"))
        .unwrap_or_default()
}

#[cfg(windows)]
fn is_muted(db: &Db, aumid: &str) -> bool {
    !aumid.is_empty() && muted_list(db).iter().any(|m| m == aumid)
}

fn record_known_app(db: &Db, aumid: &str, name: &str) {
    if aumid.is_empty() || name.is_empty() {
        return;
    }
    let mut map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&db.get_setting(KNOWN_APPS_SETTING_KEY, "{}")).unwrap_or_default();
    if map.get(aumid).and_then(|v| v.as_str()) == Some(name) {
        return;
    }
    map.insert(aumid.to_string(), serde_json::Value::String(name.to_string()));
    if map.len() > MAX_KNOWN_APPS {
        let excess = map.len() - MAX_KNOWN_APPS;
        let keys: Vec<String> = map.keys().take(excess).cloned().collect();
        for k in keys {
            map.remove(&k);
        }
    }
    if let Ok(s) = serde_json::to_string(&map) {
        let _ = db.set_setting(KNOWN_APPS_SETTING_KEY, &s);
    }
}

fn access_label(code: u8) -> String {
    match code {
        ACCESS_GRANTED => "granted",
        ACCESS_DENIED => "denied",
        ACCESS_UNSPECIFIED => "unspecified",
        _ => "unknown",
    }
    .into()
}

#[cfg(windows)]
fn live_access() -> Option<String> {
    use windows::UI::Notifications::Management::{
        UserNotificationListener, UserNotificationListenerAccessStatus,
    };
    let listener = UserNotificationListener::Current().ok()?;
    let status = listener.GetAccessStatus().ok()?;
    Some(
        match status {
            UserNotificationListenerAccessStatus::Allowed => "granted",
            UserNotificationListenerAccessStatus::Denied => "denied",
            _ => "unspecified",
        }
        .into(),
    )
}

fn status_inner(db: &Db, state: &NotificationForwardState) -> NotificationForwardStatus {
    let access = {
        #[cfg(windows)]
        {
            live_access()
                .unwrap_or_else(|| access_label(state.inner.access.load(Ordering::SeqCst)))
        }
        #[cfg(not(windows))]
        {
            let _ = state;
            "unavailable".to_string()
        }
    };
    NotificationForwardStatus {
        enabled: db.get_setting(ENABLED_SETTING_KEY, "false") == "true",
        takeover: db.get_setting(TAKEOVER_SETTING_KEY, "false") == "true",
        running: state.inner.running.load(Ordering::SeqCst),
        access,
    }
}

#[tauri::command]
pub fn get_notification_forward_status(
    db: State<'_, Db>,
    state: State<'_, NotificationForwardState>,
) -> NotificationForwardStatus {
    status_inner(db.inner(), state.inner())
}

#[tauri::command]
pub fn set_notification_forward_enabled(
    app: AppHandle,
    db: State<'_, Db>,
    state: State<'_, NotificationForwardState>,
    enabled: bool,
) -> Result<NotificationForwardStatus, String> {
    db.set_setting(ENABLED_SETTING_KEY, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    if enabled {
        #[cfg(windows)]
        if let Err(e) = start(&app) {
            // 授权被拒等失败场景：回滚开关，状态里带 access 给前端引导
            log_warn!("notification", "start failed: {}", e);
            let _ = db.set_setting(ENABLED_SETTING_KEY, "false");
        }
    } else {
        stop(state.inner());
    }
    Ok(status_inner(db.inner(), state.inner()))
}

#[tauri::command]
pub fn set_notification_takeover_enabled(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.set_setting(TAKEOVER_SETTING_KEY, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notification_known_apps(db: State<'_, Db>) -> Result<Vec<NotificationKnownApp>, String> {
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&db.get_setting(KNOWN_APPS_SETTING_KEY, "{}")).unwrap_or_default();
    let muted = muted_list(db.inner());
    Ok(map
        .into_iter()
        .map(|(aumid, v)| NotificationKnownApp {
            muted: muted.iter().any(|m| m == &aumid),
            name: v.as_str().unwrap_or(&aumid).to_string(),
            aumid,
        })
        .collect())
}

#[tauri::command]
pub fn set_notification_muted_aumids(db: State<'_, Db>, muted: Vec<String>) -> Result<(), String> {
    let json = serde_json::to_string(&muted).map_err(|e| e.to_string())?;
    db.set_setting(MUTED_AUMIDS_SETTING_KEY, &json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_notification_permission_settings(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url("ms-settings:privacy-notifications", None::<&str>)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn fallback_app_name(aumid: &str) -> String {
    match aumid.split('!').next() {
        Some(pkg) if !pkg.is_empty() => pkg.into(),
        _ => "Windows".into(),
    }
}

fn truncate_chars(s: &mut String, max: usize) {
    if s.chars().count() > max {
        let cut: String = s.chars().take(max).collect();
        *s = format!("{cut}…");
    }
}

/// 在自有线程上阻塞等待 WinRT 异步操作（worker 不在 tokio 运行时里，轮询即可）。
/// 0.61 的异步方法签名直接返回 Result<IAsyncOperation<T>>，在此统一解包。
#[cfg(windows)]
fn wait_async<T: windows::core::RuntimeType + 'static>(
    op: windows::core::Result<windows_future::IAsyncOperation<T>>,
) -> windows::core::Result<T> {
    use windows_future::AsyncStatus;
    let op = op?;
    loop {
        let status = op.Status()?;
        if status == AsyncStatus::Completed {
            return op.GetResults();
        }
        if status == AsyncStatus::Error {
            let code = op.ErrorCode()?;
            return Err(windows::core::Error::from(code));
        }
        if status == AsyncStatus::Canceled {
            return Err(windows::core::Error::from(windows::core::HRESULT(-1)));
        }
        thread::sleep(Duration::from_millis(50));
    }
}
