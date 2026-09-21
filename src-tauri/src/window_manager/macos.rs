use tauri::{AppHandle, Runtime, WebviewWindow};

use super::shared::{is_reminder_window, shared_hide_window, shared_show_window};

/// 内部实现：显示窗口。Toast/Popup 用 orderFrontRegardless，不 makeKey，避免激活 Catrace。
pub fn show_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
    no_activate: bool,
    _pinned: bool,
) {
    if is_reminder_window(window) && no_activate {
        macos_order_without_activating(window, true);
        return;
    }
    shared_show_window(window);
}

/// 内部实现：隐藏窗口。Toast/Popup 用 orderOut，不把主窗 makeKey。
pub fn hide_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    if is_reminder_window(window) {
        macos_order_without_activating(window, false);
        return;
    }
    shared_hide_window(window);
}

/// 内部实现：动态切换窗口激活模式（macOS Toast 始终不激活 App）
pub fn set_window_active_mode_internal<R: Runtime>(_window: &WebviewWindow<R>, _active: bool) {}

/// Windows 上用于锁屏后补回 TOPMOST；其它平台无需处理。
pub fn ensure_reminder_topmost<R: Runtime>(_window: &WebviewWindow<R>) {}

/// 内部便捷函数：显示提醒窗口且不激活 Catrace
pub fn show_reminder_no_activate(app_handle: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let app_handle = app_handle.clone();
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        show_window_internal(&app_handle, &window, true, false);
    });
}

/// Windows「文本大小」无对应项时按 1.0。
pub fn os_text_scale_factor() -> f64 {
    1.0
}

/// 非 Windows：仍走 Tauri PhysicalSize/PhysicalPosition。
pub fn set_window_rect_physical(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_order_without_activating<R: Runtime>(window: &WebviewWindow<R>, front: bool) {
    let window = window.clone();
    let _ = window.run_on_main_thread(move || {
        use objc::{msg_send, runtime::Object, sel, sel_impl};

        let Ok(ns_window) = window.ns_window() else {
            if front {
                shared_show_window(&window);
            } else {
                shared_hide_window(&window);
            }
            return;
        };
        let ns_window = ns_window as *mut Object;
        if ns_window.is_null() {
            if front {
                shared_show_window(&window);
            } else {
                shared_hide_window(&window);
            }
            return;
        }
        unsafe {
            if front {
                let _: () = msg_send![ns_window, orderFrontRegardless];
            } else {
                let nil: *mut Object = std::ptr::null_mut();
                let _: () = msg_send![ns_window, orderOut: nil];
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn macos_order_without_activating<R: Runtime>(window: &WebviewWindow<R>, front: bool) {
    if front {
        let _ = window.show();
    } else {
        shared_hide_window(window);
    }
}
