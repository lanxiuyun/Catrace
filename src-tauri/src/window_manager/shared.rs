use tauri::{Runtime, WebviewWindow};

/// Toast 通知窗口 label
pub const TOAST_WINDOW_LABEL: &str = "reminder-toast";
/// Popup 弹窗窗口 label
pub const POPUP_WINDOW_LABEL: &str = "reminder-popup";
/// 全屏提醒窗口 label
pub const FULLSCREEN_WINDOW_LABEL: &str = "reminder-fullscreen";

/// 判断窗口是否属于需要无焦点管理的提醒窗口
pub fn is_reminder_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let label = window.label();
    label == TOAST_WINDOW_LABEL || label == POPUP_WINDOW_LABEL
}

/// 普通显示窗口并尝试聚焦（用于主窗口或需要夺焦的场景）
pub fn shared_show_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// 普通隐藏窗口
pub fn shared_hide_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
}
