use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{db, reminder_toast, ReminderWindowStore};

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
        self.snooze_until.map_or(false, |t| t > Instant::now())
    }

    /// 距离上次发送是否已超过 1 秒，避免同一秒内重复弹窗
    pub fn can_send_reminder(&self) -> bool {
        self.last_reminder_sent
            .map_or(true, |t| t.elapsed() >= Duration::from_secs(1))
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

// ---------- 通知 ----------

pub fn show_eye_notification(
    app_handle: &tauri::AppHandle,
    locale: &str,
    store: &ReminderWindowStore,
) {
    let title = eye_notify_title(locale).to_string();
    let body = eye_notify_body(locale).to_string();
    reminder_toast::create_toast_window(app_handle, 0, &title, &body, "eye", store);
}

// ---------- 命令 ----------

#[tauri::command]
pub fn get_eye_settings(db: tauri::State<db::Db>) -> serde_json::Value {
    let enabled = db.get_setting("eye_reminder_enabled", "true") == "true";
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
    app_handle: tauri::AppHandle,
    db: tauri::State<db::Db>,
    store: tauri::State<ReminderWindowStore>,
    state: tauri::State<Arc<Mutex<EyeReminderState>>>,
) {
    let mut s = state.lock().unwrap();
    if !s.can_send_reminder() {
        return;
    }
    s.last_reminder_sent = Some(Instant::now());
    drop(s);
    let locale = db.get_setting("locale", "zh-CN");
    show_eye_notification(&app_handle, &locale, &store);
}

// ---------- 结算时检查 ----------

/// 在每分钟结算时检查是否需要弹出护眼提醒。
/// 调用方保证当前分钟处于活跃状态（休息时不会调用）。
///
/// 规则：连续用电脑满 interval 分钟弹一次；中途真正休息过
/// （连续不活跃 >= break_minutes）就从休息结束重新计时。
/// 实现上，计时起点取「上次提醒时间」和「上次真正休息结束时间」里更晚的那个；
/// 实现上，计时起点取「上次提醒时间」和「上次真正休息结束时间」里更晚的那个；
/// 两者都还没有（刚启动）时以现在为起点、本轮不弹，等满一个 interval 再说。
pub fn check_and_notify(
    break_minutes: i64,
    db: &db::Db,
    eye_state: &Arc<Mutex<EyeReminderState>>,
    app_handle: &tauri::AppHandle,
    locale: &str,
    store: &ReminderWindowStore,
) {
    let eye_enabled = db.get_setting("eye_reminder_enabled", "true") == "true";
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
            // 首次启动无历史：以现在为计时起点，本轮不弹，等满一个 interval
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
            show_eye_notification(app_handle, locale, store);
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
