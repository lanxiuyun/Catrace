use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Runtime, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUERY_USER_NOTIFICATION_STATE, QUNS_ACCEPTS_NOTIFICATIONS,
    QUNS_QUIET_TIME,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow,
    GWL_EXSTYLE, GW_HWNDPREV, GW_OWNER, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOACTIVATE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
    WS_EX_TOPMOST,
};

use crate::{log_debug, log_info, log_warn};
use super::shared::{is_reminder_window, shared_hide_window, shared_show_window};

/// 用户已通过点击卡片主动接管 Toast 焦点（set_window_active_mode(true)）时置位；
/// 前台巡检看到此标志必须停手，不能把用户刚点的焦点又抢回去。每次 show 时复位。
static TOAST_FOCUS_TAKEN_DELIBERATELY: AtomicBool = AtomicBool::new(false);

/// Windows 设置 → 辅助功能 → 文本大小。WebView2 会把页面视觉放大，但不改 CSS 布局；
/// Toast 小窗必须按这个系数放大 HWND，否则卡片底部会被裁切。
/// 注册表 `HKCU\Software\Microsoft\Accessibility\TextScaleFactor`，100–225。
pub fn os_text_scale_factor() -> f64 {
    use windows::core::w;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, REG_VALUE_TYPE, RRF_RT_REG_DWORD, RegGetValueW,
    };

    let mut data: u32 = 100;
    let mut size = std::mem::size_of::<u32>() as u32;
    let mut value_type = REG_VALUE_TYPE(0);
    let err = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Accessibility"),
            w!("TextScaleFactor"),
            RRF_RT_REG_DWORD,
            Some(&mut value_type),
            Some((&mut data as *mut u32).cast()),
            Some(&mut size),
        )
    };
    if err != ERROR_SUCCESS || data < 100 {
        return 1.0;
    }
    (data.min(225) as f64) / 100.0
}

fn window_hwnd(window: &WebviewWindow<tauri::Wry>) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0 as *mut _))
}

fn exstyle_bits(hwnd: HWND) -> isize {
    unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) }
}

fn has_exstyle(style: isize, bit: u32) -> bool {
    style & bit as isize != 0
}

fn can_raise_toast(state: Option<QUERY_USER_NOTIFICATION_STATE>) -> bool {
    // BUSY 也涵盖非 D3D 全屏应用；查询失败时保守处理，不能打断游戏。
    matches!(state, Some(QUNS_ACCEPTS_NOTIFICATIONS | QUNS_QUIET_TIME))
}

fn rects_overlap(a: RECT, b: RECT) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

fn overlapping_window_above(hwnd: HWND) -> Option<HWND> {
    let rect = window_outer_rect(hwnd)?;
    let mut cursor = hwnd;
    // 遍历期间其它进程可能销毁或重排窗口，限制步数避免循环。
    for _ in 0..1024 {
        let above = unsafe { GetWindow(cursor, GW_HWNDPREV) }.ok()?;
        if above.0.is_null() || above == hwnd {
            return None;
        }
        cursor = above;
        if !unsafe { IsWindowVisible(above) }.as_bool()
            || unsafe { IsIconic(above) }.as_bool()
            || unsafe { GetWindow(above, GW_OWNER) }.ok() == Some(hwnd)
        {
            continue;
        }
        let Some(other) = window_outer_rect(above) else {
            continue;
        };
        if !rects_overlap(rect, other) {
            continue;
        }
        let mut cloaked = 0u32;
        let _ = unsafe {
            DwmGetWindowAttribute(
                above,
                DWMWA_CLOAKED,
                (&mut cloaked as *mut u32).cast(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        if cloaked == 0 {
            return Some(above);
        }
    }
    None
}

/// 检查实际遮挡，而不只看 WS_EX_TOPMOST：置顶窗口之间也有 Z 序。
fn ensure_toast_z_order(hwnd: HWND, state: Option<QUERY_USER_NOTIFICATION_STATE>) -> bool {
    if !can_raise_toast(state)
        || !unsafe { IsWindowVisible(hwnd) }.as_bool()
        || unsafe { IsIconic(hwnd) }.as_bool()
    {
        return false;
    }
    let missing_style = !has_exstyle(exstyle_bits(hwnd), WS_EX_TOPMOST.0);
    let blocker = overlapping_window_above(hwnd);
    if !missing_style && blocker.is_none() {
        return false;
    }

    // 补回 TOPMOST 位后仍可能排在其它置顶窗下面；检查结果，最多再补一次。
    let mut ok = false;
    for _ in 0..2 {
        if unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
        .is_err()
        {
            break;
        }
        ok = has_exstyle(exstyle_bits(hwnd), WS_EX_TOPMOST.0)
            && overlapping_window_above(hwnd).is_none();
        if ok {
            break;
        }
    }
    log_info!(
        "toast-win",
        "ensure_z_order: hwnd={:?} missing_topmost={} blocker={:?} ok={}",
        hwnd,
        missing_style,
        blocker,
        ok
    );
    ok
}

fn ensure_topmost(hwnd: HWND) -> bool {
    ensure_toast_z_order(hwnd, unsafe { SHQueryUserNotificationState() }.ok())
}

/// 已可见的 Toast 也可能丢 TOPMOST，或被后来抬升的其它置顶窗遮挡。
pub fn ensure_reminder_topmost<R: Runtime>(window: &WebviewWindow<R>) {
    if !is_reminder_window(window) {
        return;
    }
    let wry_window = cast_to_wry(window);
    if let Some(hwnd) = window_hwnd(wry_window) {
        let _ = ensure_topmost(hwnd);
    }
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
        log_debug!(
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

/// 只设置 WS_EX_NOACTIVATE，不改变显示状态或 Z 序。
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
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
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

/// 使用原生 Win32 无焦点显示窗口。
/// 显示后按实际遮挡修复 Z 序；全屏/演示/锁屏时不抬升。
fn show_no_activate(window: &WebviewWindow<tauri::Wry>) {
    if let Some(hwnd) = window_hwnd(window) {
        unsafe {
            apply_no_activate_style(hwnd);
            let prev = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let style = exstyle_bits(hwnd);
            log_debug!(
                "toast-win",
                "ShowWindow(SW_SHOWNOACTIVATE) hwnd={:?} prev_visible={} ex=0x{:x} topmost={} noact={}",
                hwnd,
                prev.as_bool(),
                style,
                has_exstyle(style, WS_EX_TOPMOST.0),
                has_exstyle(style, WS_EX_NOACTIVATE.0)
            );
        }
        let _ = window.unminimize();
        let _ = ensure_topmost(hwnd);
    } else {
        log_warn!("toast-win", "show_no_activate: no hwnd");
        let _ = window.unminimize();
    }
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

    log_debug!("toast-win", "show_internal[{}] no_activate={}", label, no_activate);
    TOAST_FOCUS_TAKEN_DELIBERATELY.store(false, Ordering::SeqCst);
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
    log_debug!(
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
        log_debug!("toast-win", "hide_internal[{}] start", label);
        shared_hide_window(window);
        let wry_window = cast_to_wry(window);
        if let Some(hwnd) = window_hwnd(wry_window) {
            unsafe {
                let prev = ShowWindow(hwnd, SW_HIDE);
                log_debug!(
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
        log_debug!(
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
            TOAST_FOCUS_TAKEN_DELIBERATELY.store(true, Ordering::SeqCst);
            restore_normal_style(hwnd);
            log_debug!("toast-win", "active_mode[{}] -> focus", window.label());
            let ok = unsafe { force_foreground_window(hwnd) };
            log_debug!(
                "toast-win",
                "active_mode[{}] SetForegroundWindow ok={}",
                window.label(),
                ok
            );
            let _ = window.set_focus();
        } else {
            log_debug!("toast-win", "active_mode[{}] -> noactivate", window.label());
            apply_no_activate_style(hwnd);
        }
    }
}

/// 预激活：仅清除 WS_EX_NOACTIVATE，不请求前台。
/// 供前端在指针进入 Toast 内容时调用，让随后的首次点击能原生激活并落到输入控件；
/// 真正的焦点接管仍由 set_window_active_mode_internal(active=true) 在 pointerdown 执行。
pub fn prepare_window_activation_internal<R: Runtime>(window: &WebviewWindow<R>) {
    if !is_reminder_window(window) {
        return;
    }
    let wry_window = cast_to_wry(window);
    if let Some(hwnd) = window_hwnd(wry_window) {
        if !has_exstyle(exstyle_bits(hwnd), WS_EX_NOACTIVATE.0) {
            return;
        }
        log_debug!(
            "toast-win",
            "prepare_activation[{}] clear NOACTIVATE on pointer enter",
            window.label()
        );
        restore_normal_style(hwnd);
    }
}

/// 当前前台窗口的裸 HWND 值（0 = 无）。重建 Toast 前记录，供 restore_foreground_if_taken 归还。
pub fn current_foreground() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

/// 提醒窗口顶层 HWND 的裸值，供跨线程与 GetForegroundWindow 结果比较。
pub fn reminder_hwnd_id<R: Runtime>(window: &WebviewWindow<R>) -> isize {
    match window_hwnd(cast_to_wry(window)) {
        Some(h) => h.0 as isize,
        None => 0,
    }
}

/// WebView2 控制器在新建窗口里异步初始化完成时会把焦点切进自己的 child HWND，
/// 把 Toast 顶成前台；该抢夺发生在 build() 内部、早于 NOACTIVATE 样式应用——
/// 这是轻量模式每次按需重建弹窗都抢焦点、而复用路径从不抢的根因。
/// 仅当此刻前台仍是 Toast 本尊、且用户没有主动点卡接管时，把前台还给 prev；
/// 前台是别的窗口（没被抢 / 用户已切走 / 已归还）则不动，天然幂等。
pub fn restore_foreground_if_taken(toast: isize, prev: isize) {
    let taken = TOAST_FOCUS_TAKEN_DELIBERATELY.load(Ordering::SeqCst);
    let cur = unsafe { GetForegroundWindow() };
    // HWND(null) 转 isize 为 0，而 toast≠0 的分支在 should_restore_foreground 里挡掉
    if !should_restore_foreground(toast, prev, taken, cur.0 as isize) {
        return;
    }
    let ok = unsafe { force_foreground_window(HWND(prev as *mut _)) };
    log_debug!(
        "toast-win",
        "restore_foreground toast={:#x} -> prev={:#x} ok={}",
        toast,
        prev,
        ok
    );
}

/// 巡检是否应该归还前台（纯函数，便于单测）。
/// 三重守卫：参数有效（0 = 无效 HWND）、用户未点卡接管、前台仍是 Toast 本尊。
fn should_restore_foreground(
    toast: isize,
    prev: isize,
    taken_deliberately: bool,
    cur: isize,
) -> bool {
    if toast == 0 || prev == 0 {
        return false;
    }
    if taken_deliberately {
        return false;
    }
    cur == toast
}

/// 强制把窗口拉为前台。后台进程直接 SetForegroundWindow 会被 Windows 拒绝；
/// 先把当前线程输入附加到前台窗口线程，调用成功后再 detach。
unsafe fn force_foreground_window(hwnd: HWND) -> bool {
    let fg = GetForegroundWindow();
    let fg_thread = if fg.0.is_null() {
        0
    } else {
        GetWindowThreadProcessId(fg, None)
    };
    let cur_thread = GetCurrentThreadId();

    let attached = if fg_thread != 0 && fg_thread != cur_thread {
        AttachThreadInput(fg_thread, cur_thread, true).as_bool()
    } else {
        false
    };

    let ok = SetForegroundWindow(hwnd).as_bool();
    if ok {
        let _ = SetActiveWindow(hwnd);
        let _ = SetFocus(Some(hwnd));
    }

    if attached {
        let _ = AttachThreadInput(fg_thread, cur_thread, false);
    }
    ok
}

/// 内部便捷函数：无焦点显示提醒窗口
pub fn show_reminder_no_activate(app_handle: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let app_handle = app_handle.clone();
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        show_window_internal(&app_handle, &window, true, false);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::w;
    use windows::Win32::UI::Shell::{
        QUNS_APP, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, HWND_NOTOPMOST, WS_EX_TOOLWINDOW, WS_POPUP,
    };

    struct NativeTestWindow(HWND);

    impl NativeTestWindow {
        fn new() -> Self {
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                    w!("STATIC"),
                    w!("Catrace Z-order regression"),
                    WS_POPUP,
                    -30000,
                    -30000,
                    16,
                    16,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("create native test window");
            Self(hwnd)
        }

        fn show(&self) {
            unsafe {
                let _ = ShowWindow(self.0, SW_SHOWNOACTIVATE);
            }
        }

        fn hide(&self) {
            unsafe {
                let _ = ShowWindow(self.0, SW_HIDE);
            }
        }

        fn cover(&self) {
            self.show();
            unsafe {
                SetWindowPos(
                    self.0,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                )
                .unwrap();
            }
        }

        fn is_above(&self, other: &Self) -> bool {
            let mut cursor = other.0;
            while let Ok(previous) = unsafe { GetWindow(cursor, GW_HWNDPREV) } {
                if previous.0.is_null() {
                    break;
                }
                if previous == self.0 {
                    return true;
                }
                cursor = previous;
            }
            false
        }
    }

    impl Drop for NativeTestWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }

    #[test]
    #[ignore = "requires an interactive Windows desktop; run with --ignored --test-threads=1"]
    fn native_toast_z_order_recovers_after_reuse_and_visible_cover() {
        crate::log::init(&std::env::temp_dir().join("catrace-z-order-tests"));
        let toast = NativeTestWindow::new();
        let cover = NativeTestWindow::new();
        let foreground = current_foreground();
        let desktop = Some(QUNS_ACCEPTS_NOTIFICATIONS);
        cover.cover();
        toast.show();
        assert!(ensure_toast_z_order(toast.0, desktop));
        assert!(toast.is_above(&cover));

        for _ in 0..20 {
            toast.hide();
            cover.cover();
            apply_no_activate_style(toast.0);
            assert!(
                !unsafe { IsWindowVisible(toast.0) }.as_bool(),
                "style changes must not show a hidden Toast"
            );
            toast.show();
            assert!(ensure_toast_z_order(toast.0, desktop));
            assert!(
                toast.is_above(&cover),
                "reused Toast is still covered despite WS_EX_TOPMOST"
            );
            assert_eq!(current_foreground(), foreground, "show must not steal focus");

            cover.cover();
            assert!(cover.is_above(&toast));
            assert!(ensure_toast_z_order(toast.0, desktop));
            assert!(
                toast.is_above(&cover),
                "already-visible Toast is still covered"
            );
            assert_eq!(current_foreground(), foreground, "repair must not steal focus");
            assert!(
                !ensure_toast_z_order(toast.0, desktop),
                "unobscured Toast must not be raised again"
            );
        }

        for state in [
            None,
            Some(QUNS_BUSY),
            Some(QUNS_RUNNING_D3D_FULL_SCREEN),
            Some(QUNS_PRESENTATION_MODE),
            Some(QUNS_NOT_PRESENT),
            Some(QUNS_APP),
        ] {
            cover.cover();
            assert!(!ensure_toast_z_order(toast.0, state));
            assert!(
                cover.is_above(&toast),
                "protected state must preserve Z order"
            );
        }
        assert!(
            ensure_toast_z_order(toast.0, desktop),
            "leaving fullscreen must allow recovery"
        );

        unsafe {
            SetWindowPos(
                toast.0,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .unwrap();
        }
        assert!(!has_exstyle(exstyle_bits(toast.0), WS_EX_TOPMOST.0));
        assert!(ensure_toast_z_order(toast.0, desktop));
        assert!(has_exstyle(exstyle_bits(toast.0), WS_EX_TOPMOST.0));
        assert!(toast.is_above(&cover));
        assert_eq!(current_foreground(), foreground);

        cover.cover();
        cover.hide();
        assert!(
            !ensure_toast_z_order(toast.0, desktop),
            "hidden windows do not obscure Toast"
        );
        cover.cover();
        assert!(apply_window_rect(cover.0, -29000, -29000, 16, 16));
        assert!(
            !ensure_toast_z_order(toast.0, desktop),
            "non-overlapping topmost windows must be left alone"
        );
        toast.hide();
        assert!(!ensure_toast_z_order(toast.0, desktop));
        assert!(
            !unsafe { IsWindowVisible(toast.0) }.as_bool(),
            "patrol must not reopen a hidden Toast"
        );
    }

    #[test]
    fn invalid_hwnd_never_restores() {
        // 0 = 无效 HWND（macOS stub / 取 hwnd 失败），任何情况下都不能动前台
        assert!(!should_restore_foreground(0, 0x1234, false, 0x1234));
        assert!(!should_restore_foreground(0x5678, 0, false, 0x5678));
        assert!(!should_restore_foreground(0, 0, false, 0));
    }

    #[test]
    fn foreground_mismatch_never_restores() {
        // 前台是别的窗口：没被抢 / 用户已切走 / 已归还，一律不动（幂等的关键）
        assert!(!should_restore_foreground(0x100, 0x200, false, 0x300));
        // 前台为空（无前台窗口）同样不动
        assert!(!should_restore_foreground(0x100, 0x200, false, 0));
    }

    #[test]
    fn foreground_still_toast_and_not_taken_restores() {
        // 前台仍是 Toast 本尊且用户未接管 → 归还给 prev
        assert!(should_restore_foreground(0x100, 0x200, false, 0x100));
    }

    #[test]
    fn deliberate_take_stops_patrol() {
        // 用户点卡接管后，即使前台还是 Toast 也不能把用户刚点的焦点抢回去
        assert!(!should_restore_foreground(0x100, 0x200, true, 0x100));
    }

    #[test]
    fn only_desktop_notification_states_allow_raising() {
        assert!(can_raise_toast(Some(QUNS_ACCEPTS_NOTIFICATIONS)));
        assert!(can_raise_toast(Some(QUNS_QUIET_TIME)));
        assert!(!can_raise_toast(None));
        for state in [1, 2, 3, 4, 7, 99] {
            assert!(!can_raise_toast(Some(QUERY_USER_NOTIFICATION_STATE(state))));
        }
    }

    #[test]
    fn overlap_requires_shared_area_not_just_touching_edges() {
        let rect = RECT {
            left: -100,
            top: 0,
            right: 0,
            bottom: 100,
        };
        assert!(rects_overlap(rect, rect));
        assert!(rects_overlap(
            rect,
            RECT { left: -50, top: 50, right: 50, bottom: 150 }
        ));
        assert!(!rects_overlap(
            rect,
            RECT { left: 0, top: 0, right: 100, bottom: 100 }
        ));
        assert!(!rects_overlap(
            rect,
            RECT { left: -100, top: 100, right: 0, bottom: 200 }
        ));
    }
}
