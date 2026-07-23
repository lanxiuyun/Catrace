use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
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

fn require_permission(
    window: &tauri::WebviewWindow,
    plugins: &PluginManager,
    permission: &str,
) -> Result<String, String> {
    let id = caller_id(window)?;
    plugins.has_permission(&id, permission)?;
    Ok(id)
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
    let id = require_permission(&window, &plugins, "notification")?;
    plugins.allows_event(&id, &event.kind, &event.event_type)?;
    bus.publish(BusEvent {
        id: String::new(),
        event_type: event.event_type,
        source: EventSource::Plugin { name: id },
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
    })
}

#[tauri::command]
pub fn plugin_get_activity(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    activity: State<'_, Arc<Mutex<ActivityState>>>,
) -> Result<PluginActivitySnapshot, String> {
    require_permission(&window, &plugins, "activity")?;
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
    let id = require_permission(&window, &plugins, "storage")?;
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
    let id = require_permission(&window, &plugins, "storage")?;
    validate_storage_key(&key)?;
    let json = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    if json.len() > 64 * 1024 {
        return Err("plugin storage value too large (>64KiB)".into());
    }
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
    plugins.has_permission(&plugin_id, "clipboard")?;
    if text.as_bytes().len() > 64 * 1024 {
        return Err("clipboard text too large (>64KiB)".into());
    }
    if text.is_empty() {
        return Err("clipboard text cannot be empty".into());
    }
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
    let id = require_permission(&window, &plugins, "logger")?;
    let suffix = data.map(|value| format!(" {value}")).unwrap_or_default();
    match level.as_str() {
        "error" => log_error!("plugin", "[{id}] {message}{suffix}"),
        "warn" => log_warn!("plugin", "[{id}] {message}{suffix}"),
        _ => log_info!("plugin", "[{id}] {message}{suffix}"),
    }
    Ok(())
}

fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 128 || key.contains(':') {
        return Err("plugin storage key must be 1..128 characters and cannot contain colon".into());
    }
    Ok(())
}

fn storage_key(id: &str, key: &str) -> String {
    format!("{STORAGE_KEY_PREFIX}{id}:{key}")
}

#[cfg(test)]
mod tests {
    use super::{require_plugin_card_caller, require_plugin_event};
    use crate::event::{BusEvent, EventSource};

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
            source: EventSource::Plugin { name: "demo-timer".into() },
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

    use super::{storage_key, validate_storage_key};

    #[test]
    fn validates_storage_keys() {
        assert!(validate_storage_key("tickCount").is_ok());
        assert!(validate_storage_key("").is_err());
        assert!(validate_storage_key("nested:key").is_err());
        assert!(validate_storage_key(&"a".repeat(129)).is_err());
    }

    #[test]
    fn namespaces_storage_by_plugin_id() {
        assert_eq!(
            storage_key("demo-timer", "tickCount"),
            "plugin_storage:demo-timer:tickCount"
        );
    }
}
