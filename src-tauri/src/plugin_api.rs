//! Stable desktop capabilities exposed to enabled external plugins.
//!
//! Keep this module independent from plugin scanning and plugin-specific business logic.

use std::collections::HashMap;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::bus::EventBus;
use crate::db::Db;
use crate::event::{BusEvent, DisplayMode, EventLevel, EventSource, EventStatus};
use crate::plugin_commands::{publish_plugin_event, PluginPublishInput};
use crate::plugins::PluginManager;
use crate::{log_error, log_info, log_warn, ActivityState};
use std::sync::{Arc, Mutex};

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

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginDialogOptions {
    title: Option<String>,
    default_path: Option<String>,
    file_name: Option<String>,
    #[serde(default)]
    filters: Vec<PluginDialogFilter>,
}

#[derive(Debug, Deserialize)]
pub struct PluginDialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPlatformInfo {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginClipboardImage {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PluginScreenPoint {
    x: f64,
    y: f64,
}

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

fn require_plugin_api(
    window: &tauri::WebviewWindow,
    plugins: &PluginManager,
    plugin_id: &str,
) -> Result<(), String> {
    match window.label() {
        "main" | "reminder-toast" => plugins.ensure_enabled(plugin_id),
        label if label == format!("plugin-bg-{plugin_id}") => plugins.ensure_enabled(plugin_id),
        _ => Err("plugin API caller does not match plugin".into()),
    }
}

fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.contains(':') {
        return Err("storage key must be non-empty and must not contain ':'".into());
    }
    Ok(())
}

fn apply_dialog_options<R: tauri::Runtime>(
    mut dialog: tauri_plugin_dialog::FileDialogBuilder<R>,
    options: PluginDialogOptions,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    if let Some(title) = options.title {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = options.default_path {
        dialog = dialog.set_directory(default_path);
    }
    if let Some(file_name) = options.file_name {
        dialog = dialog.set_file_name(file_name);
    }
    for filter in options.filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    dialog
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
pub async fn plugin_api_show_open_dialog(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    directory: bool,
    options: Option<PluginDialogOptions>,
) -> Result<Option<String>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = apply_dialog_options(app.dialog().file(), options.unwrap_or_default());
        if directory {
            dialog.blocking_pick_folder().map(|path| path.to_string())
        } else {
            dialog.blocking_pick_file().map(|path| path.to_string())
        }
    })
    .await
    .map_err(|e| format!("open dialog task failed: {e}"))
}

#[tauri::command]
pub async fn plugin_api_show_save_dialog(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    options: Option<PluginDialogOptions>,
) -> Result<Option<String>, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        apply_dialog_options(app.dialog().file(), options.unwrap_or_default())
            .blocking_save_file()
            .map(|path| path.to_string())
    })
    .await
    .map_err(|e| format!("save dialog task failed: {e}"))
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
pub fn plugin_api_clipboard_write_text(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    text: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .app_handle()
        .clipboard()
        .write_text(text)
        .map_err(|e| format!("write clipboard: {e}"))
}

#[tauri::command]
pub fn plugin_api_clipboard_read_text(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<String, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .app_handle()
        .clipboard()
        .read_text()
        .map_err(|e| format!("read clipboard: {e}"))
}

#[tauri::command]
pub fn plugin_api_clipboard_write_image(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    image: PluginClipboardImage,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let expected_len = image
        .width
        .checked_mul(image.height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "clipboard image dimensions are too large".to_string())?
        as usize;
    if image.rgba.len() != expected_len {
        return Err(format!(
            "clipboard image RGBA length mismatch: expected {expected_len}, got {}",
            image.rgba.len()
        ));
    }
    let clipboard_image = tauri::image::Image::new(&image.rgba, image.width, image.height);
    window
        .app_handle()
        .clipboard()
        .write_image(&clipboard_image)
        .map_err(|e| format!("write clipboard image: {e}"))
}

#[tauri::command]
pub async fn plugin_api_clipboard_read_image(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<PluginClipboardImage, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let image = app
            .clipboard()
            .read_image()
            .map_err(|e| format!("read clipboard image: {e}"))?;
        Ok(PluginClipboardImage {
            rgba: image.rgba().to_vec(),
            width: image.width(),
            height: image.height(),
        })
    })
    .await
    .map_err(|e| format!("read clipboard image task failed: {e}"))?
}

#[tauri::command]
pub fn plugin_api_clipboard_clear(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .app_handle()
        .clipboard()
        .clear()
        .map_err(|e| format!("clear clipboard: {e}"))
}

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

#[tauri::command]
pub fn plugin_api_shell_open_external(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    url: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("open external URL: {e}"))
}

#[tauri::command]
pub fn plugin_api_shell_open_path(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    path: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("open path: {e}"))
}

#[tauri::command]
pub fn plugin_api_shell_show_item_in_folder(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    path: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    window
        .opener()
        .reveal_item_in_dir(path)
        .map_err(|e| format!("show item in folder: {e}"))
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

#[tauri::command]
pub fn plugin_api_shell_beep(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(windows)]
    unsafe {
        windows::Win32::System::Diagnostics::Debug::MessageBeep(
            windows::Win32::UI::WindowsAndMessaging::MB_OK,
        )
        .map_err(|e| format!("play system beep: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        use std::io::Write;
        let mut stderr = std::io::stderr().lock();
        stderr
            .write_all(b"\x07")
            .and_then(|_| stderr.flush())
            .map_err(|e| format!("play system beep: {e}"))?;
    }
    Ok(())
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginApiActivitySnapshot {
    active: bool,
    count: u32,
    media_active: bool,
    fullscreen_active: bool,
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
