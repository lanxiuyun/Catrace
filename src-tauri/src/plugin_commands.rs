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
const RESOURCE_ACTIVITY_WINDOW: Duration = Duration::from_secs(60);
const EVENT_COUNT_WARNING_THRESHOLD: usize = 60;
const MEMORY_USAGE_WARNING_THRESHOLD: usize = 128 * 1024 * 1024;
const MEMORY_SAMPLE_WARNING_THRESHOLD: usize = 4;
const STORAGE_BYTES_WARNING_THRESHOLD: usize = 16 * 1024 * 1024;
const LARGE_DATA_WARNING_THRESHOLD: usize = 8 * 1024 * 1024;
const RESOURCE_WARNING_INTERVAL: Duration = Duration::from_secs(10);

static RESOURCE_ACTIVITY: Mutex<Option<HashMap<String, PluginResourceActivity>>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnomalyReason {
    EventBurst,
    EventMemoryPressure,
    StorageWritePressure,
    LargeEventData,
    LargeStorageData,
}

impl AnomalyReason {
    fn message(self) -> &'static str {
        match self {
            Self::EventBurst => "high event publish activity (> 60 events in 60s)",
            Self::EventMemoryPressure => {
                "continuous high memory usage observed (>= 128 MiB for 4 samples)"
            }
            Self::StorageWritePressure => "continuous storage writes observed (> 16 MiB in 60s)",
            Self::LargeEventData => "large event data observed (>= 8 MiB)",
            Self::LargeStorageData => "large storage value observed (>= 8 MiB)",
        }
    }
}

#[derive(Default)]
struct PluginResourceActivity {
    events: VecDeque<(Instant, usize)>,
    memory_samples: VecDeque<(Instant, usize)>,
    storage_writes: VecDeque<(Instant, usize)>,
    last_warning: Option<Instant>,
}

impl PluginResourceActivity {
    fn record_event(&mut self, now: Instant, bytes: usize) -> Option<AnomalyReason> {
        prune_samples(&mut self.events, now);
        self.events.push_back((now, bytes));
        let reason = if bytes >= LARGE_DATA_WARNING_THRESHOLD {
            Some(AnomalyReason::LargeEventData)
        } else if self.events.len() > EVENT_COUNT_WARNING_THRESHOLD {
            Some(AnomalyReason::EventBurst)
        } else {
            None
        };
        self.throttle(now, reason)
    }

    fn record_memory_sample(&mut self, now: Instant, bytes: usize) -> Option<AnomalyReason> {
        prune_samples(&mut self.memory_samples, now);
        self.memory_samples.push_back((now, bytes));
        let sustained_high_memory = self.memory_samples.len() >= MEMORY_SAMPLE_WARNING_THRESHOLD
            && self
                .memory_samples
                .iter()
                .all(|(_, bytes)| *bytes >= MEMORY_USAGE_WARNING_THRESHOLD);
        let reason = sustained_high_memory.then_some(AnomalyReason::EventMemoryPressure);
        self.throttle(now, reason)
    }

    fn record_storage_write(&mut self, now: Instant, bytes: usize) -> Option<AnomalyReason> {
        prune_samples(&mut self.storage_writes, now);
        self.storage_writes.push_back((now, bytes));
        let reason = if bytes >= LARGE_DATA_WARNING_THRESHOLD {
            Some(AnomalyReason::LargeStorageData)
        } else if sample_bytes(&self.storage_writes) > STORAGE_BYTES_WARNING_THRESHOLD {
            Some(AnomalyReason::StorageWritePressure)
        } else {
            None
        };
        self.throttle(now, reason)
    }

    fn throttle(&mut self, now: Instant, reason: Option<AnomalyReason>) -> Option<AnomalyReason> {
        let reason = reason?;
        if self.last_warning.map_or(false, |time| {
            now.duration_since(time) < RESOURCE_WARNING_INTERVAL
        }) {
            return None;
        }
        self.last_warning = Some(now);
        Some(reason)
    }
}

fn prune_samples(samples: &mut VecDeque<(Instant, usize)>, now: Instant) {
    while samples
        .front()
        .is_some_and(|(time, _)| now.duration_since(*time) > RESOURCE_ACTIVITY_WINDOW)
    {
        samples.pop_front();
    }
}

fn sample_bytes(samples: &VecDeque<(Instant, usize)>) -> usize {
    samples
        .iter()
        .fold(0usize, |total, (_, bytes)| total.saturating_add(*bytes))
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

fn record_resource_activity(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
    plugin_id: &str,
    record: impl FnOnce(&mut PluginResourceActivity, Instant) -> Option<AnomalyReason>,
) {
    let reason = RESOURCE_ACTIVITY.lock().ok().and_then(|mut guard| {
        let activity = guard
            .get_or_insert_with(HashMap::new)
            .entry(plugin_id.to_string())
            .or_default();
        record(activity, Instant::now())
    });
    let Some(reason) = reason else {
        return;
    };
    if let Err(error) = plugins.mark_anomalous(plugin_id) {
        log_warn!("plugin", "[{plugin_id}] failed to mark anomaly: {error}");
    } else {
        let _ = app.emit("catrace:plugin-anomaly", plugin_id);
    }
    log_warn!(
        "plugin",
        "[{plugin_id}] {}; plugin calls are not blocked",
        reason.message()
    );
}

fn record_event_activity(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
    plugin_id: &str,
    bytes: usize,
) {
    record_resource_activity(app, plugins, plugin_id, |activity, now| {
        activity.record_event(now, bytes)
    });
}

fn record_memory_activity(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
    plugin_id: &str,
    bytes: usize,
) {
    record_resource_activity(app, plugins, plugin_id, |activity, now| {
        activity.record_memory_sample(now, bytes)
    });
}

fn record_storage_activity(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
    plugin_id: &str,
    bytes: usize,
) {
    record_resource_activity(app, plugins, plugin_id, |activity, now| {
        activity.record_storage_write(now, bytes)
    });
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
    let bytes = serde_json::to_vec(&published)
        .map(|data| data.len())
        .unwrap_or(0);
    record_event_activity(window.app_handle(), &plugins, &id, bytes);
    Ok(published)
}

#[tauri::command]
pub fn plugin_report_memory(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    bytes: usize,
) -> Result<(), String> {
    let id = require_enabled_plugin(&window, &plugins)?;
    record_memory_activity(window.app_handle(), &plugins, &id, bytes);
    Ok(())
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
        .map_err(|e| e.to_string())?;
    record_storage_activity(window.app_handle(), &plugins, &id, json.len());
    Ok(())
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
        AnomalyReason, PluginResourceActivity, EVENT_COUNT_WARNING_THRESHOLD,
        LARGE_DATA_WARNING_THRESHOLD, MEMORY_SAMPLE_WARNING_THRESHOLD,
        MEMORY_USAGE_WARNING_THRESHOLD, RESOURCE_WARNING_INTERVAL, STORAGE_BYTES_WARNING_THRESHOLD,
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
    fn event_burst_is_observed_without_blocking() {
        let mut activity = PluginResourceActivity::default();
        let start = Instant::now();
        for _ in 0..EVENT_COUNT_WARNING_THRESHOLD {
            assert_eq!(activity.record_event(start, 1), None);
        }
        assert_eq!(
            activity.record_event(start, 1),
            Some(AnomalyReason::EventBurst)
        );
        assert_eq!(activity.record_event(start, 1), None);
        assert_eq!(
            activity.record_event(start + RESOURCE_WARNING_INTERVAL, 1),
            Some(AnomalyReason::EventBurst)
        );
    }

    #[test]
    fn continuous_memory_samples_are_observed() {
        let mut activity = PluginResourceActivity::default();
        let start = Instant::now();
        for _ in 0..MEMORY_SAMPLE_WARNING_THRESHOLD - 1 {
            assert_eq!(
                activity.record_memory_sample(start, MEMORY_USAGE_WARNING_THRESHOLD),
                None
            );
        }
        assert_eq!(
            activity.record_memory_sample(start, MEMORY_USAGE_WARNING_THRESHOLD),
            Some(AnomalyReason::EventMemoryPressure)
        );
    }

    #[test]
    fn continuous_storage_writes_and_large_values_are_observed() {
        let start = Instant::now();
        let mut continuous = PluginResourceActivity::default();
        let chunk = STORAGE_BYTES_WARNING_THRESHOLD / 4 + 1;
        for _ in 0..3 {
            assert_eq!(continuous.record_storage_write(start, chunk), None);
        }
        assert_eq!(
            continuous.record_storage_write(start, chunk),
            Some(AnomalyReason::StorageWritePressure)
        );

        let mut large = PluginResourceActivity::default();
        assert_eq!(
            large.record_storage_write(start, LARGE_DATA_WARNING_THRESHOLD),
            Some(AnomalyReason::LargeStorageData)
        );
        let mut large_event = PluginResourceActivity::default();
        assert_eq!(
            large_event.record_event(start, LARGE_DATA_WARNING_THRESHOLD),
            Some(AnomalyReason::LargeEventData)
        );
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
