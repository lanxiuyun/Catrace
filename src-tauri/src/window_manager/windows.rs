use tauri::{AppHandle, Runtime, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowRect, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos,
    ShowWindow, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOOWNERZORDER,
    SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW,
};

use crate::{log_info, log_warn};
use super::shared::{is_reminder_window, shared_hide_window, shared_show_window};

fn window_hwnd(window: &WebviewWindow<tauri::Wry>) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0 as *mut _))
}

fn apply_window_rect(hwnd: HWND, x: i32, y: i32, width: i32, height: i32) -> bool {
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND(std::ptr::null_mut())),
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE,
        )
        .is_ok()
    }
}

fn window_outer_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
    Some(rect)
}

fn rect_matches(rect: RECT, x: i32, y: i32, width: i32, height: i32) -> bool {
    rect.left == x
        && rect.top == y
        && rect.right - rect.left == width
        && rect.bottom - rect.top == height
}

/// 一次写入物理像素位置+尺寸，绕过 tao `set_size`/`set_position` 的分步 DPI 换算。
///
/// 切屏时 `SetWindowPos` 会同步触发 `WM_DPICHANGED`：tao 为了保持逻辑尺寸会再改一次
/// 物理大小，把刚铺好的工作区盖掉。所以同一组坐标要设两次——第二次时 DPI 已是目标屏，
/// tao 不再重算。
pub fn set_window_rect_physical(
    window: &WebviewWindow<tauri::Wry>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let Some(hwnd) = window_hwnd(window) else {
        return Err("set_window_rect_physical: no hwnd".to_string());
    };
    let w = width as i32;
    let h = height as i32;
    // 底边锚点：增高先上移再拉高，缩短先压高度再下移。
    // 一次 SetWindowPos 在 WebView2 里仍可能先改高后改 y，卡片会闪到任务栏里。
    if let Some(rect) = window_outer_rect(hwnd) {
        if rect_matches(rect, x, y, w, h) {
            return Ok(());
        }
        let old_w = rect.right - rect.left;
        let old_h = rect.bottom - rect.top;
        if h > old_h {
            if y < rect.top || x != rect.left {
                let _ = apply_window_rect(hwnd, x, y, old_w, old_h);
            }
        } else if h < old_h {
            let _ = apply_window_rect(hwnd, rect.left, rect.top, w, h);
        }
    }
    if !apply_window_rect(hwnd, x, y, w, h) {
        return Err("SetWindowPos failed".to_string());
    }
    if let Some(rect) = window_outer_rect(hwnd) {
        if rect_matches(rect, x, y, w, h) {
            return Ok(());
        }
        log_info!(
            "toast-win",
            "set_window_rect_physical: DPI rescale detected, reapplying target=({},{},{}x{}) actual=({},{},{}x{})",
            x,
            y,
            w,
            h,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top
        );
    }
    if !apply_window_rect(hwnd, x, y, w, h) {
        return Err("SetWindowPos retry failed".to_string());
    }
    if let Some(rect) = window_outer_rect(hwnd) {
        if !rect_matches(rect, x, y, w, h) {
            log_warn!(
                "toast-win",
                "set_window_rect_physical: still mismatched after retry target=({},{},{}x{}) actual=({},{},{}x{})",
                x,
                y,
                w,
                h,
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top
            );
        }
    }
    Ok(())
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
            let prev = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            log_info!(
                "toast-win",
                "ShowWindow(SW_SHOWNOACTIVATE) hwnd={:?} prev_visible={}",
                hwnd,
                prev.as_bool()
            );
        }
    } else {
        log_warn!("toast-win", "show_no_activate: no hwnd");
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
    let label = window.label().to_string();
    if !is_reminder_window(window) {
        shared_show_window(window);
        return;
    }

    log_info!("toast-win", "show_internal[{}] no_activate={}", label, no_activate);
    let wry_window = cast_to_wry(window);
    if no_activate {
        show_no_activate(wry_window);
    } else {
        if let Some(hwnd) = window_hwnd(wry_window) {
            restore_normal_style(hwnd);
        }
        shared_show_window(window);
    }
    let visible_now = window.is_visible().unwrap_or(false);
    log_info!(
        "toast-win",
        "show_internal[{}] end, tao is_visible={}",
        label,
        visible_now
    );
}

/// 内部实现：隐藏窗口
pub fn hide_window_internal<R: Runtime>(
    _app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    let label = window.label().to_string();
    if is_reminder_window(window) {
        log_info!("toast-win", "hide_internal[{}] start", label);
        shared_hide_window(window);
        let wry_window = cast_to_wry(window);
        if let Some(hwnd) = window_hwnd(wry_window) {
            unsafe {
                let prev = ShowWindow(hwnd, SW_HIDE);
                log_info!(
                    "toast-win",
                    "ShowWindow(SW_HIDE) hwnd={:?} prev_visible={}",
                    hwnd,
                    prev.as_bool()
                );
            }
        } else {
            log_warn!("toast-win", "hide_internal[{}] no hwnd", label);
        }
        let visible_now = window.is_visible().unwrap_or(false);
        log_info!(
            "toast-win",
            "hide_internal[{}] end, tao is_visible={}",
            label,
            visible_now
        );
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
            log_info!("toast-win", "active_mode[{}] -> focus", window.label());
            unsafe {
                let _ = SetForegroundWindow(hwnd);
            }
            let _ = window.set_focus();
        } else {
            log_info!("toast-win", "active_mode[{}] -> noactivate", window.label());
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
