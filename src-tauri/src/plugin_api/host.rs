use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use super::require_plugin_api;
use crate::plugins::PluginManager;
use crate::{log_error, log_info, log_warn};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHttpResponse {
    status: u16,
    url: String,
    content_type: Option<String>,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginProcessInfo {
    pid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPlatformInfo {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
}

#[tauri::command]
pub fn plugin_api_get_environment(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<HashMap<String, String>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    Ok(std::env::vars().collect())
}

#[tauri::command]
pub fn plugin_api_spawn_process(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    path: String,
    args: Vec<String>,
) -> Result<PluginProcessInfo, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    if path.trim().is_empty() {
        return Err("program path cannot be empty".into());
    }
    let child = Command::new(&path)
        .args(args)
        .spawn()
        .map_err(|e| format!("start program {path}: {e}"))?;
    Ok(PluginProcessInfo { pid: child.id() })
}

#[tauri::command]
pub fn plugin_api_log(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    level: String,
    message: String,
    data: Option<serde_json::Value>,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let suffix = data
        .as_ref()
        .map(|value| format!(" {value}"))
        .unwrap_or_default();
    match level.as_str() {
        "error" => log_error!("plugin", "[{plugin_id}] {message}{suffix}"),
        "warn" => log_warn!("plugin", "[{plugin_id}] {message}{suffix}"),
        "info" => log_info!("plugin", "[{plugin_id}] {message}{suffix}"),
        other => log_info!("plugin", "[{plugin_id}][{other}] {message}{suffix}"),
    }
    let _ = window.app_handle().emit_to(
        "main",
        "catrace:plugin-log",
        serde_json::json!({
            "pluginId": plugin_id,
            "level": level,
            "message": message,
            "data": data,
        }),
    );
    Ok(())
}

#[tauri::command]
pub async fn plugin_api_http_get(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    url: String,
) -> Result<PluginHttpResponse, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .map_err(|e| format!("read GET response: {e}"))?;
    Ok(PluginHttpResponse {
        status,
        url: final_url,
        content_type,
        body,
    })
}

#[tauri::command]
pub fn plugin_api_get_path(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    name: String,
) -> Result<String, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let resolver = window.app_handle().path();
    let path = match name.as_str() {
        "appData" => resolver.app_data_dir(),
        "appConfig" => resolver.app_config_dir(),
        "appCache" => resolver.app_cache_dir(),
        "home" => resolver.home_dir(),
        "desktop" => resolver.desktop_dir(),
        "documents" => resolver.document_dir(),
        "downloads" => resolver.download_dir(),
        "temp" => Ok(std::env::temp_dir()),
        _ => return Err(format!("unsupported path name: {name}")),
    }
    .map_err(|e| format!("resolve path {name}: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn plugin_api_get_plugin_dir(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<String, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    plugins.plugin_dir(&plugin_id)
}

#[tauri::command]
pub fn plugin_api_platform_get_info(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<PluginPlatformInfo, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        _ => "unknown",
    };
    Ok(PluginPlatformInfo {
        os,
        arch: std::env::consts::ARCH,
        family: std::env::consts::FAMILY,
    })
}

#[tauri::command]
pub fn plugin_api_theme_is_dark(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<bool, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .theme()
        .map(|theme| matches!(theme, tauri::Theme::Dark))
        .map_err(|e| format!("read window theme: {e}"))
}
