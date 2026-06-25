use tauri::{AppHandle, Runtime, WebviewWindow};

use super::shared::{is_reminder_window, shared_hide_window, shared_show_window};

/// 内部实现：显示窗口（macOS 暂回退到普通显示，后续可接入 NSPanel）
pub fn show_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
    _no_activate: bool,
    _pinned: bool,
) {
    shared_show_window(window);
}

/// 内部实现：隐藏窗口
pub fn hide_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    shared_hide_window(window);
}

/// 内部实现：动态切换窗口激活模式（macOS 暂为空实现）
pub fn set_window_active_mode_internal<R: Runtime>(_window: &WebviewWindow<R>, _active: bool) {}

/// 内部便捷函数：显示提醒窗口
pub fn show_reminder_no_activate(_app_handle: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        shared_show_window(&window);
    });
}
