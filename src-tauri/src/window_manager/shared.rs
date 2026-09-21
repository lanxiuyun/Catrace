use tauri::{Runtime, WebviewWindow};

/// Toast 通知窗口 label
pub const TOAST_WINDOW_LABEL: &str = "reminder-toast";
/// Popup 弹窗窗口 label
pub const POPUP_WINDOW_LABEL: &str = "reminder-popup";
/// 全屏提醒窗口 label 前缀（每块屏一扇：`reminder-fullscreen-0` …）
pub const FULLSCREEN_WINDOW_PREFIX: &str = "reminder-fullscreen-";
/// 全屏提醒数据在 store 中的固定键（与窗口 label 分离）
pub const FULLSCREEN_DATA_KEY: &str = "reminder-fullscreen";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FullscreenPlacement {
    pub label: String,
    pub x: i32,
    pub y: i32,
}

pub fn fullscreen_window_label(index: usize) -> String {
    format!("{FULLSCREEN_WINDOW_PREFIX}{index}")
}

pub fn is_fullscreen_window_label(label: &str) -> bool {
    label
        .strip_prefix(FULLSCREEN_WINDOW_PREFIX)
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
}

pub fn is_reminder_window_label(label: &str) -> bool {
    label == TOAST_WINDOW_LABEL
        || label == POPUP_WINDOW_LABEL
        || is_fullscreen_window_label(label)
}

/// 判断窗口是否属于需要无焦点管理的提醒窗口
pub fn is_reminder_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    is_reminder_window_label(window.label())
}

pub fn fullscreen_placements(origins: &[(i32, i32)]) -> Vec<FullscreenPlacement> {
    if origins.is_empty() {
        return vec![FullscreenPlacement {
            label: fullscreen_window_label(0),
            x: 0,
            y: 0,
        }];
    }
    origins
        .iter()
        .enumerate()
        .map(|(index, (x, y))| FullscreenPlacement {
            label: fullscreen_window_label(index),
            x: *x,
            y: *y,
        })
        .collect()
}

pub fn fullscreen_labels_among<'a>(labels: impl IntoIterator<Item = &'a str>) -> Vec<&'a str> {
    labels
        .into_iter()
        .filter(|label| is_fullscreen_window_label(label))
        .collect()
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

/// macOS AppKit：普通 `NSWindow.orderOut` / `makeKeyAndOrderFront` 会把同进程下一扇窗（主窗）拉到前台。
/// Toast / Popup 必须走不激活路径，关卡时用户应留在 Claude Code，而不是弹出 Catrace。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacosReminderWindowPolicy {
    #[allow(dead_code)]
    ActivateAppOnShowAndHide,
    OrderWithoutActivating,
}

pub const MACOS_REMINDER_WINDOW_POLICY: MacosReminderWindowPolicy =
    MacosReminderWindowPolicy::OrderWithoutActivating;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbered_fullscreen_labels_are_reminder_windows() {
        assert!(is_fullscreen_window_label("reminder-fullscreen-0"));
        assert!(is_fullscreen_window_label("reminder-fullscreen-1"));
        assert!(is_fullscreen_window_label("reminder-fullscreen-10"));
        assert!(is_reminder_window_label("reminder-fullscreen-0"));
    }

    #[test]
    fn other_labels_are_not_fullscreen_windows() {
        assert!(!is_fullscreen_window_label("reminder-fullscreen"));
        assert!(!is_fullscreen_window_label("reminder-fullscreen-"));
        assert!(!is_fullscreen_window_label("reminder-fullscreen-a"));
        assert!(!is_fullscreen_window_label("reminder-toast"));
        assert!(!is_fullscreen_window_label("main"));
        assert!(is_reminder_window_label(TOAST_WINDOW_LABEL));
        assert!(is_reminder_window_label(POPUP_WINDOW_LABEL));
    }

    #[test]
    fn placements_cover_every_monitor() {
        let placements = fullscreen_placements(&[(0, 0), (1920, 0)]);
        assert_eq!(
            placements,
            vec![
                FullscreenPlacement {
                    label: "reminder-fullscreen-0".into(),
                    x: 0,
                    y: 0,
                },
                FullscreenPlacement {
                    label: "reminder-fullscreen-1".into(),
                    x: 1920,
                    y: 0,
                },
            ]
        );
    }

    #[test]
    fn empty_monitors_still_get_one_placement() {
        assert_eq!(
            fullscreen_placements(&[]),
            vec![FullscreenPlacement {
                label: "reminder-fullscreen-0".into(),
                x: 0,
                y: 0,
            }]
        );
    }

    #[test]
    fn close_set_is_all_numbered_fullscreen_windows() {
        let labels = [
            "main",
            "reminder-toast",
            "reminder-fullscreen-0",
            "reminder-fullscreen-1",
        ];
        assert_eq!(
            fullscreen_labels_among(labels),
            vec!["reminder-fullscreen-0", "reminder-fullscreen-1"]
        );
    }

    #[test]
    fn macos_toast_must_not_activate_main_when_closed() {
        assert_eq!(
            MACOS_REMINDER_WINDOW_POLICY,
            MacosReminderWindowPolicy::OrderWithoutActivating,
            "closing the last agent toast on macOS must not makeKey Catrace main"
        );
    }
}
