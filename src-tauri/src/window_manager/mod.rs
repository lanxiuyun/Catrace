use tauri::{command, generate_handler, plugin::Builder, plugin::TauriPlugin, AppHandle, Runtime, WebviewWindow};

mod shared;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod windows;

pub use shared::{FULLSCREEN_WINDOW_LABEL, POPUP_WINDOW_LABEL, TOAST_WINDOW_LABEL};

#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(not(target_os = "macos"))]
use windows as platform;

#[command]
async fn show_window<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    no_activate: Option<bool>,
    pinned: Option<bool>,
) {
    platform::show_window_internal(
        &app_handle,
        &window,
        no_activate.unwrap_or(false),
        pinned.unwrap_or(false),
    );
}

#[command]
async fn hide_window<R: Runtime>(app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    platform::hide_window_internal(&app_handle, &window);
}

#[command]
async fn set_window_active_mode<R: Runtime>(window: WebviewWindow<R>, active: bool) {
    platform::set_window_active_mode_internal(&window, active);
}

pub use platform::{hide_window_internal, show_reminder_no_activate};

/// 初始化窗口管理插件
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("catrace-window")
        .invoke_handler(generate_handler![show_window, hide_window, set_window_active_mode])
        .build()
}
