use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::bus::EventBus;
use crate::db::Db;
use crate::event::{
    BusEvent, DisplayMode, EventAction, EventLevel, EventProgress, EventSource, EventStatus,
};
use crate::plugin_window::plugin_id_from_label;
use crate::plugins::PluginManager;
use crate::{log_error, log_info, log_warn, ActivityState};

const STORAGE_KEY_PREFIX: &str = "plugin_storage:";
const PUBLISH_ACTIVITY_WINDOW: Duration = Duration::from_secs(60);
const PUBLISH_ACTIVITY_WARNING_THRESHOLD: usize = 60;
const PUBLISH_WARNING_INTERVAL: Duration = Duration::from_secs(10);

static PUBLISH_ACTIVITY: Mutex<Option<HashMap<String, PublishActivity>>> = Mutex::new(None);

#[derive(Default)]
struct PublishActivity {
    published: VecDeque<Instant>,
    last_warning: Option<Instant>,
}

impl PublishActivity {
    fn record(&mut self, now: Instant) -> bool {
        while self
            .published
            .front()
            .is_some_and(|time| now.duration_since(*time) > PUBLISH_ACTIVITY_WINDOW)
        {
            self.published.pop_front();
        }
        self.published.push_back(now);
        let should_warn = self.published.len() > PUBLISH_ACTIVITY_WARNING_THRESHOLD
            && self.last_warning.map_or(true, |time| {
                now.duration_since(time) >= PUBLISH_WARNING_INTERVAL
            });
        if should_warn {
            self.last_warning = Some(now);
        }
        should_warn
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPublishInput {
    pub event_type: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub level: EventLevel,
    #[serde(default)]
    pub actions: Vec<EventAction>,
    #[serde(default)]
    pub progress: Option<EventProgress>,
    #[serde(default)]
    pub sticky: Option<bool>,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub dedupe_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActivitySnapshot {
    active: bool,
    count: u32,
    media_active: bool,
    fullscreen_active: bool,
}

fn caller_id(window: &tauri::WebviewWindow) -> Result<String, String> {
    Ok(plugin_id_from_label(window.label())?.to_string())
}

fn require_enabled_plugin(
    window: &tauri::WebviewWindow,
    plugins: &PluginManager,
) -> Result<String, String> {
    let id = caller_id(window)?;
    plugins.ensure_enabled(&id)?;
    Ok(id)
}

fn record_publish_activity(app: &tauri::AppHandle, plugins: &PluginManager, plugin_id: &str) {
    let should_warn = PUBLISH_ACTIVITY
        .lock()
        .ok()
        .map(|mut guard| {
            guard
                .get_or_insert_with(HashMap::new)
                .entry(plugin_id.to_string())
                .or_default()
                .record(Instant::now())
        })
        .unwrap_or(false);
    if should_warn {
        if let Err(error) = plugins.mark_anomalous(plugin_id) {
            log_warn!("plugin", "[{plugin_id}] failed to mark anomaly: {error}");
        } else {
            let _ = app.emit("catrace:plugin-anomaly", plugin_id);
        }
        log_warn!(
            "plugin",
            "[{plugin_id}] high publish activity observed (> {PUBLISH_ACTIVITY_WARNING_THRESHOLD} events in 60s); events are not blocked"
        );
    }
}

fn require_plugin_card_caller(label: &str) -> Result<(), String> {
    if label != "reminder-toast" {
        return Err("plugin card command is only available in reminder-toast".into());
    }
    Ok(())
}

fn require_plugin_event(event: &BusEvent, plugin_id: &str) -> Result<(), String> {
    match &event.source {
        EventSource::Plugin { name } if name == plugin_id => Ok(()),
        EventSource::Plugin { .. } => Err("event source does not match plugin".into()),
        _ => Err("event is not owned by a plugin".into()),
    }
}

#[tauri::command]
pub fn get_plugin_background_source(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
) -> Result<String, String> {
    let id = caller_id(&window)?;
    plugins.background_source(&id)
}

#[tauri::command]
pub fn plugin_publish_event(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    bus: State<'_, EventBus>,
    event: PluginPublishInput,
) -> Result<BusEvent, String> {
    let id = require_enabled_plugin(&window, &plugins)?;
    plugins.allows_event(&id, &event.kind, &event.event_type)?;
    let event = BusEvent {
        id: String::new(),
        event_type: event.event_type,
        source: EventSource::Plugin { name: id.clone() },
        kind: event.kind,
        display_mode: DisplayMode::Toast,
        level: event.level,
        title: event.title,
        body: event.body,
        actions: event.actions,
        progress: event.progress,
        sticky: event.sticky,
        payload: event.payload,
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 1,
        resolved_at: None,
        resolution: None,
        expires_at: event.expires_at,
        correlation_id: event.correlation_id,
        dedupe_key: event.dedupe_key,
    };
    let published = bus.publish(event)?;
    record_publish_activity(window.app_handle(), &plugins, &id);
    Ok(published)
}

#[tauri::command]
pub fn plugin_get_activity(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    activity: State<'_, Arc<Mutex<ActivityState>>>,
) -> Result<PluginActivitySnapshot, String> {
    require_enabled_plugin(&window, &plugins)?;
    let state = activity.lock().map_err(|e| e.to_string())?;
    let active = !state.fullscreen_snapshot && (state.count > 0 || state.media_active_snapshot);
    Ok(PluginActivitySnapshot {
        active,
        count: state.count,
        media_active: state.media_active_snapshot,
        fullscreen_active: state.fullscreen_snapshot,
    })
}

#[tauri::command]
pub fn plugin_storage_get(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    db: State<'_, Db>,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let id = require_enabled_plugin(&window, &plugins)?;
    validate_storage_key(&key)?;
    let value = db.get_setting(&storage_key(&id, &key), "");
    if value.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&value)
        .map(Some)
        .map_err(|e| format!("invalid stored JSON: {e}"))
}

#[tauri::command]
pub fn plugin_storage_set(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    db: State<'_, Db>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let id = require_enabled_plugin(&window, &plugins)?;
    validate_storage_key(&key)?;
    let json = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    db.set_setting(&storage_key(&id, &key), &json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_write_clipboard(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    bus: State<'_, EventBus>,
    plugin_id: String,
    event_id: String,
    text: String,
) -> Result<(), String> {
    require_plugin_card_caller(window.label())?;
    plugins.ensure_enabled(&plugin_id)?;
    let event = bus
        .get(&event_id)?
        .ok_or_else(|| format!("event not found: {event_id}"))?;
    require_plugin_event(&event, &plugin_id)?;
    window
        .app_handle()
        .clipboard()
        .write_text(text)
        .map_err(|e| format!("write clipboard: {e}"))
}

#[tauri::command]
pub fn plugin_log(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    level: String,
    message: String,
    data: Option<serde_json::Value>,
) -> Result<(), String> {
    let id = require_enabled_plugin(&window, &plugins)?;
    let suffix = data.map(|value| format!(" {value}")).unwrap_or_default();
    match level.as_str() {
        "error" => log_error!("plugin", "[{id}] {message}{suffix}"),
        "warn" => log_warn!("plugin", "[{id}] {message}{suffix}"),
        "info" => log_info!("plugin", "[{id}] {message}{suffix}"),
        other => log_info!("plugin", "[{id}][{other}] {message}{suffix}"),
    }
    Ok(())
}

fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.contains(':') {
        return Err("plugin storage key cannot be empty or contain colon".into());
    }
    Ok(())
}

fn storage_key(id: &str, key: &str) -> String {
    format!("{STORAGE_KEY_PREFIX}{id}:{key}")
}

#[cfg(test)]
mod tests {
    use super::{
        require_plugin_card_caller, require_plugin_event, storage_key, validate_storage_key,
        PublishActivity, PUBLISH_ACTIVITY_WARNING_THRESHOLD, PUBLISH_WARNING_INTERVAL,
    };
    use crate::event::{BusEvent, EventSource};
    use std::time::Instant;

    #[test]
    fn plugin_card_caller_is_restricted() {
        assert!(require_plugin_card_caller("reminder-toast").is_ok());
        assert!(require_plugin_card_caller("main").is_err());
        assert!(require_plugin_card_caller("plugin-bg-demo-timer").is_err());
    }

    #[test]
    fn plugin_card_event_source_must_match() {
        let mut event = BusEvent {
            id: "event-1".into(),
            event_type: "demo-timer.tick".into(),
            source: EventSource::Plugin {
                name: "demo-timer".into(),
            },
            kind: "demo-timer".into(),
            display_mode: Default::default(),
            level: Default::default(),
            title: "Demo".into(),
            body: String::new(),
            actions: Vec::new(),
            progress: None,
            sticky: None,
            payload: serde_json::Value::Null,
            created_at: 0,
            updated_at: 0,
            status: Default::default(),
            revision: 1,
            resolved_at: None,
            resolution: None,
            expires_at: None,
            correlation_id: None,
            dedupe_key: None,
        };
        assert!(require_plugin_event(&event, "demo-timer").is_ok());
        assert!(require_plugin_event(&event, "other-plugin").is_err());
        event.source = EventSource::Internal;
        assert!(require_plugin_event(&event, "demo-timer").is_err());
    }

    #[test]
    fn publish_activity_is_observed_without_blocking() {
        let mut activity = PublishActivity::default();
        let start = Instant::now();
        for _ in 0..PUBLISH_ACTIVITY_WARNING_THRESHOLD {
            assert!(!activity.record(start));
        }
        assert!(activity.record(start));
        assert!(!activity.record(start));
        assert!(activity.record(start + PUBLISH_WARNING_INTERVAL));
    }

    #[test]
    fn storage_key_rejects_namespace_escape() {
        assert!(validate_storage_key("tickCount").is_ok());
        assert!(validate_storage_key("").is_err());
        assert!(validate_storage_key("nested:key").is_err());
        assert!(validate_storage_key(&"a".repeat(1024)).is_ok());
    }

    #[test]
    fn namespaces_storage_by_plugin_id() {
        assert_eq!(
            storage_key("demo-timer", "tickCount"),
            "plugin_storage:demo-timer:tickCount"
        );
    }
}
