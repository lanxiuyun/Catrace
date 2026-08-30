use tauri::State;

use super::{require_plugin_api, validate_storage_key};
use crate::db::Db;
use crate::plugins::PluginManager;

#[tauri::command]
pub fn plugin_api_storage_get(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    db: State<'_, Db>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    validate_storage_key(&key)?;
    db.get_plugin_storage(&plugin_id, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_api_storage_set(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    db: State<'_, Db>,
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    validate_storage_key(&key)?;
    db.set_plugin_storage(&plugin_id, &key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_api_storage_remove(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    db: State<'_, Db>,
    plugin_id: String,
    key: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    validate_storage_key(&key)?;
    db.remove_plugin_storage(&plugin_id, &key)
        .map_err(|e| e.to_string())
}
