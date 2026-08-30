use serde::Deserialize;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::require_plugin_api;
use crate::plugins::PluginManager;

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
