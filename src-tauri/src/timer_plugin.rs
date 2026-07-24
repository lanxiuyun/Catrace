use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Local, Timelike};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bus::EventBus;
use crate::db;
use crate::event::{BusEvent, DisplayMode, EventAction, EventLevel, EventSource, EventStatus};

const PLUGIN_ID: &str = "timer";
const RUNTIME_STORAGE_KEY: &str = "runtime";
const MAX_RULES: usize = 20;
const MAX_DAILY_TIMES: usize = 8;
const MAX_DAILY_KEYS: usize = 64;
const MIN_INTERVAL: i64 = 1;
const MAX_INTERVAL: i64 = 24 * 60;

/// 进程级：snooze / 同秒防抖（重启清空）
#[derive(Default)]
pub struct TimerRuntimeState {
    pub snooze_until: HashMap<String, Instant>,
    pub last_sent: HashMap<String, Instant>,
}

impl TimerRuntimeState {
    fn is_snoozed(&self, rule_id: &str) -> bool {
        self.snooze_until
            .get(rule_id)
            .is_some_and(|t| *t > Instant::now())
    }

    fn can_send(&self, rule_id: &str) -> bool {
        self.last_sent
            .get(rule_id)
            .is_none_or(|t| t.elapsed() >= Duration::from_secs(1))
    }

    fn mark_sent(&mut self, rule_id: &str) {
        self.last_sent.insert(rule_id.to_string(), Instant::now());
    }

    fn snooze(&mut self, rule_id: &str, minutes: u64) {
        self.snooze_until.insert(
            rule_id.to_string(),
            Instant::now() + Duration::from_secs(minutes * 60),
        );
    }

    fn clear_snooze(&mut self, rule_id: &str) {
        self.snooze_until.remove(rule_id);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimerMode {
    Interval,
    Daily,
}

impl Default for TimerMode {
    fn default() -> Self {
        Self::Interval
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerRule {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub mode: TimerMode,
    #[serde(default = "default_interval")]
    pub interval_minutes: i64,
    #[serde(default)]
    pub daily_times: Vec<String>,
    #[serde(default)]
    pub last_fired_at: Option<i64>,
    #[serde(default)]
    pub last_daily_keys: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_interval() -> i64 {
    60
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<TimerRule>,
}

impl Default for TimerSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            rules: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct TimerRuleRuntime {
    #[serde(default)]
    last_fired_at: Option<i64>,
    #[serde(default)]
    last_daily_keys: Vec<String>,
}

fn load_settings(app: &tauri::AppHandle, db: &db::Db) -> TimerSettings {
    let mut settings =
        match crate::plugin_config::get_plugin_config::<TimerSettings>(app, PLUGIN_ID) {
            Ok(Some(settings)) => sanitize_settings(settings),
            Ok(None) => TimerSettings::default(),
            Err(e) => {
                crate::log_error!("timer", "load config failed: {}", e);
                TimerSettings::default()
            }
        };
    if let Ok(Some(raw)) = db.get_plugin_storage(PLUGIN_ID, RUNTIME_STORAGE_KEY) {
        if let Ok(runtime) = serde_json::from_str::<HashMap<String, TimerRuleRuntime>>(&raw) {
            apply_runtime(&mut settings, &runtime);
        }
    }
    settings
}

fn save_config(app: &tauri::AppHandle, settings: &TimerSettings) -> Result<(), String> {
    let mut portable = sanitize_settings(settings.clone());
    for rule in &mut portable.rules {
        rule.last_fired_at = None;
        rule.last_daily_keys.clear();
    }
    crate::plugin_config::set_plugin_config(app, PLUGIN_ID, &portable)
}

fn save_runtime(db: &db::Db, settings: &TimerSettings) -> Result<(), String> {
    let runtime: HashMap<String, TimerRuleRuntime> = settings
        .rules
        .iter()
        .map(|rule| {
            (
                rule.id.clone(),
                TimerRuleRuntime {
                    last_fired_at: rule.last_fired_at,
                    last_daily_keys: rule.last_daily_keys.clone(),
                },
            )
        })
        .collect();
    let json = serde_json::to_string(&runtime).map_err(|e| e.to_string())?;
    db.set_plugin_storage(PLUGIN_ID, RUNTIME_STORAGE_KEY, &json)
        .map_err(|e| e.to_string())
}

fn apply_runtime(settings: &mut TimerSettings, runtime: &HashMap<String, TimerRuleRuntime>) {
    for rule in &mut settings.rules {
        if let Some(state) = runtime.get(&rule.id) {
            rule.last_fired_at = state.last_fired_at;
            rule.last_daily_keys = state.last_daily_keys.clone();
        }
    }
}

fn sanitize_settings(mut s: TimerSettings) -> TimerSettings {
    if s.rules.len() > MAX_RULES {
        s.rules.truncate(MAX_RULES);
    }
    for r in &mut s.rules {
        if r.id.trim().is_empty() {
            r.id = Uuid::new_v4().to_string();
        }
        r.interval_minutes = r.interval_minutes.clamp(MIN_INTERVAL, MAX_INTERVAL);
        r.daily_times = normalize_daily_times(&r.daily_times);
        if r.last_daily_keys.len() > MAX_DAILY_KEYS {
            let skip = r.last_daily_keys.len() - MAX_DAILY_KEYS;
            r.last_daily_keys = r.last_daily_keys[skip..].to_vec();
        }
        if r.mode == TimerMode::Daily && r.daily_times.is_empty() {
            // keep empty — won't fire until user adds times
        }
    }
    s
}

fn normalize_daily_times(times: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for t in times {
        if let Some(norm) = normalize_hhmm(t) {
            if !out.contains(&norm) {
                out.push(norm);
            }
        }
        if out.len() >= MAX_DAILY_TIMES {
            break;
        }
    }
    out.sort();
    out
}

fn normalize_hhmm(s: &str) -> Option<String> {
    let s = s.trim();
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(format!("{h:02}:{m:02}"))
}

fn default_title(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "定时提醒",
        _ => "Timed Reminder",
    }
}

fn default_body(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "该处理这件事了。",
        _ => "It's time for this reminder.",
    }
}

fn action_label(locale: &str, id: &str) -> String {
    match (locale, id) {
        ("zh-CN", "ack") => "知道了".into(),
        (_, "ack") => "Got it".into(),
        ("zh-CN", "snooze_5") => "5 分钟后".into(),
        (_, "snooze_5") => "Snooze 5m".into(),
        ("zh-CN", "skip") => "跳过".into(),
        (_, "skip") => "Skip".into(),
        _ => id.into(),
    }
}

fn rule_title(rule: &TimerRule, locale: &str) -> String {
    let t = rule.title.trim();
    if t.is_empty() {
        default_title(locale).to_string()
    } else {
        t.to_string()
    }
}

fn rule_body(rule: &TimerRule, locale: &str) -> String {
    let b = rule.body.trim();
    if b.is_empty() {
        default_body(locale).to_string()
    } else {
        b.to_string()
    }
}

fn show_timer_notification(rule: &TimerRule, locale: &str, bus: &EventBus) {
    let mode = match rule.mode {
        TimerMode::Interval => "interval",
        TimerMode::Daily => "daily",
    };
    let event = BusEvent {
        id: String::new(),
        event_type: "reminder.timer.due".into(),
        source: EventSource::Internal,
        kind: "timer".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title: rule_title(rule, locale),
        body: rule_body(rule, locale),
        actions: vec![
            EventAction {
                id: "ack".into(),
                label: action_label(locale, "ack"),
                payload: None,
            },
            EventAction {
                id: "snooze_5".into(),
                label: action_label(locale, "snooze_5"),
                payload: None,
            },
            EventAction {
                id: "skip".into(),
                label: action_label(locale, "skip"),
                payload: None,
            },
        ],
        progress: None,
        sticky: Some(false),
        payload: serde_json::json!({
            "rule_id": rule.id,
            "mode": mode,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some(format!("reminder.timer.due:{}", rule.id)),
    };
    if let Err(e) = bus.publish(event) {
        crate::log_error!("timer", "bus.publish failed: {}", e);
    }
}

fn find_rule_mut<'a>(settings: &'a mut TimerSettings, rule_id: &str) -> Option<&'a mut TimerRule> {
    settings.rules.iter_mut().find(|r| r.id == rule_id)
}

fn today_key(date: &str, hhmm: &str) -> String {
    format!("{date}T{hhmm}")
}

fn prune_daily_keys(keys: &mut Vec<String>, keep_prefix: &str) {
    // 优先保留当天 key；总量超出时截断尾部
    let today: Vec<String> = keys
        .iter()
        .filter(|k| k.starts_with(keep_prefix))
        .cloned()
        .collect();
    let mut others: Vec<String> = keys
        .iter()
        .filter(|k| !k.starts_with(keep_prefix))
        .cloned()
        .collect();
    if today.len() >= MAX_DAILY_KEYS {
        *keys = today[today.len() - MAX_DAILY_KEYS..].to_vec();
        return;
    }
    let budget = MAX_DAILY_KEYS - today.len();
    if others.len() > budget {
        others = others[others.len() - budget..].to_vec();
    }
    others.extend(today);
    *keys = others;
}

/// 分钟循环入口：interval 仅 active；daily 到点必弹
pub fn on_minute_tick(
    active: bool,
    app: &tauri::AppHandle,
    db: &db::Db,
    runtime: &Arc<Mutex<TimerRuntimeState>>,
    locale: &str,
    bus: &EventBus,
) {
    let mut settings = load_settings(app, db);
    if !settings.enabled {
        return;
    }

    let now = Local::now();
    let now_ts = now.timestamp();
    let date = now.format("%Y-%m-%d").to_string();
    let hhmm = format!("{:02}:{:02}", now.hour(), now.minute());

    let mut dirty = false;

    for rule in settings.rules.iter_mut() {
        if !rule.enabled {
            continue;
        }

        {
            let rt = runtime.lock().unwrap();
            if rt.is_snoozed(&rule.id) || !rt.can_send(&rule.id) {
                continue;
            }
        }

        match rule.mode {
            TimerMode::Interval => {
                if !active {
                    continue;
                }
                let interval = rule.interval_minutes.clamp(MIN_INTERVAL, MAX_INTERVAL);
                let overdue = match rule.last_fired_at {
                    Some(last) => now_ts - last >= interval * 60,
                    // 首次：以「现在」为锚，下一周期再弹，避免启用瞬间连弹
                    None => {
                        rule.last_fired_at = Some(now_ts);
                        dirty = true;
                        false
                    }
                };
                if overdue {
                    {
                        let mut rt = runtime.lock().unwrap();
                        rt.mark_sent(&rule.id);
                    }
                    rule.last_fired_at = Some(now_ts);
                    dirty = true;
                    show_timer_notification(rule, locale, bus);
                }
            }
            TimerMode::Daily => {
                let times = normalize_daily_times(&rule.daily_times);
                if !times.iter().any(|t| t == &hhmm) {
                    continue;
                }
                let key = today_key(&date, &hhmm);
                if rule.last_daily_keys.iter().any(|k| k == &key) {
                    continue;
                }
                {
                    let mut rt = runtime.lock().unwrap();
                    rt.mark_sent(&rule.id);
                }
                rule.last_daily_keys.push(key);
                prune_daily_keys(&mut rule.last_daily_keys, &date);
                dirty = true;
                show_timer_notification(rule, locale, bus);
            }
        }
    }

    if dirty {
        if let Err(e) = save_runtime(db, &settings) {
            crate::log_error!("timer", "save after tick failed: {}", e);
        }
    }
}

// ---------- commands ----------

#[tauri::command]
pub fn get_timer_settings(app: tauri::AppHandle, db: tauri::State<db::Db>) -> TimerSettings {
    load_settings(&app, &db)
}

#[tauri::command]
pub fn set_timer_plugin_enabled(
    enabled: bool,
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
) -> Result<(), String> {
    let _ = db;
    crate::plugin_config::set_plugin_config_entry(
        &app,
        PLUGIN_ID,
        "enabled".into(),
        serde_json::Value::Bool(enabled),
    )
}

#[tauri::command]
pub fn set_timer_settings(
    settings: TimerSettings,
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    runtime: tauri::State<Arc<Mutex<TimerRuntimeState>>>,
) -> Result<TimerSettings, String> {
    let enabled = load_settings(&app, &db).enabled;
    let mut sanitized = sanitize_settings(settings);
    sanitized.enabled = enabled;
    // 删掉的规则清 snooze
    {
        let mut rt = runtime.lock().unwrap();
        let ids: std::collections::HashSet<_> =
            sanitized.rules.iter().map(|r| r.id.clone()).collect();
        rt.snooze_until.retain(|k, _| ids.contains(k));
        rt.last_sent.retain(|k, _| ids.contains(k));
    }
    // 新启用的 interval 规则若无 anchor，写入 now，避免立刻 due
    let now_ts = Local::now().timestamp();
    for r in &mut sanitized.rules {
        if r.enabled && r.mode == TimerMode::Interval && r.last_fired_at.is_none() {
            r.last_fired_at = Some(now_ts);
        }
    }
    save_config(&app, &sanitized)?;
    save_runtime(&db, &sanitized)?;
    Ok(sanitized)
}

#[tauri::command]
pub fn test_timer_notification(
    rule_id: Option<String>,
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    bus: tauri::State<EventBus>,
) -> Result<(), String> {
    let settings = load_settings(&app, &db);
    let locale = db.get_setting("locale", "zh-CN");
    let rule = if let Some(id) = rule_id {
        settings
            .rules
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| "rule not found".to_string())?
    } else {
        settings.rules.into_iter().next().unwrap_or(TimerRule {
            id: "test".into(),
            enabled: true,
            title: String::new(),
            body: String::new(),
            mode: TimerMode::Interval,
            interval_minutes: 60,
            daily_times: vec![],
            last_fired_at: None,
            last_daily_keys: vec![],
        })
    };
    show_timer_notification(&rule, &locale, &bus);
    Ok(())
}

#[tauri::command]
pub fn snooze_timer_reminder(
    rule_id: String,
    minutes: u64,
    runtime: tauri::State<Arc<Mutex<TimerRuntimeState>>>,
) {
    let minutes = minutes.clamp(1, 24 * 60);
    runtime.lock().unwrap().snooze(&rule_id, minutes);
}

#[tauri::command]
pub fn ack_timer_reminder(
    rule_id: String,
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    runtime: tauri::State<Arc<Mutex<TimerRuntimeState>>>,
) {
    runtime.lock().unwrap().clear_snooze(&rule_id);
    // interval：ack 后从现在重新计时
    let mut settings = load_settings(&app, &db);
    if let Some(rule) = find_rule_mut(&mut settings, &rule_id) {
        if rule.mode == TimerMode::Interval {
            rule.last_fired_at = Some(Local::now().timestamp());
            let _ = save_runtime(&db, &settings);
        }
    }
}

#[tauri::command]
pub fn skip_timer_reminder(
    rule_id: String,
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    runtime: tauri::State<Arc<Mutex<TimerRuntimeState>>>,
) {
    runtime.lock().unwrap().clear_snooze(&rule_id);
    let mut settings = load_settings(&app, &db);
    let now = Local::now();
    let now_ts = now.timestamp();
    let date = now.format("%Y-%m-%d").to_string();
    let hhmm = format!("{:02}:{:02}", now.hour(), now.minute());

    if let Some(rule) = find_rule_mut(&mut settings, &rule_id) {
        match rule.mode {
            TimerMode::Interval => {
                // 跳过本周期：锚点推到 now
                rule.last_fired_at = Some(now_ts);
            }
            TimerMode::Daily => {
                // 标记当前时刻已处理（若正在该分钟）
                let key = today_key(&date, &hhmm);
                if !rule.last_daily_keys.iter().any(|k| k == &key) {
                    rule.last_daily_keys.push(key);
                    prune_daily_keys(&mut rule.last_daily_keys, &date);
                }
            }
        }
        let _ = save_runtime(&db, &settings);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_hhmm_ok() {
        assert_eq!(normalize_hhmm("9:5").as_deref(), Some("09:05"));
        assert_eq!(normalize_hhmm("23:59").as_deref(), Some("23:59"));
        assert!(normalize_hhmm("24:00").is_none());
        assert!(normalize_hhmm("12").is_none());
    }

    #[test]
    fn sanitize_clamps_interval_and_rules() {
        let mut s = TimerSettings {
            enabled: true,
            rules: (0..25)
                .map(|i| TimerRule {
                    id: format!("r{i}"),
                    enabled: true,
                    title: String::new(),
                    body: String::new(),
                    mode: TimerMode::Interval,
                    interval_minutes: 9999,
                    daily_times: vec!["25:00".into(), "08:30".into()],
                    last_fired_at: None,
                    last_daily_keys: vec![],
                })
                .collect(),
        };
        s = sanitize_settings(s);
        assert_eq!(s.rules.len(), MAX_RULES);
        assert_eq!(s.rules[0].interval_minutes, MAX_INTERVAL);
        assert_eq!(s.rules[0].daily_times, vec!["08:30".to_string()]);
    }
}
