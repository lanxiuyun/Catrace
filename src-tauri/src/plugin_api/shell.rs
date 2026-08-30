use tauri::State;
use tauri_plugin_opener::OpenerExt;

use super::require_plugin_api;
use crate::plugins::PluginManager;

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
