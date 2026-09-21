use tauri::{command, plugin::Builder, plugin::TauriPlugin, AppHandle, Manager, Runtime, WebviewWindow};

mod shared;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(target_os = "windows"))]
mod macos;

pub use shared::{
    fullscreen_placements, is_fullscreen_window_label, FULLSCREEN_DATA_KEY, POPUP_WINDOW_LABEL,
    TOAST_WINDOW_LABEL,
};

#[cfg(target_os = "windows")]
use windows as platform;
#[cfg(not(target_os = "windows"))]
use macos as platform;

#[command]
pub async fn set_window_active_mode<R: Runtime>(window: WebviewWindow<R>, active: bool) {
    platform::set_window_active_mode_internal(&window, active);
}

pub use platform::{
    ensure_reminder_topmost, hide_window_internal, os_text_scale_factor, set_window_active_mode_internal,
    set_window_rect_physical, show_reminder_no_activate,
};

pub fn is_fullscreen_reminder_open<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.webview_windows()
        .keys()
        .any(|label| shared::is_fullscreen_window_label(label))
}

pub fn close_fullscreen_windows<R: Runtime>(app: &AppHandle<R>) {
    let labels: Vec<String> = app.webview_windows().into_keys().collect();
    for label in shared::fullscreen_labels_among(labels.iter().map(String::as_str)) {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.close();
        }
    }
}

/// 初始化窗口管理插件
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("catrace-window").build()
}
