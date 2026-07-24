//! Built-in sedentary reminder plugin.
use crate::{db, log_error, ReminderWindowStore};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::time::interval;

static LAST_TEST_NOTIFICATION_AT: Mutex<Option<Instant>> = Mutex::new(None);
fn notify_title(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "休息提醒",
        _ => "Rest Reminder",
    }
}
fn notify_body(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "站起来，喝口水，伸伸脖子和懒腰。",
        _ => "Stand up, drink some water, stretch your neck and back.",
    }
}
fn test_notify_msg(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "这是一条测试提醒",
        _ => "This is a test notification",
    }
}

/// 提醒状态机（进程级，重启后重置）
#[derive(Default)]
pub struct ReminderState {
    /// 推迟提醒直到该时刻
    pub snooze_until: Option<Instant>,
    /// 跳过本次提醒直到该 block boundary（时间戳）
    pub skip_until_boundary: Option<i64>,
    /// 活跃 block 已触发提醒，正在等待用户完成有效休息
    pub break_timer_active: bool,
}

impl ReminderState {
    pub fn is_snoozed(&self) -> bool {
        self.snooze_until.is_some_and(|t| t > Instant::now())
    }

    pub fn is_skipped(&self, boundary: i64) -> bool {
        self.skip_until_boundary.is_some_and(|b| b >= boundary)
    }
}

/// Debug 页通知循环测试状态
pub struct NotificationTestState {
    running: AtomicBool,
}

impl NotificationTestState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn start(&self) {
        self.running.store(true, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

impl Default for NotificationTestState {
    fn default() -> Self {
        Self::new()
    }
}

const PLUGIN_ID: &str = "rest";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RestPluginConfig {
    #[serde(default = "default_true")]
    pub(crate) enabled: bool,
    #[serde(default = "default_window_minutes")]
    window_minutes: i64,
    #[serde(default = "default_break_minutes")]
    pub(crate) break_minutes: i64,
    #[serde(default = "default_snooze_minutes")]
    snooze_interval_minutes: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
}

fn default_true() -> bool {
    true
}
fn default_window_minutes() -> i64 {
    45
}
fn default_break_minutes() -> i64 {
    5
}
fn default_snooze_minutes() -> i64 {
    3
}

impl Default for RestPluginConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            window_minutes: default_window_minutes(),
            break_minutes: default_break_minutes(),
            snooze_interval_minutes: default_snooze_minutes(),
            title: String::new(),
            body: String::new(),
        }
    }
}

pub(crate) fn load_config(app: &tauri::AppHandle) -> RestPluginConfig {
    crate::plugin_config::get_plugin_config(app, PLUGIN_ID)
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn save_config(app: &tauri::AppHandle, config: &RestPluginConfig) -> Result<(), String> {
    crate::plugin_config::set_plugin_config(app, PLUGIN_ID, config)
}

#[tauri::command]
pub(crate) fn get_config(app: tauri::AppHandle) -> serde_json::Value {
    let config = load_config(&app);
    serde_json::json!({
        "enabled": config.enabled,
        "window_minutes": config.window_minutes,
        "break_minutes": config.break_minutes,
        "snooze_interval_minutes": config.snooze_interval_minutes,
    })
}

#[tauri::command]
pub(crate) fn set_config(config: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    let mut current = load_config(&app);
    if let Some(v) = config.get("enabled").and_then(|v| v.as_bool()) {
        current.enabled = v;
    }
    if let Some(v) = config.get("window_minutes").and_then(|v| v.as_i64()) {
        current.window_minutes = v;
    }
    if let Some(v) = config.get("break_minutes").and_then(|v| v.as_i64()) {
        current.break_minutes = v;
    }
    if let Some(v) = config
        .get("snooze_interval_minutes")
        .and_then(|v| v.as_i64())
    {
        current.snooze_interval_minutes = v;
    }
    save_config(&app, &current)
}

#[tauri::command]
pub(crate) fn skip_reminder(
    boundary: i64,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
) {
    let mut s = state.lock().unwrap();
    s.skip_until_boundary = Some(boundary);
    s.snooze_until = None;
    s.break_timer_active = false;
    // 用户操作后恢复正常活动追踪
    fullscreen_active.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn snooze_reminder(
    minutes: u64,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
) {
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(minutes * 60));
    s.break_timer_active = false;
    // 用户操作后恢复正常活动追踪
    fullscreen_active.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn dismiss_rest_timer(
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    bus: tauri::State<crate::bus::EventBus>,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.break_timer_active = false;
    drop(s);
    // Clear sticky rest-timer card on bus if present
    if let Ok(Some(ev)) = bus.find_active_by_dedupe_key("reminder.rest.timer") {
        use crate::event::{EventResolution, ResolutionKind};
        let _ = bus.resolve(
            ev.id,
            EventResolution {
                kind: ResolutionKind::Dismissed,
                action_id: None,
                payload: None,
            },
        );
    }
    Ok(())
}

/// Rest-timer toast via Event Bus (stable dedupe_key; upsert avoids flicker).
fn emit_rest_timer_event(
    bus: &crate::bus::EventBus,
    locale: &str,
    break_minutes: i64,
    rest_start_ts: i64,
    rest_streak: i64,
    remaining_minutes: i64,
    is_complete: bool,
) {
    use crate::event::{
        BusEvent, DisplayMode, EventLevel, EventProgress, EventSource, EventStatus,
    };

    let (title, body) = if is_complete {
        if locale == "zh-CN" {
            (
                "休息已完成".to_string(),
                format!("已连续休息 {rest_streak} 分钟"),
            )
        } else {
            (
                "Break Complete".to_string(),
                format!("Rested for {rest_streak} minutes"),
            )
        }
    } else if locale == "zh-CN" {
        (
            "休息计时".to_string(),
            format!("已连续休息 {rest_streak} 分钟，还需 {remaining_minutes} 分钟"),
        )
    } else {
        (
            "Rest Timer".to_string(),
            format!("Rested for {rest_streak} minutes, {remaining_minutes} minutes to go"),
        )
    };

    let progress = if break_minutes > 0 {
        Some(EventProgress {
            current: rest_streak as f64,
            total: break_minutes as f64,
            label: None,
        })
    } else {
        None
    };

    let event = BusEvent {
        id: String::new(),
        event_type: "reminder.rest.timer".into(),
        source: EventSource::Internal,
        kind: "rest-timer".into(),
        display_mode: DisplayMode::Toast,
        level: if is_complete {
            EventLevel::Success
        } else {
            EventLevel::Info
        },
        title,
        body,
        actions: vec![],
        progress,
        sticky: Some(true),
        payload: serde_json::json!({
            "break_minutes": break_minutes,
            "rest_start_ts": rest_start_ts,
            "rest_streak": rest_streak,
            "remaining_minutes": remaining_minutes,
            "is_complete": is_complete,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some("reminder.rest.timer".into()),
    };
    if let Err(e) = bus.upsert_by_dedupe_key(event) {
        log_error!("rest-timer", "bus upsert failed: {}", e);
    }
}

#[tauri::command]
pub(crate) fn test_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
    bus: tauri::State<crate::bus::EventBus>,
) {
    {
        let mut last = LAST_TEST_NOTIFICATION_AT.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < Duration::from_secs(1) {
                return;
            }
        }
        *last = Some(Instant::now());
    }

    let locale = db.get_setting("locale", "zh-CN");

    // Toast 模式：先走统一通知入口（bus 会 ensure 窗口），再补休息计时卡。
    // 不再在这里额外 show，避免与 bus 的 ensure_toast 并发抢 Win32 show。
    show_notification(
        &app_handle,
        0,
        test_notify_msg(&locale),
        state.inner().clone(),
        &locale,
        &db,
        &store,
        fullscreen_active.inner().clone(),
        &bus,
    );

    // 追加/刷新休息计时测试卡片（走 bus，ensure 由 publish/update 负责）
    let break_m = load_config(&app_handle).break_minutes;
    let now_ts = chrono::Local::now().timestamp();
    let rest_start_ts = (now_ts / 60) * 60;
    let rest_streak: i64 = std::cmp::min(3, break_m);
    let remaining_minutes = (break_m - rest_streak).max(0);
    let is_complete = rest_streak >= break_m;
    emit_rest_timer_event(
        &bus,
        &locale,
        break_m,
        rest_start_ts,
        rest_streak,
        remaining_minutes,
        is_complete,
    );
}

#[tauri::command]
pub(crate) fn start_notification_test(
    interval_seconds: u64,
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<ReminderState>>>,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    fullscreen_active: tauri::State<Arc<AtomicBool>>,
    test_state: tauri::State<Arc<NotificationTestState>>,
    bus: tauri::State<crate::bus::EventBus>,
) -> Result<(), String> {
    if interval_seconds == 0 {
        return Err("interval must be greater than 0".to_string());
    }
    if test_state.is_running() {
        return Ok(());
    }
    test_state.start();

    let app_handle = app_handle.clone();
    let state = state.inner().clone();
    let db = db.inner().clone();
    let store = store.inner().clone();
    let fullscreen_active = fullscreen_active.inner().clone();
    let test_state = test_state.inner().clone();
    let bus = bus.inner().clone();

    tauri::async_runtime::spawn(async move {
        let mut interval = interval(Duration::from_secs(interval_seconds));
        loop {
            interval.tick().await;
            if !test_state.is_running() {
                break;
            }
            let locale = db.get_setting("locale", "zh-CN");
            show_notification(
                &app_handle,
                0,
                test_notify_msg(&locale),
                state.clone(),
                &locale,
                &db,
                &store,
                fullscreen_active.clone(),
                &bus,
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub(crate) fn stop_notification_test(test_state: tauri::State<Arc<NotificationTestState>>) {
    test_state.stop();
}

// ------------------------------------------------------------------
// 通知入口：当前版本久坐插件仅支持 toast（popup/fullscreen 暂不启用）
// ------------------------------------------------------------------

fn show_notification(
    _app_handle: &tauri::AppHandle,
    boundary: i64,
    default_body: &str,
    _reminder_state: Arc<Mutex<ReminderState>>,
    locale: &str,
    _db: &db::Db,
    _store: &ReminderWindowStore,
    _fullscreen_active: Arc<AtomicBool>,
    bus: &crate::bus::EventBus,
) {
    // 优先使用用户自定义文本，空则回退到 i18n 默认值
    let config = load_config(_app_handle);
    let custom_title = config.title;
    let custom_body = config.body;
    let title = if custom_title.is_empty() {
        notify_title(locale).to_string()
    } else {
        custom_title
    };
    let body = if custom_body.is_empty() {
        default_body.to_string()
    } else {
        custom_body
    };

    // toast：只 publish 到 Event Bus，由 Toast 窗订阅渲染
    use crate::event::{BusEvent, DisplayMode, EventAction, EventLevel, EventSource, EventStatus};
    let event = BusEvent {
        id: String::new(),
        event_type: "reminder.rest.due".into(),
        source: EventSource::Internal,
        kind: "rest".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Warning,
        title,
        body,
        actions: vec![
            EventAction {
                id: "snooze".into(),
                label: if locale == "zh-CN" {
                    "稍后".into()
                } else {
                    "Snooze".into()
                },
                payload: None,
            },
            EventAction {
                id: "skip".into(),
                label: if locale == "zh-CN" {
                    "跳过".into()
                } else {
                    "Skip".into()
                },
                payload: None,
            },
        ],
        progress: None,
        sticky: Some(false),
        payload: serde_json::json!({ "boundary": boundary }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        // 测试 boundary=0 允许堆叠；真实结算同 boundary 去重替换
        dedupe_key: if boundary == 0 {
            None
        } else {
            Some(format!("reminder.rest.due:{boundary}"))
        },
    };
    if let Err(e) = bus.publish(event) {
        log_error!("rest", "bus.publish failed: {}", e);
    }
}

pub(crate) fn on_minute_settled(
    active: bool,
    app_handle: &tauri::AppHandle,
    state: &Arc<Mutex<ReminderState>>,
    locale: &str,
    db: &crate::db::Db,
    store: &ReminderWindowStore,
    fullscreen_active: &Arc<AtomicBool>,
    bus: &crate::bus::EventBus,
) {
    if active {
        state.lock().unwrap().break_timer_active = false;
        let config = load_config(app_handle);
        if !config.enabled {
            return;
        }
        let window_minutes = config.window_minutes;
        let break_minutes = config.break_minutes;
        match db.check_should_notify(window_minutes, break_minutes) {
            Ok((true, Some(boundary))) => {
                let reminder = state.lock().unwrap();
                if reminder.is_skipped(boundary) || reminder.is_snoozed() {
                    drop(reminder);
                    state.lock().unwrap().break_timer_active = false;
                    return;
                }
                drop(reminder);
                show_notification(
                    app_handle,
                    boundary,
                    notify_body(locale),
                    state.clone(),
                    locale,
                    db,
                    store,
                    fullscreen_active.clone(),
                    bus,
                );
                let interval_minutes = config.snooze_interval_minutes;
                let mut reminder = state.lock().unwrap();
                reminder.snooze_until =
                    Some(Instant::now() + Duration::from_secs((interval_minutes * 60) as u64));
                reminder.break_timer_active = true;
            }
            Ok(_) => {}
            Err(e) => log_error!("notify", "Notification check failed: {}", e),
        }
        return;
    }
    let break_minutes = load_config(app_handle).break_minutes;
    let mut reminder = state.lock().unwrap();
    reminder.snooze_until = None;
    if !reminder.break_timer_active {
        return;
    }
    drop(reminder);
    match db.get_current_rest_streak() {
        Ok((streak, start)) => {
            let streak = streak as i64;
            emit_rest_timer_event(
                bus,
                locale,
                break_minutes,
                start,
                streak,
                (break_minutes - streak).max(0),
                streak >= break_minutes,
            );
        }
        Err(e) => log_error!("rest-timer", "read rest streak failed: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_reminder_state_snooze() {
        let mut state = ReminderState::default();

        // 初始状态：未 snooze
        assert!(!state.is_snoozed());

        // 设置 snooze_until 为未来时刻 → should be snoozed
        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        assert!(state.is_snoozed());

        // 设置 snooze_until 为过去时刻 → should not be snoozed
        state.snooze_until = Some(Instant::now() - Duration::from_secs(60));
        assert!(!state.is_snoozed());

        // 清除 snooze
        state.snooze_until = None;
        assert!(!state.is_snoozed());
    }

    #[test]
    fn test_reminder_state_skip() {
        let mut state = ReminderState::default();

        // 初始状态：未 skip
        assert!(!state.is_skipped(100));

        // 设置 skip_until_boundary = 100
        state.skip_until_boundary = Some(100);

        // boundary == 100 → skipped
        assert!(state.is_skipped(100));
        // boundary > 100 → not skipped（新 block 已开始）
        assert!(!state.is_skipped(101));
        // boundary < 100 → skipped（旧 block 仍在）
        assert!(state.is_skipped(99));
    }

    #[test]
    fn test_snooze_interval_overridden_by_user_choice() {
        // 模拟：通知触发后自动设置 3 分钟 snooze
        // 然后用户点击"5分钟"按钮覆盖
        let mut state = ReminderState::default();

        // 自动 snooze：3 分钟
        state.snooze_until = Some(Instant::now() + Duration::from_secs(3 * 60));
        assert!(state.is_snoozed());

        // 用户点击"5分钟"按钮，覆盖为 5 分钟
        state.snooze_until = Some(Instant::now() + Duration::from_secs(5 * 60));
        assert!(state.is_snoozed());

        // 验证 snooze_until 确实被更新（5分钟 > 3分钟）
        let snooze_time = state.snooze_until.unwrap();
        let expected_min = Instant::now() + Duration::from_secs(4 * 60);
        let expected_max = Instant::now() + Duration::from_secs(6 * 60);
        assert!(snooze_time > expected_min);
        assert!(snooze_time < expected_max);
    }

    #[test]
    fn test_snooze_auto_interval_expiry() {
        // 模拟：自动 snooze 间隔到期后不再 snoozed
        let mut state = ReminderState::default();

        // 设置 snooze_until 为 1 秒后
        state.snooze_until = Some(Instant::now() + Duration::from_secs(1));
        assert!(state.is_snoozed());

        // 等待 2 秒（在测试中模拟时间流逝）
        std::thread::sleep(Duration::from_secs(2));
        assert!(!state.is_snoozed());
    }
}
