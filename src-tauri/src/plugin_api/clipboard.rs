use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::require_plugin_api;
use crate::plugins::PluginManager;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginClipboardImage {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
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
