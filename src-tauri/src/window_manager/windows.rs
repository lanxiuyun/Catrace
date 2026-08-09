use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Runtime, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos,
    ShowWindow, GWL_EXSTYLE, HTTRANSPARENT, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE, WM_NCHITTEST, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOPMOST, WS_EX_TRANSPARENT, SWP_NOACTIVATE, SWP_SHOWWINDOW,
};

use super::shared::{is_reminder_window, shared_hide_window, shared_show_window};

fn window_hwnd(window: &WebviewWindow<tauri::Wry>) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0 as *mut _))
}

/// 穿透态是否生效（true=整窗点击穿透）。由 `set_ignore_cursor_events_raw` 更新，
/// WM_NCHITTEST subclass 据此返回 HTTRANSPARENT。
static TOAST_PASSTHROUGH: AtomicBool = AtomicBool::new(true);

/// 已安装 subclass 的 HWND 值（防止窗口重建后旧的 subclass 失效）。
static TOAST_HITTEST_SUBCLASSED: AtomicBool = AtomicBool::new(false);

const TOAST_HITTEST_SUBCLASS_ID: usize = 0xC4A7_6E57;

/// WM_NCHITTEST subclass：穿透态下整个窗口返回 HTTRANSPARENT（-1），
/// 点击直接落到窗口下方，绕过 tao/winit 自带的 hit-test 处理。
/// 这是把 WebView2 全屏覆盖窗点击穿透的关键：单靠 WS_EX_TRANSPARENT
/// 会被 tao/winit 拦截（它自己处理 WM_NCHITTEST 而不走 DefWindowProc）。
unsafe extern "system" fn toast_hit_test_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if msg == WM_NCHITTEST && TOAST_PASSTHROUGH.load(Ordering::SeqCst) {
        return LRESULT(HTTRANSPARENT as isize);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// 安装 WM_NCHITTEST subclass（每个 HWND 仅一次）。窗口 HWND 固定后安装，
/// 之后所有消息都先经过我们的 proc。
fn ensure_hit_test_subclass(window: &WebviewWindow<tauri::Wry>) {
    let Some(hwnd) = window_hwnd(window) else {
        return;
    };
    if TOAST_HITTEST_SUBCLASSED.load(Ordering::SeqCst) {
        return;
    }
    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(toast_hit_test_proc),
            TOAST_HITTEST_SUBCLASS_ID,
            0,
        );
    }
    TOAST_HITTEST_SUBCLASSED.store(true, Ordering::SeqCst);
    crate::log_info!(
        "toast-hit",
        "installed WM_NCHITTEST subclass hwnd=0x{:x}",
        hwnd.0 as usize
    );
}

fn cast_to_wry<R: Runtime>(window: &WebviewWindow<R>) -> &WebviewWindow<tauri::Wry> {
    unsafe { &*(window as *const WebviewWindow<R> as *const WebviewWindow<tauri::Wry>) }
}

/// 直接切换窗口的 `WS_EX_TRANSPARENT`（点击穿透），并强制保留 `WS_EX_LAYERED`。
/// 只动这两个扩展样式，保留 `WS_EX_TOPMOST` / `WS_EX_NOACTIVATE` 不变。
///
/// 不能走 tao 的 `set_ignore_cursor_events`：那会触发 `apply_diff` 重建
/// `GWL_EXSTYLE` 并检查 VISIBLE 标志。本窗口是通过原生 `ShowWindow(SW_SHOWNOACTIVATE)`
/// 显示的，tao 内部的 VISIBLE 标志并未同步，`apply_diff` 会把窗口 `SW_HIDE`
/// （= 一移到卡片上窗口就消失），并丢掉 `WS_EX_LAYERED` 破坏透明。
pub fn set_ignore_cursor_events_raw(window: &WebviewWindow<tauri::Wry>, ignore: bool) {
    ensure_hit_test_subclass(window);
    TOAST_PASSTHROUGH.store(ignore, Ordering::SeqCst);
    let Some(hwnd) = window_hwnd(window) else {
        return;
    };
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // 透明窗口必须常驻 WS_EX_LAYERED（WebView2 的 per-pixel alpha 渲染与
        // 命中测试依赖它）。tao 的 apply_diff 重建样式时可能丢掉它，这里强制补回。
        let mut new_style = style | WS_EX_LAYERED.0 as isize;
        new_style = if ignore {
            new_style | WS_EX_TRANSPARENT.0 as isize
        } else {
            new_style & !(WS_EX_TRANSPARENT.0 as isize)
        };
        crate::log_info!(
            "toast-hit",
            "raw style hwnd=0x{:x} ignore={} before=0x{:x} after=0x{:x} transparent={} layered={} topmost={} noactivate={}",
            hwnd.0 as usize,
            ignore,
            style,
            new_style,
            (style & WS_EX_TRANSPARENT.0 as isize) != 0,
            (style & WS_EX_LAYERED.0 as isize) != 0,
            (style & WS_EX_TOPMOST.0 as isize) != 0,
            (style & WS_EX_NOACTIVATE.0 as isize) != 0,
        );
        if new_style != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND(std::ptr::null_mut())),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
            let applied = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            crate::log_info!(
                "toast-hit",
                "raw applied hwnd=0x{:x} now=0x{:x} transparent_after={}",
                hwnd.0 as usize,
                applied,
                (applied & WS_EX_TRANSPARENT.0 as isize) != 0,
            );
        }
    }
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
    crate::log_info!("toast-hide", "hide_window_internal label={}", window.label());
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
