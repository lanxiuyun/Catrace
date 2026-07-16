use tauri::{AppHandle, Runtime, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos,
    ShowWindow, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW,
};

use super::shared::{is_reminder_window, shared_hide_window, shared_show_window};

fn window_hwnd(window: &WebviewWindow<tauri::Wry>) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0 as *mut _))
}

fn cast_to_wry<R: Runtime>(window: &WebviewWindow<R>) -> &WebviewWindow<tauri::Wry> {
    unsafe { &*(window as *const WebviewWindow<R> as *const WebviewWindow<tauri::Wry>) }
}

/// 设置窗口为无焦点样式（WS_EX_NOACTIVATE）并置顶
/// 注意带 SWP_NOZORDER，避免 HWND_TOPMOST 生效引起全屏独占模式游戏被切出全屏。
/// 窗口已在 Tauri builder 设 always_on_top(true) 带有 WS_EX_TOPMOST，始终在 topmost 层。
fn apply_no_activate_style(hwnd: HWND) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = style | WS_EX_NOACTIVATE.0 as isize;
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND(std::ptr::null_mut())),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        );
    }
}

/// 恢复窗口为普通可激活样式
fn restore_normal_style(hwnd: HWND) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = style & !(WS_EX_NOACTIVATE.0 as isize);
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND(std::ptr::null_mut())),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

/// 使用原生 Win32 无焦点显示窗口（不触发 Z 序变更）。
/// 窗口已在 Tauri builder 设 always_on_top(true) 带有 WS_EX_TOPMOST，
/// 不需要额外 SetWindowPos(HWND_TOPMOST) —— 那会推高 Z 序并导致全屏独占模式游戏被切出全屏。
fn show_no_activate(window: &WebviewWindow<tauri::Wry>) {
    if let Some(hwnd) = window_hwnd(window) {
        unsafe {
            apply_no_activate_style(hwnd);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }
    let _ = window.unminimize();
}

/// 内部实现：显示窗口
pub fn show_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
    no_activate: bool,
    _pinned: bool,
) {
    if !is_reminder_window(window) {
        shared_show_window(window);
        return;
    }

    let wry_window = cast_to_wry(window);
    if no_activate {
        show_no_activate(wry_window);
    } else {
        if let Some(hwnd) = window_hwnd(wry_window) {
            restore_normal_style(hwnd);
        }
        shared_show_window(window);
    }
}

/// 内部实现：隐藏窗口
pub fn hide_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    if is_reminder_window(window) {
        shared_hide_window(window);
        let wry_window = cast_to_wry(window);
        if let Some(hwnd) = window_hwnd(wry_window) {
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    } else {
        shared_hide_window(window);
    }
}

/// 内部实现：动态切换窗口激活模式
pub fn set_window_active_mode_internal<R: Runtime>(window: &WebviewWindow<R>, active: bool) {
    if !is_reminder_window(window) {
        return;
    }
    let wry_window = cast_to_wry(window);
    if let Some(hwnd) = window_hwnd(wry_window) {
        if active {
            restore_normal_style(hwnd);
            unsafe {
                let _ = SetForegroundWindow(hwnd);
            }
            let _ = window.set_focus();
        } else {
            apply_no_activate_style(hwnd);
        }
    }
}

/// 内部便捷函数：无焦点显示提醒窗口
pub fn show_reminder_no_activate(app_handle: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let app_handle = app_handle.clone();
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        show_window_internal(&app_handle, &window, true, false);
    });
}
