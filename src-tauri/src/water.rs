use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::bus::EventBus;
use crate::event::{
    BusEvent, DisplayMode, EventAction, EventLevel, EventSource, EventStatus,
};
use crate::{db, reminder_toast, ReminderWindowStore};

/// 喝水提醒状态机（进程级，重启后重置）
#[derive(Default)]
pub struct WaterReminderState {
    /// 推迟提醒直到该时刻
    pub snooze_until: Option<Instant>,
    /// 最后一次发送喝水提醒的时刻，用于防止同一分钟内重复触发
    pub last_reminder_sent: Option<Instant>,
}

impl WaterReminderState {
    pub fn is_snoozed(&self) -> bool {
        self.snooze_until.is_some_and(|t| t > Instant::now())
    }

    /// 距离上次发送是否已超过 1 秒，避免同一秒内重复弹窗
    pub fn can_send_reminder(&self) -> bool {
        self.last_reminder_sent
            .is_none_or(|t| t.elapsed() >= Duration::from_secs(1))
    }

    pub fn record_drink(&mut self) {
        // 喝水后清除 snooze，让下一次按正常间隔计算
        self.snooze_until = None;
    }
}

// ---------- i18n helpers ----------

fn water_notify_title(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "喝水提醒",
        _ => "Drink Water",
    }
}

fn water_notify_body(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "该喝水了，给身体补补水吧。",
        _ => "Time to drink some water.",
    }
}

fn water_action_label(locale: &str, id: &str) -> String {
    match (locale, id) {
        ("zh-CN", "snooze_5") => "5 分钟后".into(),
        (_, "snooze_5") => "Snooze 5m".into(),
        ("zh-CN", "skip") => "跳过".into(),
        (_, "skip") => "Skip".into(),
        ("zh-CN", "drunk") => "已喝水".into(),
        (_, "drunk") => "Done".into(),
        _ => id.into(),
    }
}

// ---------- 通知 ----------

pub fn show_water_notification(
    app_handle: &tauri::AppHandle,
    locale: &str,
    store: &ReminderWindowStore,
    bus: &EventBus,
) {
    let title = water_notify_title(locale).to_string();
    let body = water_notify_body(locale).to_string();

    // Dual-write: Event bus (observe/lifecycle) + existing toast (authoritative UI).
    let event = BusEvent {
        id: String::new(),
        event_type: "reminder.water.due".into(),
        source: EventSource::Internal,
        kind: "water".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title: title.clone(),
        body: body.clone(),
        actions: vec![
            EventAction {
                id: "drunk".into(),
                label: water_action_label(locale, "drunk"),
                payload: None,
            },
            EventAction {
                id: "snooze_5".into(),
                label: water_action_label(locale, "snooze_5"),
                payload: None,
            },
            EventAction {
                id: "skip".into(),
                label: water_action_label(locale, "skip"),
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
        dedupe_key: Some("reminder.water.due".into()),
    };
    if let Err(e) = bus.publish(event) {
        crate::log_error!("water", "bus.publish failed: {}", e);
    }

    reminder_toast::create_toast_window(app_handle, 0, &title, &body, "water", store);
}

// ---------- 命令 ----------

#[tauri::command]
pub fn get_water_settings(db: tauri::State<db::Db>) -> serde_json::Value {
    let enabled = db.get_setting("water_reminder_enabled", "true") == "true";
    let interval: i64 = db
        .get_setting("water_interval_minutes", "60")
        .parse()
        .unwrap_or(60);
    serde_json::json!({ "enabled": enabled, "interval_minutes": interval })
}

#[tauri::command]
pub fn set_water_settings(
    enabled: bool,
    interval_minutes: i64,
    db: tauri::State<db::Db>,
) -> Result<(), String> {
    db.set_setting("water_reminder_enabled", &enabled.to_string())
        .map_err(|e| e.to_string())?;
    db.set_setting("water_interval_minutes", &interval_minutes.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_water(
    timestamp: i64,
    db: tauri::State<db::Db>,
    state: tauri::State<Arc<Mutex<WaterReminderState>>>,
) -> Result<(), String> {
    db.record_water(timestamp).map_err(|e| e.to_string())?;
    let mut s = state.lock().unwrap();
    s.record_drink();
    Ok(())
}

#[tauri::command]
pub fn get_water_stats(db: tauri::State<db::Db>) -> Result<serde_json::Value, String> {
    let count = db.get_today_water_count().map_err(|e| e.to_string())?;
    let last_ts = db.get_last_water();
    Ok(serde_json::json!({ "count": count, "last_ts": last_ts }))
}

#[tauri::command]
pub fn get_water_records(db: tauri::State<db::Db>) -> Result<serde_json::Value, String> {
    let records = db.get_today_water_records().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "records": records }))
}

#[tauri::command]
pub fn delete_last_water(db: tauri::State<db::Db>) -> Result<bool, String> {
    db.delete_last_water().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snooze_water_reminder(
    minutes: u64,
    state: tauri::State<Arc<Mutex<WaterReminderState>>>,
) {
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(minutes * 60));
}

#[tauri::command]
pub fn skip_water_reminder(
    db: tauri::State<db::Db>,
    state: tauri::State<Arc<Mutex<WaterReminderState>>>,
) {
    let water_interval: u64 = db
        .get_setting("water_interval_minutes", "60")
        .parse()
        .unwrap_or(60);
    let mut s = state.lock().unwrap();
    s.snooze_until = Some(Instant::now() + Duration::from_secs(water_interval * 60));
}

#[tauri::command]
pub fn test_water_notification(
    app_handle: tauri::AppHandle,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    bus: tauri::State<EventBus>,
) {
    let locale = db.get_setting("locale", "zh-CN");
    show_water_notification(&app_handle, &locale, &store, &bus);
}

// ---------- 结算时检查 ----------

/// 在每分钟结算时检查是否需要弹出喝水提醒。
/// 调用方保证当前分钟处于活跃状态（休息时不会调用）。
pub fn check_and_notify(
    db: &db::Db,
    water_state: &Arc<Mutex<WaterReminderState>>,
    app_handle: &tauri::AppHandle,
    locale: &str,
    store: &ReminderWindowStore,
    bus: &EventBus,
) {
    let water_enabled = db.get_setting("water_reminder_enabled", "true") == "true";
    if !water_enabled {
        return;
    }

    let water_interval: i64 = db
        .get_setting("water_interval_minutes", "60")
        .parse()
        .unwrap_or(60);
    let now_ts = chrono::Local::now().timestamp();
    let overdue = match db.get_last_water() {
        Some(last_ts) => now_ts - last_ts >= water_interval * 60,
        None => true,
    };

    if overdue {
        let mut state = water_state.lock().unwrap();
        if !state.is_snoozed() && state.can_send_reminder() {
            state.last_reminder_sent = Some(Instant::now());
            state.snooze_until = Some(
                Instant::now() + Duration::from_secs((water_interval as u64) * 60),
            );
            drop(state);
            show_water_notification(app_handle, locale, store, bus);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_water_state_snooze() {
        let mut state = WaterReminderState::default();
        assert!(!state.is_snoozed());

        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        assert!(state.is_snoozed());

        state.snooze_until = Some(Instant::now() - Duration::from_secs(1));
        assert!(!state.is_snoozed());
    }

    #[test]
    fn test_water_state_can_send_reminder() {
        let mut state = WaterReminderState::default();
        assert!(state.can_send_reminder());

        state.last_reminder_sent = Some(Instant::now());
        assert!(!state.can_send_reminder());

        thread::sleep(Duration::from_secs(2));
        assert!(state.can_send_reminder());
    }

    #[test]
    fn test_water_state_record_drink_clears_snooze() {
        let mut state = WaterReminderState::default();
        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        state.record_drink();
        assert!(state.snooze_until.is_none());
    }
}
