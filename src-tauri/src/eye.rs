use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::bus::EventBus;
use crate::event::{
    BusEvent, DisplayMode, EventAction, EventLevel, EventSource, EventStatus,
};
use crate::db;

/// 护眼提醒状态机（进程级，重启后重置）
#[derive(Default)]
pub struct EyeReminderState {
    /// 推迟提醒直到该时刻（用户点了「稍后」）
    pub snooze_until: Option<Instant>,
    /// 最后一次发送护眼提醒的时刻，用于防止同一秒内重复触发
    pub last_reminder_sent: Option<Instant>,
}

impl EyeReminderState {
    pub fn is_snoozed(&self) -> bool {
        self.snooze_until.is_some_and(|t| t > Instant::now())
    }

    /// 距离上次发送是否已超过 1 秒，避免同一秒内重复弹窗
    pub fn can_send_reminder(&self) -> bool {
        self.last_reminder_sent
            .is_none_or(|t| t.elapsed() >= Duration::from_secs(1))
    }
}

// ---------- i18n helpers ----------

fn eye_notify_title(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "护眼提醒",
        _ => "Eye Care Reminder",
    }
}

fn eye_notify_body(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "该让眼睛休息一下了，看看远处吧。",
        _ => "Time to rest your eyes. Look into the distance.",
    }
}

fn eye_action_label(locale: &str, id: &str) -> String {
    match (locale, id) {
        ("zh-CN", "snooze_5") => "5 分钟后".into(),
        (_, "snooze_5") => "Snooze 5m".into(),
        ("zh-CN", "skip") => "跳过".into(),
        (_, "skip") => "Skip".into(),
        _ => id.into(),
    }
}

// ---------- 通知（只走 Event Bus） ----------

pub fn show_eye_notification(locale: &str, bus: &EventBus) {
    let title = eye_notify_title(locale).to_string();
    let body = eye_notify_body(locale).to_string();

    let event = BusEvent {
        id: String::new(),
        event_type: "reminder.eye.due".into(),
        source: EventSource::Internal,
        kind: "eye".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title,
        body,
        actions: vec![
            EventAction {
                id: "snooze_5".into(),
                label: eye_action_label(locale, "snooze_5"),
                payload: None,
            },
            EventAction {
                id: "skip".into(),
                label: eye_action_label(locale, "skip"),
                payload: None,
            },
        ],
        progress: None,
        sticky: Some(false),
        payload: serde_json::json!({}),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some("reminder.eye.due".into()),
    };
    if let Err(e) = bus.publish(event) {
        crate::log_error!("eye", "bus.publish failed: {}", e);
    }
}

// ---------- 命令 ----------

#[tauri::command]
pub fn get_eye_settings(db: tauri::State<db::Db>) -> serde_json::Value {
    // 护眼提醒暂无 UI 入口，强制关闭（忽略已存设置）
    let enabled = false;
    let interval: i64 = db
        .get_setting("eye_interval_minutes", "20")
        .parse()
        .unwrap_or(20);
    serde_json::json!({ "enabled": enabled, "interval_minutes": interval })
}

#[tauri::command]
pub fn set_eye_settings(
    enabled: bool,
    interval_minutes: i64,
    db: tauri::State<db::Db>,
) -> Result<(), String> {
    db.set_setting("eye_reminder_enabled", &enabled.to_string())
        .map_err(|e| e.to_string())?;
    db.set_setting("eye_interval_minutes", &interval_minutes.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snooze_eye_reminder(minutes: u64, state: tauri::State<Arc<Mutex<EyeReminderState>>>) {
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(minutes * 60));
}

#[tauri::command]
pub fn skip_eye_reminder(
    db: tauri::State<db::Db>,
    state: tauri::State<Arc<Mutex<EyeReminderState>>>,
) {
    let eye_interval: u64 = db
        .get_setting("eye_interval_minutes", "20")
        .parse()
        .unwrap_or(20);
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(eye_interval * 60));
}

#[tauri::command]
pub fn test_eye_notification(
    db: tauri::State<db::Db>,
    state: tauri::State<Arc<Mutex<EyeReminderState>>>,
    bus: tauri::State<EventBus>,
) {
    let mut s = state.lock().unwrap();
    if !s.can_send_reminder() {
        return;
    }
    s.last_reminder_sent = Some(Instant::now());
    drop(s);
    let locale = db.get_setting("locale", "zh-CN");
    show_eye_notification(&locale, &bus);
}

// ---------- 结算时检查 ----------

/// 在每分钟结算时检查是否需要弹出护眼提醒。
/// 调用方保证当前分钟处于活跃状态（休息时不会调用）。
pub fn check_and_notify(
    break_minutes: i64,
    db: &db::Db,
    eye_state: &Arc<Mutex<EyeReminderState>>,
    locale: &str,
    bus: &EventBus,
) {
    // 护眼提醒暂无 UI 入口，强制关闭（忽略已存设置）
    let eye_enabled = false;
    if !eye_enabled {
        return;
    }

    let eye_interval: i64 = db
        .get_setting("eye_interval_minutes", "20")
        .parse()
        .unwrap_or(20);
    let now_ts = chrono::Local::now().timestamp();

    let last_reminder_ts = db
        .get_setting("eye_last_reminder_ts", "")
        .parse::<i64>()
        .ok()
        .filter(|t| *t > 0);
    let last_real_rest_ts = db.get_last_real_rest_ts(break_minutes).ok().flatten();

    let base_ts = match (last_reminder_ts, last_real_rest_ts) {
        (Some(a), Some(b)) => std::cmp::max(a, b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => {
            let _ = db.set_setting("eye_last_reminder_ts", &now_ts.to_string());
            return;
        }
    };
    let overdue = now_ts - base_ts >= eye_interval * 60;

    if overdue {
        let mut state = eye_state.lock().unwrap();
        if !state.is_snoozed() && state.can_send_reminder() {
            state.last_reminder_sent = Some(Instant::now());
            drop(state);
            let _ = db.set_setting("eye_last_reminder_ts", &now_ts.to_string());
            show_eye_notification(locale, bus);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_eye_state_can_send_reminder() {
        let mut state = EyeReminderState::default();
        assert!(state.can_send_reminder());

        state.last_reminder_sent = Some(Instant::now());
        assert!(!state.can_send_reminder());

        thread::sleep(Duration::from_secs(2));
        assert!(state.can_send_reminder());
    }

    #[test]
    fn test_eye_state_snooze() {
        let mut state = EyeReminderState::default();
        assert!(!state.is_snoozed());

        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        assert!(state.is_snoozed());

        state.snooze_until = Some(Instant::now() - Duration::from_secs(1));
        assert!(!state.is_snoozed());
    }
}
