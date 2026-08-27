use tauri::{command, plugin::Builder, plugin::TauriPlugin, Runtime, WebviewWindow};

mod shared;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(target_os = "windows"))]
mod macos;

pub use shared::{FULLSCREEN_WINDOW_LABEL, POPUP_WINDOW_LABEL, TOAST_WINDOW_LABEL};

#[cfg(target_os = "windows")]
use windows as platform;
#[cfg(not(target_os = "windows"))]
use macos as platform;

#[command]
pub async fn set_window_active_mode<R: Runtime>(window: WebviewWindow<R>, active: bool) {
    platform::set_window_active_mode_internal(&window, active);
}

pub use platform::{
    hide_window_internal, set_window_active_mode_internal, set_window_rect_physical,
    show_reminder_no_activate,
};

/// 初始化窗口管理插件
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("catrace-window").build()
}
