use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use super::require_plugin_api;
use crate::bus::EventBus;
use crate::db::Db;
use crate::event::{BusEvent, DisplayMode, EventLevel, EventSource, EventStatus};
use crate::plugin_commands::{publish_plugin_event, PluginPublishInput};
use crate::plugins::PluginManager;
use crate::ActivityState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNotificationInput {
    title: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    level: EventLevel,
    sticky: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginApiActivitySnapshot {
    active: bool,
    count: u32,
    media_active: bool,
    fullscreen_active: bool,
}

#[tauri::command]
pub fn plugin_api_notification_show(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    bus: State<'_, EventBus>,
    plugin_id: String,
    options: PluginNotificationInput,
) -> Result<BusEvent, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let event_type = format!("{plugin_id}.notification");
    plugins.allows_event(&plugin_id, &plugin_id, &event_type)?;
    bus.publish(BusEvent {
        id: String::new(),
        event_type,
        source: EventSource::Plugin {
            name: plugin_id.clone(),
        },
        kind: plugin_id,
        display_mode: DisplayMode::Toast,
        level: options.level,
        title: options.title,
        body: options.body,
        actions: Vec::new(),
        progress: None,
        sticky: options.sticky,
        payload: serde_json::Value::Null,
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 1,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: None,
    })
}

/// Full Event Bus publish (actions / payload / dedupe). Plugin must be enabled.
#[tauri::command]
pub fn plugin_api_event_publish(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    bus: State<'_, EventBus>,
    plugin_id: String,
    event: PluginPublishInput,
) -> Result<BusEvent, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    publish_plugin_event(window.app_handle(), &plugins, &bus, &plugin_id, event)
}

#[tauri::command]
pub fn plugin_api_get_activity(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    activity: State<'_, Arc<Mutex<ActivityState>>>,
    plugin_id: String,
) -> Result<PluginApiActivitySnapshot, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let state = activity.lock().map_err(|e| e.to_string())?;
    let active = !state.fullscreen_snapshot && (state.count > 0 || state.media_active_snapshot);
    Ok(PluginApiActivitySnapshot {
        active,
        count: state.count,
        media_active: state.media_active_snapshot,
        fullscreen_active: state.fullscreen_snapshot,
    })
}

/// Last end-ts of a continuous idle streak ≥ rest plugin `break_minutes` (today).
#[tauri::command]
pub fn plugin_api_get_last_real_rest(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    db: State<'_, Db>,
    plugin_id: String,
) -> Result<Option<i64>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let break_minutes = crate::rest_plugin::load_config(window.app_handle())
        .break_minutes
        .clamp(1, 24 * 60);
    db.get_last_real_rest_ts(break_minutes)
        .map_err(|e| e.to_string())
}
