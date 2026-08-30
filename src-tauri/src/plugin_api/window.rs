use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use super::require_plugin_api;
use crate::plugins::PluginManager;

#[derive(Debug, Deserialize, Serialize)]
pub struct PluginScreenPoint {
    x: f64,
    y: f64,
}

#[tauri::command]
pub fn plugin_api_window_hide_main(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .app_handle()
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?
        .hide()
        .map_err(|e| format!("hide main window: {e}"))
}

#[tauri::command]
pub fn plugin_api_window_show_main(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let main = window
        .app_handle()
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    main.show().map_err(|e| format!("show main window: {e}"))?;
    main.set_focus()
        .map_err(|e| format!("focus main window: {e}"))
}

#[tauri::command]
pub fn plugin_api_screen_get_cursor_point(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<PluginScreenPoint, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let point = window
        .cursor_position()
        .map_err(|e| format!("get cursor position: {e}"))?;
    Ok(PluginScreenPoint {
        x: point.x,
        y: point.y,
    })
}

#[tauri::command]
pub fn plugin_api_screen_get_display_nearest_point(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    point: PluginScreenPoint,
) -> Result<Option<tauri::Monitor>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .monitor_from_point(point.x, point.y)
        .map_err(|e| format!("get display nearest point: {e}"))
}

#[tauri::command]
pub fn plugin_api_screen_get_all_displays(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<Vec<tauri::Monitor>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .available_monitors()
        .map_err(|e| format!("get displays: {e}"))
}
