use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const SETTINGS_STORE_PATH: &str = "settings.json";
const PLUGIN_CONFIG_PREFIX: &str = "plugin_config:";

fn plugin_key(plugin_id: &str) -> String {
    format!("{PLUGIN_CONFIG_PREFIX}{plugin_id}")
}

pub fn get_plugin_config<T: DeserializeOwned>(
    app: &AppHandle,
    plugin_id: &str,
) -> Result<Option<T>, String> {
    let store = app.store(SETTINGS_STORE_PATH).map_err(|e| e.to_string())?;
    store
        .get(plugin_key(plugin_id))
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| e.to_string())
}

pub fn set_plugin_config<T: Serialize>(
    app: &AppHandle,
    plugin_id: &str,
    config: &T,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE_PATH).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    store.set(plugin_key(plugin_id), value);
    store.save().map_err(|e| e.to_string())
}

pub fn get_plugin_config_entry(
    app: &AppHandle,
    plugin_id: &str,
    key: &str,
) -> Result<Option<Value>, String> {
    let config = get_plugin_config::<Map<String, Value>>(app, plugin_id)?.unwrap_or_default();
    Ok(config.get(key).cloned())
}

pub fn set_plugin_config_entry(
    app: &AppHandle,
    plugin_id: &str,
    key: String,
    value: Value,
) -> Result<(), String> {
    let mut config = get_plugin_config::<Map<String, Value>>(app, plugin_id)?.unwrap_or_default();
    config.insert(key, value);
    set_plugin_config(app, plugin_id, &config)
}
