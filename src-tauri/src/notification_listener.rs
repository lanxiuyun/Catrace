//! Windows 系统通知转发 — UserNotificationListener (WinRT) 事件源。
//!
//! 捕获方式：轮询 `GetNotificationsAsync` + HashSet 对账去重，首轮静默灌入
//! 现存通知（不弹历史），之后新出现的才转发。
//!
//! 关于「事件驱动」：`NotificationChanged` 事件订阅对未打包进程不可用——本机
//! 实测 `0x80070490 (ERROR_NOT_FOUND)`，MTA 与显式 STA 线程都一样；能读能删，
//! 就是订不上事件（WinIsland 的注册也包在 try/catch 里、「relying on polling」，
//! 是同一个坑）。所以事件只作为可选增强：订上了是混合模式，订不上就纯轮询，
//! 不影响功能。
//!
//! 「收起系统弹窗」靠 `RemoveNotification`（实测未打包可用）。注意它只能移除、
//! 不能阻止绘制，而且实测是**整条移除**（操作中心条目一起没）——所以只对
//! 「本次新抑制的应用」的首条使用（那条的横幅已经被画出来了），稳态通知必须
//! 留在操作中心。
//!
//! 未打包进程可直接使用该 API（Win11 26200 实测 + WinIsland 裸 EXE 分发印证），
//! 微软未承诺此行为；若未来失效，回退方向是 sparse package 或 wpndatabase 直读。

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::event::{
    BusEvent, DisplayMode, EventAction, EventLevel, EventResolution, EventSource, ResolutionKind,
};
use crate::{log_error, log_info, log_warn};

const ENABLED_SETTING_KEY: &str = "notification_forward_enabled";
const TAKEOVER_SETTING_KEY: &str = "notification_takeover_enabled";
/// 轮询周期。事件订阅不可用时轮询是唯一捕获路径，周期直接等于「卡片延迟」
/// 与「原生弹窗被移除前的可见时长」，所以取 1s 而不是 WinIsland 的 2s。
const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// 发布后延迟 resolve，registry 不留永久 active 事件（防 Toast 窗重建时重放旧通知）
const EVENT_TTL: Duration = Duration::from_secs(35);
const BODY_MAX_CHARS: usize = 200;
/// 系统级提示（如权限询问）会把整段说明塞进标题，不截会撑出一张很高的卡。
const TITLE_MAX_CHARS: usize = 120;
const AUTO_HIDE_MS: i64 = 6000;
const LOGO_MAX_BYTES: u32 = 256 * 1024;

pub const EVENT_TYPE: &str = "system.notification.received";
pub const KIND: &str = "notification";

/// 点卡片本体触发的主操作，走与按钮相同的 trigger 命令；按钮 id 是纯数字
/// 序号（"0"/"1"/…），不会与这个保留 id 撞。
#[cfg(windows)]
const LAUNCH_ACTION_ID: &str = "launch";

const ACCESS_GRANTED: u8 = 1;
const ACCESS_DENIED: u8 = 2;
const ACCESS_UNSPECIFIED: u8 = 3;

#[derive(Default)]
struct StateInner {
    /// 当前 worker 的停机标志。停止时换成 None 并置 true，重开换一份新的——
    /// 不用共享 bool 是因为「关掉再打开」时旧 worker 可能还没退出，共享标志会被
    /// 新一次 start 立刻置回 true，旧 worker 便继续活着，出现两个轮询线程。
    worker: Mutex<Option<Arc<AtomicBool>>>,
    access: AtomicU8,
    /// 按钮规格，按发布事件的 id 存：前端点击只回传 event id + action id，
    /// 规格从这里取。事件 resolve（点击成功 / 35s TTL）时移除。
    #[cfg(windows)]
    action_specs: Mutex<std::collections::HashMap<String, ActionSpecs>>,
    /// 点击成功后待从操作中心移除的源通知 id。RemoveNotification 只有持有
    /// listener 的 worker 能调，命令线程把 id 存这里，worker 每轮循环消费
    /// （一轮一秒内生效）——对齐原生行为：点完按钮 toast 就从操作中心消失。
    #[cfg(windows)]
    pending_ac_removals: Mutex<Vec<u32>>,
}

impl StateInner {
    fn is_running(&self) -> bool {
        self.worker.lock().unwrap().is_some()
    }

    /// 取一份新的停机标志并把状态登记为「运行中」。
    fn register_worker(&self) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        *self.worker.lock().unwrap() = Some(stop.clone());
        stop
    }

    /// 通知当前 worker 退出。
    fn stop_worker(&self) {
        if let Some(stop) = self.worker.lock().unwrap().take() {
            stop.store(true, Ordering::SeqCst);
        }
    }

    /// worker 自己结束时摘除登记。只摘自己那一份——否则一个正在退出的旧 worker
    /// 会把后来者的登记也抹掉，开关状态就跟实际不符了。
    fn retire_worker(&self, mine: &Arc<AtomicBool>) {
        let mut guard = self.worker.lock().unwrap();
        if guard.as_ref().is_some_and(|cur| Arc::ptr_eq(cur, mine)) {
            guard.take();
        }
        mine.store(true, Ordering::SeqCst);
    }
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
        // 起不来的最常见原因是授权被撤。此刻 setup 里的 reconcile 已按「开着」
        // 把横幅压住了，但没有任何转发在跑——通知会既无横幅也无卡片，必须
        // 立即还原。之后授权恢复时，suppress_banner_for 会按应用重新压制。
        if let Err(e) = restore_takeover(db) {
            log_warn!("notification", "restore after failed auto start: {}", e);
        }
    }
}

#[cfg(windows)]
fn start(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<NotificationForwardState>();
    if state.inner.is_running() {
        return Ok(());
    }

    // 授权探测在调用线程上完成——这个 listener 对象只在本线程使用、用完即弃。
    // （曾经把这里的 listener 交给 worker 线程轮询，结果是 0x8001010E
    //   RPC_E_WRONG_THREAD：WinRT 对象有单元亲和性，不能跨线程用。）
    let access_code = probe_access()?;
    state.inner.access.store(access_code, Ordering::SeqCst);
    if access_code != ACCESS_GRANTED {
        return Err("notification listener access denied".into());
    }

    let bus = app.state::<crate::bus::EventBus>().inner().clone();
    let db = app.state::<Db>().inner().clone();

    // 整个 WinRT 会话（Current / 事件订阅 / 轮询 / RemoveNotification）都在 worker
    // 线程里建立并使用，绝不跨线程传递对象。
    let worker_state = state.inner().inner.clone();
    let stop = state.inner.register_worker();
    thread::spawn(move || worker_loop(bus, db, worker_state, stop));
    Ok(())
}

/// 只读探测通知访问授权（在调用线程上用同一个 listener 对象完成，不跨线程）。
#[cfg(windows)]
fn probe_access() -> Result<u8, String> {
    use windows::UI::Notifications::Management::{
        UserNotificationListener, UserNotificationListenerAccessStatus,
    };
    let listener = UserNotificationListener::Current().map_err(|e| e.to_string())?;
    let access = wait_async(listener.RequestAccessAsync()).map_err(|e| e.to_string())?;
    Ok(match access {
        UserNotificationListenerAccessStatus::Allowed => ACCESS_GRANTED,
        UserNotificationListenerAccessStatus::Denied => ACCESS_DENIED,
        _ => ACCESS_UNSPECIFIED,
    })
}

fn stop(state: &NotificationForwardState) {
    // worker 每轮循环检查自己的停机标志；注销事件句柄在 worker 退出时完成
    state.inner.stop_worker();
}

// ---------------------------------------------------------------------------
// worker：在自有线程上持有整个 WinRT 会话（事件订阅若可用 + 轮询）
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn worker_loop(
    bus: crate::bus::EventBus,
    db: Db,
    state: Arc<StateInner>,
    stop: Arc<AtomicBool>,
) {
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::Management::UserNotificationListener;
    use windows::UI::Notifications::{NotificationKinds, UserNotificationChangedKind};

    // 本线程自己初始化 COM 单元；已初始化过会返回 S_FALSE / RPC_E_CHANGED_MODE，
    // 都不是错误，忽略即可。
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let listener = match UserNotificationListener::Current() {
        Ok(l) => l,
        Err(e) => {
            log_error!("notification", "listener unavailable on worker thread: {}", e);
            state.retire_worker(&stop);
            return;
        }
    };
    let toast_kind = NotificationKinds::Toast;

    // 事件订阅（可选增强）。订阅失败时 handler 不会被注册、随作用域析构，而它
    // 持有发送端——发送端全没了通道就断开、recv_timeout 立刻返回 Disconnected。
    // 所以留一份保活发送端在本线程里。
    let (event_tx, event_rx) = mpsc::channel::<u32>();
    let _event_tx_keepalive = event_tx.clone();
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
    // 未打包进程订不上：实测 0x80070490 (ERROR_NOT_FOUND)，MTA / STA 都一样；
    // WinIsland 同样降级（它的注册也包在 try/catch 里、注释写着 relying on polling）。
    let token = match listener.NotificationChanged(&handler) {
        Ok(t) => {
            log_info!("notification", "event subscription ok, hybrid capture");
            Some(t)
        }
        Err(e) => {
            log_warn!(
                "notification",
                "event subscription unavailable ({}), polling only",
                e
            );
            None
        }
    };

    let mut known: std::collections::HashSet<u32> = std::collections::HashSet::new();
    // 首轮静默对账：操作中心现存通知只入集合不弹卡，避免启动时轰炸历史
    if let Err(e) = seed_known(&listener, &toast_kind, &mut known) {
        log_warn!("notification", "initial reconciliation failed: {}", e);
    }
    log_info!(
        "notification",
        "listener started ({} capture, {} ms poll, {} existing noted)",
        if token.is_some() { "event+poll" } else { "poll-only" },
        POLL_INTERVAL.as_millis(),
        known.len()
    );

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        // 命令线程交付的「点击成功后待移除的源通知」，见 drain_pending_removals
        drain_pending_removals(&listener, &state);
        match event_rx.recv_timeout(POLL_INTERVAL) {
            Ok(id) => {
                if known.insert(id) {
                    process_notification(&listener, &bus, &db, &state, id);
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                poll_once(&listener, &toast_kind, &bus, &db, &state, &mut known)
            }
            // 有保活发送端时不会断开；真发生了也不能退出，更不能空转
            // （断开后 recv_timeout 立刻返回，不睡就是忙等烧 CPU）。
            Err(RecvTimeoutError::Disconnected) => {
                thread::sleep(POLL_INTERVAL);
                poll_once(&listener, &toast_kind, &bus, &db, &state, &mut known);
            }
        }
    }

    // 退出前把队列里剩下的也清掉——此刻 listener 还活着，错过就没人能移了
    drain_pending_removals(&listener, &state);
    if let Some(token) = token {
        let _ = listener.RemoveNotificationChanged(token);
    }
    state.retire_worker(&stop);
    log_info!("notification", "listener stopped");
}

/// 首轮对账：现存通知只记入已知集合，不转发。
#[cfg(windows)]
fn seed_known(
    listener: &windows::UI::Notifications::Management::UserNotificationListener,
    toast_kind: &windows::UI::Notifications::NotificationKinds,
    known: &mut std::collections::HashSet<u32>,
) -> Result<(), String> {
    let view = wait_async(listener.GetNotificationsAsync(*toast_kind)).map_err(|e| e.to_string())?;
    for n in view {
        let _ = known.insert(n.Id().unwrap_or(0));
    }
    Ok(())
}

/// 拉一次全量通知，转发新出现的，并把已消失的移出已知集合。
#[cfg(windows)]
fn poll_once(
    listener: &windows::UI::Notifications::Management::UserNotificationListener,
    toast_kind: &windows::UI::Notifications::NotificationKinds,
    bus: &crate::bus::EventBus,
    db: &Db,
    state: &Arc<StateInner>,
    known: &mut std::collections::HashSet<u32>,
) {
    match wait_async(listener.GetNotificationsAsync(*toast_kind)) {
        Ok(view) => {
            let mut current = std::collections::HashSet::new();
            for n in view {
                let id = n.Id().unwrap_or(0);
                current.insert(id);
                if known.insert(id) {
                    process_notification(listener, bus, db, state, id);
                }
            }
            known.retain(|id| current.contains(id));
        }
        Err(e) => log_warn!("notification", "poll failed: {}", e),
    }
}

/// 消费命令线程交付的待移除源通知。原生行为是点完按钮 toast 就从操作中心
/// 消失；RemoveNotification 只有持有 listener 的 worker 能调，所以走队列转交。
#[cfg(windows)]
fn drain_pending_removals(
    listener: &windows::UI::Notifications::Management::UserNotificationListener,
    state: &Arc<StateInner>,
) {
    let pending: Vec<u32> = std::mem::take(&mut *state.pending_ac_removals.lock().unwrap());
    for nid in pending {
        if let Err(e) = listener.RemoveNotification(nid) {
            log_warn!("notification", "remove actioned notification {nid} failed: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// 单条通知处理
// ---------------------------------------------------------------------------

/// 事件 TTL 兜底队列：发布时推入 (到期时刻, event id)，由唯一的清扫线程到点
/// resolve（顺带清按钮规格）。多数事件在此之前已被前端自动收起时 resolve 过，
/// 迟到的 resolve 会被 bus 以「event is not active」拒绝，吞掉即可——这正是
/// 「安全网」语义：只兜漏网之鱼。
static TTL_QUEUE: Mutex<Vec<(Instant, String)>> = Mutex::new(Vec::new());

/// 确保 TTL 清扫线程在跑（整个进程只起一个）。此前是「每条通知 spawn 一个
/// 睡眠线程」，通知风暴下会堆起一堆只睡不干的线程；改为单一 1s tick 的清扫，
/// 到点最多晚 1 秒，对 35s 的 TTL 无感。
#[cfg(windows)]
fn ensure_ttl_sweeper(bus: crate::bus::EventBus, state: Arc<StateInner>) {
    static STARTED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    STARTED.get_or_init(|| {
        thread::Builder::new()
            .name("notif-ttl".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_secs(1));
                let now = Instant::now();
                // deadline 一律是「推入时刻 + EVENT_TTL」，推入序即升序，到期项必是前缀
                let due: Vec<String> = {
                    let mut q = TTL_QUEUE.lock().unwrap();
                    let split = q.partition_point(|(deadline, _)| *deadline <= now);
                    q.drain(..split).map(|(_, id)| id).collect()
                };
                for event_id in due {
                    state.action_specs.lock().unwrap().remove(&event_id);
                    let _ = bus.resolve(
                        event_id,
                        EventResolution {
                            kind: ResolutionKind::Expired,
                            action_id: None,
                            payload: None,
                        },
                    );
                }
            })
            .expect("spawn notification ttl sweeper");
    });
}

#[cfg(windows)]
fn process_notification(
    listener: &windows::UI::Notifications::Management::UserNotificationListener,
    bus: &crate::bus::EventBus,
    db: &Db,
    state: &Arc<StateInner>,
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
    // AppInfo.Id 不是 AUMID（实测多为空、"App"）；真正的 AUMID 在 AppUserModelId。
    // 少数来源（系统提示等）连 AUMID 都不上报，退回应用名做标识，否则这些应用
    // 会全部挤进同一个空 key，"按应用静音"就失效了。
    let aumid = app_info
        .AppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let app_name = app_info
        .DisplayInfo()
        .ok()
        .and_then(|d| d.DisplayName().ok())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_app_name(&aumid));
    let app_key = if aumid.is_empty() {
        app_name.clone()
    } else {
        aumid.clone()
    };

    // 按钮必须在发布**之前**读——闪现式移除后数据库行就没了。监听 API 只暴露
    // 文本，按钮与主操作读自通知数据库，见 collect_notification_actions。
    let (toast_actions, activator, launch_action) = collect_notification_actions(id, &aumid);

    let icon = extract_logo_data_url(&app_info);
    // 只记来源与长度，不落正文——通知内容可能是敏感信息
    log_info!(
        "notification",
        "forwarding app={:?} id={} title_len={} body_len={}",
        app_name,
        id,
        title.chars().count(),
        body.chars().count()
    );

    let event = BusEvent {
        id: String::new(),
        event_type: EVENT_TYPE.into(),
        source: EventSource::Internal,
        kind: KIND.into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title,
        body,
        actions: toast_actions
            .iter()
            .map(|a| EventAction {
                id: a.id.clone(),
                label: a.label.clone(),
                payload: None,
            })
            .collect(),
        progress: None,
        sticky: None,
        payload: serde_json::json!({
            "app_name": app_name,
            "aumid": app_key,
            "icon_data_url": icon,
            "auto_hide_ms": AUTO_HIDE_MS,
            "body_clickable": launch_action.is_some(),
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
            // 接管模式下，只有「本次真的给新应用写了 ShowBanner=0」才收走系统通知：
            // 那条的横幅已经被系统画出来了（我们只能在事后学到它的 AUMID），把它连
            // 横幅带操作中心条目一起收掉。稳态通知（横幅早被压住、直接进操作中心的）
            // 绝不能移——RemoveNotification 实测是整条移除，每条都移会让操作中心
            // 空掉，和设置页「通知仍会进操作中心」的承诺矛盾。bus 失败时保留系统
            // 通知——至少一处可见。
            let newly_suppressed = db.get_setting(TAKEOVER_SETTING_KEY, "false") == "true"
                // 用真 AUMID，不是 app_key——app_key 在缺少 AUMID 时会退回应用名，
                // 拿应用名当注册表子键写进去是脏数据。
                && suppress_banner_for(db, &aumid);
            if newly_suppressed {
                if let Err(e) = listener.RemoveNotification(id) {
                    log_warn!("notification", "remove system notification failed: {}", e);
                }
            }
            // 按钮与主操作规格按发布事件的 id 存档，点击时按 event id + action id
            // 取回；事件 resolve（点击成功 / 下方 TTL）时移除，不留陈旧规格。
            if !toast_actions.is_empty() || launch_action.is_some() {
                state.action_specs.lock().unwrap().insert(
                    published.id.clone(),
                    ActionSpecs {
                        notification_id: id,
                        aumid: aumid.clone(),
                        activator,
                        actions: toast_actions,
                        launch: launch_action,
                    },
                );
            }
            ensure_ttl_sweeper(bus.clone(), state.clone());
            TTL_QUEUE
                .lock()
                .unwrap()
                .push((Instant::now() + EVENT_TTL, published.id));
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
    truncate_chars(&mut title, TITLE_MAX_CHARS);
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

fn access_label(code: u8) -> String {
    match code {
        ACCESS_GRANTED => "granted",
        ACCESS_DENIED => "denied",
        ACCESS_UNSPECIFIED => "unspecified",
        _ => "unknown",
    }
    .into()
}

// ---------------------------------------------------------------------------
// 收起原生弹窗：给每个应用写 ShowBanner=0
// ---------------------------------------------------------------------------

// RemoveNotification 只能移除已经画出来的弹窗、拦不住绘制，且实测是**整条移除**
// （操作中心条目一起没）——所以它只用于「本次新抑制的应用」的首条，稳态通知必须
// 留在操作中心。真正「不弹」只能让系统别画：在 HKCU 的通知设置里给该应用写
// ShowBanner=0，通知照常进操作中心、监听器照常读到。系统里这个键下每个子键名就是
// AUMID，与我们用的 AppUserModelId 同源；默认**没有** ShowBanner 值（= 显示横幅），
// 所以抑制是写 0、还原是删掉该值（或恢复记录到的原值）。
//
// 这是对用户系统设置的改动，因此：改动前先把原值记进 settings 表
// （notification_takeover_backup），关闭开关 / 关功能 / 退出应用都会还原；
// 启动时按当前开关对齐一次（上次崩溃留下的状态也能自愈）。
//
// 所有「注册表 ShowBanner + 备份」的读写共用一把锁：关开关的 restore 和 worker
// 最后一轮的 suppress 可能并发（停机标志只在轮询循环顶部检查，正在处理的那条
// 会走完全流程），不加锁时「restore 刚清完、suppress 又写回」会留下既无横幅
// 也无转发的孤儿值。

const SHOW_BANNER_VALUE: &str = "ShowBanner";
const TAKEOVER_BACKUP_SETTING_KEY: &str = "notification_takeover_backup";

static TAKEOVER_LOCK: Mutex<()> = Mutex::new(());

#[cfg(windows)]
const NOTIF_SETTINGS_PATH: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";

/// aumid → 原始 ShowBanner 值；`None` 表示原本没有这个值（要删掉才算还原）。
type TakeoverBackup = std::collections::BTreeMap<String, Option<u32>>;

fn load_backup(db: &Db) -> TakeoverBackup {
    serde_json::from_str(&db.get_setting(TAKEOVER_BACKUP_SETTING_KEY, "{}")).unwrap_or_default()
}

fn save_backup(db: &Db, backup: &TakeoverBackup) {
    let json = serde_json::to_string(backup).unwrap_or_else(|_| "{}".into());
    // 备份写失败 = 已写下去的 ShowBanner=0 从此没有还原依据（孤儿值），必须留痕
    if let Err(e) = db.set_setting(TAKEOVER_BACKUP_SETTING_KEY, &json) {
        log_error!("notification", "save takeover backup failed: {}", e);
    }
}

/// 以**读写**权限打开子键。注意 `Key::open` 只请求 KEY_READ——用它拿到句柄再写
/// 会静默失败（表现为「枚举到了子键但改动数为 0」），必须显式 `options().read().write()`。
#[cfg(windows)]
fn open_rw(parent: &windows_registry::Key, path: &str) -> Option<windows_registry::Key> {
    parent.options().read().write().open(path).ok()
}

/// 递归下钻抑制。**必须递归**：扁平 AUMID（如 `Chrome`）的设置就在 Settings 的直接
/// 子键上，而路径式 AUMID（如 `{1AC14E77-…}\WindowsPowerShell\v1.0\powershell.exe`，
/// 传统 Win32 应用多为此类）被平台存成了**嵌套子键**，只扫一层会漏掉它们。
#[cfg(windows)]
fn suppress_tree(
    root: &windows_registry::Key,
    rel: &str,
    backup: &mut TakeoverBackup,
    changed: &mut usize,
) {
    let Some(key) = open_rw(root, rel) else {
        return;
    };
    if !backup.contains_key(rel) {
        let original = key.get_u32(SHOW_BANNER_VALUE).ok();
        if key.set_u32(SHOW_BANNER_VALUE, 0).is_ok() {
            backup.insert(rel.to_string(), original);
            *changed += 1;
        }
    }
    if let Ok(names) = key.keys() {
        for name in names {
            if name.is_empty() {
                continue;
            }
            suppress_tree(root, &format!(r"{rel}\{name}"), backup, changed);
        }
    }
}

/// 给 path 下所有应用写 ShowBanner=0，逐个记录原值。
#[cfg(windows)]
fn suppress_banners_at(db: &Db, path: &str) -> Result<usize, String> {
    let _guard = TAKEOVER_LOCK.lock().unwrap();
    let root = windows_registry::CURRENT_USER
        .create(path)
        .map_err(|e| e.to_string())?;
    let mut backup = load_backup(db);
    let mut changed = 0usize;
    for name in root.keys().map_err(|e| e.to_string())? {
        if name.is_empty() {
            continue;
        }
        suppress_tree(&root, &name, &mut backup, &mut changed);
    }
    save_backup(db, &backup);
    Ok(changed)
}

/// 按备份还原所有改动过的 ShowBanner。只把**成功还原**的条目从备份里摘掉，
/// 失败的留着——下轮 reconcile（重启 / 切开关）会重试；无脑清空备份会把
/// 没还原成的键变成孤儿（ShowBanner 永远压着，既无横幅也无转发）。
#[cfg(windows)]
fn restore_banners_at(db: &Db, path: &str) -> Result<usize, String> {
    let _guard = TAKEOVER_LOCK.lock().unwrap();
    let backup = load_backup(db);
    if backup.is_empty() {
        return Ok(0);
    }
    let mut restored = 0usize;
    let mut remaining = TakeoverBackup::new();
    // 还原只打开已存在的键：键不在了就没什么可还原的，不要凭空创建
    if let Some(root) = open_rw(windows_registry::CURRENT_USER, path) {
        for (aumid, original) in &backup {
            // 先只读探测：键真不在了（应用的通知设置项被系统删了）才放弃还原；
            // 只读打得开而写打不开可能是瞬时问题，直接丢弃会让原值从此没有
            // 还原依据（孤儿值），留在备份里等下轮 reconcile 重试。
            if root.open(aumid).is_err() {
                continue;
            }
            let Some(sub) = open_rw(&root, aumid) else {
                remaining.insert(aumid.clone(), *original);
                continue;
            };
            let ok = match original {
                Some(v) => sub.set_u32(SHOW_BANNER_VALUE, *v).is_ok(),
                // 原本没有这个值：删掉。值不存在时删除会报错，等同已还原。
                None => sub.remove_value(SHOW_BANNER_VALUE).is_ok()
                    || sub.get_u32(SHOW_BANNER_VALUE).is_err(),
            };
            if ok {
                restored += 1;
            } else {
                remaining.insert(aumid.clone(), *original);
            }
        }
    } else {
        // 根键都打不开：一个都没还原，备份原样保留，等下轮 reconcile 重试
        log_warn!("notification", "restore takeover: settings key unavailable, backup kept");
        return Ok(0);
    }
    save_backup(db, &remaining);
    Ok(restored)
}

/// 按「功能开关 + 收起弹窗开关」把注册表对齐到应有的状态。
/// 幂等，可反复调用：启动、切开关都走它。
#[cfg(windows)]
pub fn reconcile_takeover(db: &Db) -> Result<(), String> {
    // 功能关了就不该再压着系统横幅——否则通知既没有原生横幅、Catrace 也不转发，
    // 用户只能去操作中心翻。
    let wanted = db.get_setting(ENABLED_SETTING_KEY, "false") == "true"
        && db.get_setting(TAKEOVER_SETTING_KEY, "false") == "true";
    if !wanted {
        let n = restore_banners_at(db, NOTIF_SETTINGS_PATH)?;
        if n > 0 {
            log_info!("notification", "takeover off: restored {} app banner(s)", n);
        }
        return Ok(());
    }

    let changed = suppress_banners_at(db, NOTIF_SETTINGS_PATH)?;
    if changed > 0 {
        log_info!(
            "notification",
            "takeover on: ShowBanner=0 written to {} key(s) (incl. container levels)",
            changed
        );
    }
    Ok(())
}

/// 转发途中遇到的新应用：立刻抑制它的横幅，让「下一条」不再闪。
/// （当前这条无论如何已经画出来了——我们只能在事后学到它的 AUMID。）
/// 返回是否**本次新写了**抑制——只有这种情况才需要把已画出的那条收走。
#[cfg(windows)]
fn suppress_banner_for(db: &Db, aumid: &str) -> bool {
    if aumid.is_empty() {
        return false;
    }
    let _guard = TAKEOVER_LOCK.lock().unwrap();
    // worker 停机前可能还在处理最后一条通知，而用户此刻已经把开关关了：
    // 锁内重读两把开关，关了就绝不能再写——否则刚跑完的 restore 会被写回，
    // 留下「无横幅也无转发」的孤儿状态。
    if db.get_setting(ENABLED_SETTING_KEY, "false") != "true"
        || db.get_setting(TAKEOVER_SETTING_KEY, "false") != "true"
    {
        return false;
    }
    let mut backup = load_backup(db);
    if backup.contains_key(aumid) {
        return false;
    }
    let Ok(root) = windows_registry::CURRENT_USER.create(NOTIF_SETTINGS_PATH) else {
        return false;
    };
    // 路径式 AUMID 会被 create 逐层建出来，正好让后续通知一开始就被抑制
    let Ok(sub) = root.create(aumid) else {
        return false;
    };
    let original = sub.get_u32(SHOW_BANNER_VALUE).ok();
    if sub.set_u32(SHOW_BANNER_VALUE, 0).is_ok() {
        backup.insert(aumid.to_string(), original);
        save_backup(db, &backup);
        log_info!("notification", "suppressed native banner for new app {:?}", aumid);
        return true;
    }
    false
}

#[cfg(not(windows))]
pub fn reconcile_takeover(_db: &Db) -> Result<(), String> {
    Ok(())
}

/// 无条件还原被压下去的系统横幅（退出时用，不看开关状态）。
#[cfg(windows)]
pub fn restore_takeover(db: &Db) -> Result<(), String> {
    let n = restore_banners_at(db, NOTIF_SETTINGS_PATH)?;
    if n > 0 {
        log_info!("notification", "restored {} app banner(s) on exit", n);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn restore_takeover(_db: &Db) -> Result<(), String> {
    Ok(())
}

// ---------------------------------------------------------------------------
// 通知按钮与主操作：wpndatabase 读取 + 解析 + 点击触发
// ---------------------------------------------------------------------------

// 监听 API 只暴露文本（NotificationBinding 仅有 GetTextElements），按钮数据不在
// 其中，要从通知平台的数据库 wpndatabase.db 读——Payload 列就是 toast XML。
// 三条实测约束：
//   1. 只读连接用 mode=ro，不要加 immutable=1——加了 SQLite 会无视 WAL，
//      读到陈旧快照（实测最新 id 停在 3368，平台已到 3392）；
//   2. 必须在 RemoveNotification **之前**读：被移除的通知在库里连行一起删；
//   3. 库里的 Notification.Id 就是监听器的 id，按 id join 精确命中，无启发式。
//
// 点击触发（本机实测）：
//   - protocol 型：arguments 即目标 URI，直接打开；
//   - background/foreground 型：用 HKCU/HKLM\Software\Classes\AppUserModelId 下
//     该 AUMID 注册的 CustomActivator（CLSID），CoCreateInstance +
//     INotificationActivationCallback::Activate 忠实回调应用的激活器——等价于
//     用户在原生 toast 上点按钮后系统的调用方式；
//   - 打包应用（ChatGPT/Outlook 等）的 activator 登记在 PackagedCom 目录，
//     CoCreateInstance 找不到（REGDB_E_CLASSNOTREG）——这类按钮一律不渲染；
//   - 带输入框（hint-inputId）的按钮跳过并记日志：快捷回复刻意不做（全机可达
//     目标几乎没有），渲染点了没反应的按钮更糟。
//
// 通知**本体**点击同理（原生 toast 整块可点）：主操作读自 toast 根元素的
// launch / activationType，可触发规则与按钮一致；launch 缺失时原生点击也只是
// 收起，卡片主体同样不做。

/// 宿主存档的可点击按钮规格，按发布事件的 id 存于 `StateInner::action_specs`。
#[cfg(windows)]
#[derive(Debug, Clone)]
struct ActionSpecs {
    /// 源系统通知 id：点击成功后 worker 用它把 toast 从操作中心移除
    notification_id: u32,
    aumid: String,
    /// 该应用注册的通知激活器 CLSID（发布时已解析；None = 没有可达激活器）
    activator: Option<String>,
    actions: Vec<StoredAction>,
    /// toast 根元素的主操作（点卡片本体）；None = 原生点击也只是收起
    launch: Option<StoredAction>,
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct StoredAction {
    /// 过滤后的序号（从 0 起），作为 EventAction.id 给前端、点击时原样传回
    id: String,
    label: String,
    arguments: String,
    /// protocol | background | foreground
    activation_type: String,
}

/// 从 toast XML 解析出的一个按钮元素
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, PartialEq)]
struct ParsedToastAction {
    content: String,
    activation_type: String,
    arguments: String,
    /// 带 hint-inputId 属性（回复框）——此类按钮不渲染
    needs_input: bool,
}

/// 解码 Payload。toast XML 以 UTF-8 为主，历史上也有 UTF-16LE 存量
/// （ASCII 区间的奇数位字节为 0，据此区分）。
#[cfg(any(windows, test))]
fn decode_notification_payload(blob: &[u8]) -> Option<String> {
    if blob.len() >= 2 && blob[0] != 0 && blob[1] == 0 {
        let units: Vec<u16> = blob
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16(&units).ok()
    } else {
        String::from_utf8(blob.to_vec()).ok()
    }
}

/// 展开 XML 具名与数字实体。protocol 按钮的 arguments 带 `&` 时平台存成
/// `&amp;`，不展开则传给应用的 URI 缺字符。
#[cfg(any(windows, test))]
fn unescape_xml(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let decoded = rest.find(';').and_then(|j| {
            let entity = rest.get(..=j)?;
            let c = match entity {
                "&amp;" => '&',
                "&lt;" => '<',
                "&gt;" => '>',
                "&quot;" => '"',
                "&apos;" => '\'',
                _ => {
                    let inner = &entity[1..entity.len() - 1];
                    let code = if let Some(hex) =
                        inner.strip_prefix("#x").or_else(|| inner.strip_prefix("#X"))
                    {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        inner.strip_prefix('#').and_then(|d| d.parse::<u32>().ok())
                    };
                    char::from_u32(code?)?
                }
            };
            Some((c, entity.len()))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// 标签结束于第一个不在引号内的 `>`：属性值里的 `>` 在 XML 里合法，
/// 平台不总是转义它，按「引号感知」扫才不会把标签截断。返回 `>` 的下标。
#[cfg(any(windows, test))]
fn find_tag_end(tag_start: &str) -> Option<usize> {
    let mut in_quote = false;
    let mut quote_char = b'"';
    for (i, &b) in tag_start.as_bytes().iter().enumerate().skip(1) {
        if in_quote {
            if b == quote_char {
                in_quote = false;
            }
        } else if b == b'"' || b == b'\'' {
            in_quote = true;
            quote_char = b;
        } else if b == b'>' {
            return Some(i);
        }
    }
    None
}

/// 取标签内某属性的值（带前缀边界校验 + 实体展开）。前缀校验避免把
/// `hint-content="` 里的 `content="` 误当 content 属性。
#[cfg(any(windows, test))]
fn tag_attr(tag: &str, name: &str) -> Option<String> {
    let mut from = 0;
    while let Some(rel) = tag[from..].find(&format!("{name}=\"")) {
        let at = from + rel;
        if at == 0 || tag[..at].ends_with(' ') || tag[..at].ends_with('<') {
            let value = &tag[at + name.len() + 2..];
            let value = &value[..value.find('"')?];
            return Some(unescape_xml(value));
        }
        from = at + name.len();
    }
    None
}

/// 从 toast XML 抽 `<action>` 元素：只做属性提取、不做完整 XML 解析——payload
/// 由平台或应用按 toast schema 生成、结构稳定；属性缺失就丢弃该元素。
/// 注意 `<actions>` 开头同样命中 `<action` 字面量，靠「无 content 属性」跳过，
/// 且搜索从其 `>` 之后继续，不影响真正的按钮。
#[cfg(any(windows, test))]
fn parse_toast_actions(xml: &str) -> Vec<ParsedToastAction> {
    let mut out = vec![];
    let mut rest = xml;
    while let Some(start) = rest.find("<action") {
        rest = &rest[start..];
        let Some(end) = find_tag_end(rest) else { break };
        let tag = &rest[..=end];
        rest = &rest[end..];
        let Some(content) = tag_attr(tag, "content") else { continue };
        if content.is_empty() {
            continue;
        }
        out.push(ParsedToastAction {
            needs_input: tag.contains("hint-inputId"),
            activation_type: tag_attr(tag, "activationType").unwrap_or_else(|| "foreground".into()),
            arguments: tag_attr(tag, "arguments").unwrap_or_default(),
            content,
        });
    }
    out
}

/// 解析 toast 根元素 `<toast launch="…" activationType="…">`——点通知本体的
/// 「主操作」。launch 缺失/为空时原生 toast 点了也只是收起，返回 None；
/// activationType 按 schema 缺省是 foreground。
#[cfg(any(windows, test))]
fn parse_toast_launch(xml: &str) -> Option<(String, String)> {
    let start = xml.find("<toast")?;
    let rest = &xml[start..];
    // 边界校验："<toast" 共 6 个字符，其后必须是空白或 `>`，
    // 排除恰好以此为前缀的其他元素名（如 <toastful>）
    match rest.as_bytes().get(6) {
        Some(&b) if b == b'>' || b.is_ascii_whitespace() => {}
        _ => return None,
    }
    let end = find_tag_end(rest)?;
    let tag = &rest[..=end];
    let launch = tag_attr(tag, "launch")?;
    if launch.is_empty() {
        return None;
    }
    let activation_type = tag_attr(tag, "activationType").unwrap_or_else(|| "foreground".into());
    Some((launch, activation_type))
}

/// 从通知数据库读该条通知的 toast XML Payload。任何一步失败都返回 None：
/// 卡片没有按钮，转发不受影响。
#[cfg(windows)]
fn read_toast_payload(notification_id: u32) -> Option<Vec<u8>> {
    use rusqlite::OpenFlags;
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let path =
        std::path::Path::new(&local).join(r"Microsoft\Windows\Notifications\wpndatabase.db");
    let conn =
        rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.query_row(
        "SELECT Payload FROM Notification WHERE Id = ?1 AND Type = 'toast'",
        [notification_id as i64],
        |row| row.get(0),
    )
    .ok()
}

/// 查该 AUMID 注册的通知激活器。未打包桌面应用登记在 HKCU/HKLM\Software\Classes
/// \AppUserModelId\<aumid>；打包应用在 PackagedCom 目录，这里查不到——
/// 它们的 background/foreground 按钮就此不渲染。
#[cfg(windows)]
fn resolve_activator(aumid: &str) -> Option<String> {
    let rel = format!(r"Software\Classes\AppUserModelId\{aumid}");
    for root in [&windows_registry::CURRENT_USER, &windows_registry::LOCAL_MACHINE] {
        let Ok(key) = root.open(&rel) else { continue };
        if let Ok(clsid) = key.get_string("CustomActivator") {
            if !clsid.is_empty() {
                return Some(clsid);
            }
        }
    }
    None
}

/// 读出并过滤可渲染的按钮与主操作。返回（按钮，激活器，主操作）；激活器一并
/// 进 specs 供点击用。主操作读自 toast 根元素，与按钮同一条可触发规则：
/// protocol 直开 URI，background/foreground 只有应用注册了激活器才算可达。
#[cfg(windows)]
fn collect_notification_actions(
    notification_id: u32,
    aumid: &str,
) -> (Vec<StoredAction>, Option<String>, Option<StoredAction>) {
    let Some(blob) = read_toast_payload(notification_id) else {
        return (vec![], None, None);
    };
    let Some(xml) = decode_notification_payload(&blob) else {
        return (vec![], None, None);
    };
    let activator = if aumid.is_empty() {
        None
    } else {
        resolve_activator(aumid)
    };
    let renderable =
        |activation_type: &str| match activation_type {
            "protocol" => true,
            // background/foreground 只有应用注册了激活器才可能忠实触发
            "background" | "foreground" => activator.is_some(),
            _ => false,
        };
    let launch = parse_toast_launch(&xml).and_then(|(arguments, activation_type)| {
        renderable(&activation_type).then(|| StoredAction {
            id: LAUNCH_ACTION_ID.into(),
            label: String::new(),
            arguments,
            activation_type,
        })
    });
    let mut out: Vec<StoredAction> = vec![];
    for pa in parse_toast_actions(&xml) {
        if pa.needs_input {
            log_info!("notification", "action {:?} needs input, skipped", pa.content);
            continue;
        }
        if !renderable(&pa.activation_type) {
            continue;
        }
        out.push(StoredAction {
            id: out.len().to_string(),
            label: pa.content,
            arguments: pa.arguments,
            activation_type: pa.activation_type,
        });
    }
    (out, activator, launch)
}

/// 调用应用注册的通知激活器。InprocServer32 形式的激活器其 DLL 会被加载进本
/// 进程——这正是原生系统从 toast 点击唤起时的机制，无额外越权。
#[cfg(windows)]
fn activate_via_activator(clsid: &str, aumid: &str, arguments: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Notifications::INotificationActivationCallback;

    // 命令线程可能从未碰过 COM，先初始化一次（已初始化的报错忽略）
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        // GUID::try_from 只收 36 位裸格式；注册表里的 CustomActivator 带 {} 花括号
        let bare = clsid.trim().trim_start_matches('{').trim_end_matches('}');
        let guid: windows::core::GUID =
            windows::core::GUID::try_from(bare).map_err(|_| format!("invalid CLSID {clsid:?}"))?;
        let callback: INotificationActivationCallback =
            CoCreateInstance(&guid, None::<&windows::core::IUnknown>, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance({clsid:?}) failed: {e}"))?;
        callback
            .Activate(&HSTRING::from(aumid), &HSTRING::from(arguments), &[])
            .map_err(|e| format!("Activate failed: {e}"))
    }
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
        running: state.inner.is_running(),
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
    // 功能关掉时必须把系统横幅还回去，否则通知既无原生横幅、也不转发
    if let Err(e) = reconcile_takeover(db.inner()) {
        log_warn!("notification", "reconcile takeover failed: {}", e);
    }
    Ok(status_inner(db.inner(), state.inner()))
}

#[tauri::command]
pub fn set_notification_takeover_enabled(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.set_setting(TAKEOVER_SETTING_KEY, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    reconcile_takeover(db.inner())
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

/// 转发卡片上的点击（按钮 + 点卡片本体的主操作）：前端只回传 event id +
/// action id，规格从 `StateInner::action_specs` 取。成功：resolve 事件（卡片随
/// 总线的 resolved 事件消失）+ 源通知交给 worker 从操作中心移除；失败：返回
/// Err、卡片保留可重试（规格不动）。
#[tauri::command]
pub fn trigger_notification_action(
    app: AppHandle,
    bus: State<'_, crate::bus::EventBus>,
    state: State<'_, NotificationForwardState>,
    event_id: String,
    action_id: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        trigger_notification_action_inner(app, bus.inner(), state.inner(), &event_id, &action_id)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, bus, state, event_id, action_id);
        Ok(())
    }
}

#[cfg(windows)]
fn trigger_notification_action_inner(
    app: AppHandle,
    bus: &crate::bus::EventBus,
    state: &NotificationForwardState,
    event_id: &str,
    action_id: &str,
) -> Result<(), String> {
    let Some(spec) = state
        .inner
        .action_specs
        .lock()
        .unwrap()
        .get(event_id)
        .cloned()
    else {
        // 规格没了 = 事件已过期（35s TTL resolve 过）或已被消费；此时卡片
        // 多半也消失了，但卡片若还挂着（水合旧事件），报错让前端提示
        return Err(format!("action spec not found for event {event_id:?}"));
    };
    let action = if action_id == LAUNCH_ACTION_ID {
        spec.launch.clone()
    } else {
        spec.actions.iter().find(|a| a.id == action_id).cloned()
    };
    let Some(action) = action else {
        return Err(format!("action {action_id:?} not found"));
    };
    match action.activation_type.as_str() {
        "protocol" => {
            // protocol 按钮的 arguments 就是目标 URI 本身
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(&action.arguments, None::<&str>)
                .map_err(|e| format!("open {:?} failed: {e}", action.arguments))?;
        }
        _ => {
            let Some(clsid) = &spec.activator else {
                return Err("activator unresolvable".into());
            };
            activate_via_activator(clsid, &spec.aumid, &action.arguments)?;
        }
    }
    // 到这里才算成功：消费规格（一份规格只许点一次），交付移除、resolve 事件
    state.inner.action_specs.lock().unwrap().remove(event_id);
    state
        .inner
        .pending_ac_removals
        .lock()
        .unwrap()
        .push(spec.notification_id);
    bus.resolve(
        event_id.to_string(),
        EventResolution {
            kind: ResolutionKind::Action,
            action_id: Some(action_id.to_string()),
            payload: None,
        },
    )?;
    Ok(())
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



#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// 回归：事件订阅失败时 handler 不会被注册、连带它持有的发送端一起析构。
    /// 若不在 worker 里留一份保活发送端，通道会立刻断开，recv_timeout 马上返回
    /// Disconnected —— 症状就是日志里 listener started 和 stopped 记在同一秒、
    /// 一条通知都捕获不到。
    #[test]
    fn keepalive_sender_prevents_premature_disconnect() {
        let (tx, rx) = mpsc::channel::<u32>();
        let keepalive = tx.clone();
        // 模拟 handler 未被注册而被析构
        drop(tx);

        match rx.recv_timeout(Duration::from_millis(120)) {
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                panic!("通道提前断开：worker 会立刻退出，通知全部丢失")
            }
            Ok(v) => panic!("不该收到数据: {v}"),
        }

        // 保活也丢掉时才允许断开（这是 Disconnected 分支存在的理由）
        drop(keepalive);
        assert!(matches!(
            rx.recv_timeout(Duration::from_millis(120)),
            Err(RecvTimeoutError::Disconnected)
        ));
    }

    /// 回归：「关掉再打开」不能留下两个 worker。共享 bool 的写法会把旧 worker
    /// 重新唤醒（新一次 start 又把标志置回 true），于是两个线程各带一份已知集合
    /// 同时轮询。每个 worker 用自己的停机标志就没这个问题。
    #[test]
    fn restart_retires_previous_worker() {
        let inner = StateInner::default();
        assert!(!inner.is_running());

        let first = inner.register_worker();
        assert!(inner.is_running());
        assert!(!first.load(Ordering::SeqCst));

        // 停止：旧标志置 true 并摘除
        inner.stop_worker();
        assert!(first.load(Ordering::SeqCst), "旧 worker 必须收到停机信号");
        assert!(!inner.is_running());

        // 重新开启：拿到一份全新的标志，旧 worker 不会因为新标志而复活
        let second = inner.register_worker();
        assert!(inner.is_running());
        assert!(!second.load(Ordering::SeqCst));
        assert!(!Arc::ptr_eq(&first, &second));
        assert!(first.load(Ordering::SeqCst));

        // 幂等：重复 stop 不 panic
        inner.stop_worker();
        inner.stop_worker();
        assert!(!inner.is_running());
    }

    #[test]
    fn truncate_chars_respects_char_boundaries() {
        let mut s = "中文标题不该截半个字".repeat(20);
        truncate_chars(&mut s, TITLE_MAX_CHARS);
        assert_eq!(s.chars().count(), TITLE_MAX_CHARS + 1); // + 省略号
        assert!(s.ends_with('…'));
        // 短文本不动
        let mut short = "短".to_string();
        truncate_chars(&mut short, TITLE_MAX_CHARS);
        assert_eq!(short, "短");
    }

    /// 按钮解析：protocol / background 提取，带输入框的标记出来
    #[test]
    fn parse_actions_extracts_and_flags() {
        let xml = "<toast>\r\n  <actions>\r\n    \
<action content=\"打开设置\" activationType=\"protocol\" arguments=\"ms-settings:notifications?a=1&amp;b=2\"/>\r\n    \
<action content=\"后台动作\" activationType=\"background\" arguments=\"test=1\"/>\r\n    \
<action content=\"回复\" activationType=\"foreground\" arguments=\"r\" hint-inputId=\"reply\"/>\r\n  \
</actions>\r\n</toast>";
        let actions = parse_toast_actions(xml);
        assert_eq!(actions.len(), 3, "<actions> 前缀不该被当成按钮");
        assert_eq!(actions[0].activation_type, "protocol");
        assert_eq!(actions[0].arguments, "ms-settings:notifications?a=1&b=2");
        assert!(!actions[0].needs_input);
        assert_eq!(actions[1].activation_type, "background");
        assert!(!actions[1].needs_input);
        assert!(actions[2].needs_input);
    }

    /// 属性值里未转义的 `>` 不该截断标签；无 content 的元素跳过
    #[test]
    fn parse_actions_survives_gt_in_attributes() {
        let xml = "<toast><actions>\
<action content=\"比较\" activationType=\"protocol\" arguments=\"a&gt;b\"/>\
</actions></toast>";
        let actions = parse_toast_actions(xml);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].content, "比较");
        assert_eq!(actions[0].arguments, "a>b");
    }

    /// 实体展开：具名 + 十六进制/十进制数字，坏实体原样保留
    #[test]
    fn unescape_handles_named_numeric_and_broken() {
        assert_eq!(unescape_xml("&#x4e2d;&#25991;"), "中文");
        assert_eq!(unescape_xml("a&amp;&lt;b&gt;"), "a&<b>");
        assert_eq!(unescape_xml("quote &quot;x&quot;"), "quote \"x\"");
        assert_eq!(unescape_xml("100% & more"), "100% & more");
        assert_eq!(unescape_xml("&unknown;"), "&unknown;");
    }

    /// Payload 解码：UTF-8 与 UTF-16LE 两种存量编码
    #[test]
    fn decode_payload_supports_utf8_and_utf16() {
        let s = "<toast><action content=\"ok\"/></toast>";
        assert_eq!(decode_notification_payload(s.as_bytes()), Some(s.to_string()));
        let mut utf16 = Vec::new();
        for unit in s.encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_notification_payload(&utf16), Some(s.to_string()));
    }

    /// 主操作解析：根元素 launch/activationType；activationType 缺省 foreground；
    /// launch 缺失/为空 → 原生点了也只是收起，不视为可点
    #[test]
    fn parse_launch_extracts_root_activation() {
        let xml = "<toast launch=\"snipaste://update\" activationType=\"protocol\">\
<actions><action content=\"x\"/></actions></toast>";
        assert_eq!(
            parse_toast_launch(xml),
            Some(("snipaste://update".into(), "protocol".into()))
        );
        let xml = "<toast launch=\"reply=1\"><actions/></toast>";
        assert_eq!(
            parse_toast_launch(xml),
            Some(("reply=1".into(), "foreground".into()))
        );
        // launch 属性不在根元素上（在 <action> 上）不算主操作
        let xml = "<toast><actions><action content=\"开\" arguments=\"a=b\"/></actions></toast>";
        assert_eq!(parse_toast_launch(xml), None);
        assert_eq!(parse_toast_launch("<toast launch=\"\"><actions/></toast>"), None);
        // XML 声明在前也能命中根元素；`toast` 前缀的其他元素名不误命中
        let xml = "<?xml version=\"1.0\"?><toast launch=\"https://x\"></toast>";
        assert_eq!(
            parse_toast_launch(xml),
            Some(("https://x".into(), "foreground".into()))
        );
        assert_eq!(parse_toast_launch("<toastful a=\"1\"/>"), None);
    }
}

#[cfg(all(windows, test))]
mod takeover_tests {
    //! 接管逻辑的真实往返测试：在 HKCU 沙箱路径里建几个「应用」子键，验证
    //! 「抑制 → 还原」精确还原（原本有值的恢复原值、原本没值的删除该值），
    //! 以及静音应用会被跳过。
    //!
    //! 每个测试用**独立**的沙箱路径：共用路径会被并行测试的 remove_tree 互相拆掉，
    //! 表现为「改动数对不上」这类假失败。
    use super::*;

    fn sandbox(tag: &str) -> String {
        format!(r"Software\CatraceTest\{tag}\Settings")
    }

    fn temp_db(tag: &str) -> Db {
        let path = std::env::temp_dir().join(format!("catrace-notif-test-{tag}.db"));
        let _ = std::fs::remove_file(&path);
        Db::new(&path).expect("temp db")
    }

    /// 建沙箱：
    /// - App.WithValue：扁平 AUMID，原本 ShowBanner=1
    /// - App.WithoutValue：扁平 AUMID，原本无该值
    /// - {GUID}\Sub\App.exe：**路径式 AUMID，被平台存成嵌套子键**（只扫一层会漏掉它）
    /// 先清残留，否则上次失败的痕迹会让计数对不上。
    fn setup_sandbox(path: &str) -> bool {
        let _ = windows_registry::CURRENT_USER.remove_tree(path);
        let Ok(root) = windows_registry::CURRENT_USER.create(path) else {
            return false;
        };
        let Ok(a) = root.create("App.WithValue") else {
            return false;
        };
        if a.set_u32(SHOW_BANNER_VALUE, 1).is_err() {
            return false;
        }
        if root.create("App.WithoutValue").is_err() {
            return false;
        }
        let Ok(leaf) = root.create(r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe") else {
            return false;
        };
        leaf.set_u32(SHOW_BANNER_VALUE, 1).is_ok()
    }

    const NESTED: &str =
        r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

    #[test]
    fn suppress_and_restore_round_trip() {
        let path = sandbox("roundtrip");
        if !setup_sandbox(&path) {
            eprintln!("跳过：无法创建沙箱注册表键");
            return;
        }
        let db = temp_db("takeover");

        // 3 个应用 + 3 个容器层（{GUID}、WindowsPowerShell、v1.0）都会被写上
        let changed = suppress_banners_at(&db, &path).expect("suppress");
        assert_eq!(changed, 6, "扁平与嵌套（路径式 AUMID）的应用都应被抑制");
        let root = windows_registry::CURRENT_USER.open(&path).unwrap();
        assert_eq!(
            root.open(NESTED).unwrap().get_u32(SHOW_BANNER_VALUE).unwrap(),
            0,
            "路径式 AUMID 的嵌套叶子必须被抑制——只扫一层会漏掉它"
        );
        assert_eq!(
            root.open("App.WithValue")
                .unwrap()
                .get_u32(SHOW_BANNER_VALUE)
                .unwrap(),
            0
        );
        assert_eq!(
            root.open("App.WithoutValue")
                .unwrap()
                .get_u32(SHOW_BANNER_VALUE)
                .unwrap(),
            0
        );

        // 幂等：再跑一次不重复记录、不再算改动
        assert_eq!(suppress_banners_at(&db, &path).unwrap(), 0);

        assert_eq!(restore_banners_at(&db, &path).expect("restore"), 6);
        assert_eq!(
            root.open(NESTED).unwrap().get_u32(SHOW_BANNER_VALUE).unwrap(),
            1,
            "嵌套叶子要还原成原值"
        );
        assert_eq!(
            root.open("App.WithValue")
                .unwrap()
                .get_u32(SHOW_BANNER_VALUE)
                .unwrap(),
            1,
            "原本有值 → 恢复原值"
        );
        assert!(
            root.open("App.WithoutValue")
                .unwrap()
                .get_u32(SHOW_BANNER_VALUE)
                .is_err(),
            "原本没值 → 删除该值（回到系统默认态）"
        );
        assert_eq!(restore_banners_at(&db, &path).unwrap(), 0, "备份已清空");

        let _ = windows_registry::CURRENT_USER.remove_tree(&path);
    }

    #[test]
    fn backup_setting_round_trip() {
        let db = temp_db("backup");
        let mut backup = TakeoverBackup::new();
        backup.insert("A".into(), Some(1));
        backup.insert("B".into(), None);
        save_backup(&db, &backup);
        let loaded = load_backup(&db);
        assert_eq!(loaded.get("A"), Some(&Some(1)));
        assert_eq!(loaded.get("B"), Some(&None));
        save_backup(&db, &TakeoverBackup::new());
        assert!(load_backup(&db).is_empty());
    }
}
