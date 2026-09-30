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
        match event_rx.recv_timeout(POLL_INTERVAL) {
            Ok(id) => {
                if known.insert(id) {
                    process_notification(&listener, &bus, &db, id);
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                poll_once(&listener, &toast_kind, &bus, &db, &mut known)
            }
            // 有保活发送端时不会断开；真发生了也不能退出，更不能空转
            // （断开后 recv_timeout 立刻返回，不睡就是忙等烧 CPU）。
            Err(RecvTimeoutError::Disconnected) => {
                thread::sleep(POLL_INTERVAL);
                poll_once(&listener, &toast_kind, &bus, &db, &mut known);
            }
        }
    }

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
    known: &mut std::collections::HashSet<u32>,
) {
    match wait_async(listener.GetNotificationsAsync(*toast_kind)) {
        Ok(view) => {
            let mut current = std::collections::HashSet::new();
            for n in view {
                let id = n.Id().unwrap_or(0);
                current.insert(id);
                if known.insert(id) {
                    process_notification(listener, bus, db, id);
                }
            }
            known.retain(|id| current.contains(id));
        }
        Err(e) => log_warn!("notification", "poll failed: {}", e),
    }
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
        actions: vec![],
        progress: None,
        sticky: None,
        payload: serde_json::json!({
            "app_name": app_name,
            "aumid": app_key,
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
            let Some(sub) = open_rw(&root, aumid) else {
                continue; // 该应用的通知设置项已不存在，无需还原（也不必重试）
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
