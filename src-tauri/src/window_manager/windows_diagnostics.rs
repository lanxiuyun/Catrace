//! Read-only diagnostics. Never change window styles, visibility, focus or Z order here.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Manager;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, GW_HWNDPREV, GW_OWNER, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
};

use super::{exstyle_bits, has_exstyle, window_outer_rect};

const PREFIX: &str = "[DEBUG-toast-zorder]";

fn rect_value(rect: Option<RECT>) -> Value {
    rect.map(|r| json!([r.left, r.top, r.right, r.bottom]))
        .unwrap_or(Value::Null)
}

fn overlaps(a: RECT, b: RECT) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

fn window_state(hwnd: HWND) -> Value {
    if hwnd.0.is_null() {
        return Value::Null;
    }
    let mut pid = 0;
    let tid = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let style = exstyle_bits(hwnd);
    let mut class = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, &mut class) }.max(0) as usize;
    let mut cloaked = 0u32;
    let cloak_result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    json!({
        "hwnd": format!("{:#x}", hwnd.0 as usize),
        "valid": unsafe { IsWindow(Some(hwnd)) }.as_bool(),
        "pid": pid, "tid": tid,
        "class": String::from_utf16_lossy(&class[..len]),
        "visible": unsafe { IsWindowVisible(hwnd) }.as_bool(),
        "minimized": unsafe { IsIconic(hwnd) }.as_bool(),
        "exstyle": format!("{style:#x}"),
        "topmost": has_exstyle(style, WS_EX_TOPMOST.0),
        "noactivate": has_exstyle(style, WS_EX_NOACTIVATE.0),
        "owner": unsafe { GetWindow(hwnd, GW_OWNER) }.ok().map(|h| format!("{:#x}", h.0 as usize)),
        "rect": rect_value(window_outer_rect(hwnd)),
        "cloaked": if cloak_result.is_ok() { Some(cloaked) } else { None },
    })
}

fn snapshot(hwnd: HWND) -> Value {
    let toast = window_state(hwnd);
    let mut above = Vec::new();
    let mut scanned = 0;
    let mut complete = true;
    if toast["visible"] == true {
        if let Some(rect) = window_outer_rect(hwnd) {
            let mut cursor = hwnd;
            for _ in 0..256 {
                let previous = match unsafe { GetWindow(cursor, GW_HWNDPREV) } {
                    Ok(h) if !h.0.is_null() && h != hwnd => h,
                    Ok(_) => break,
                    Err(_) => {
                        complete = false;
                        break;
                    }
                };
                cursor = previous;
                scanned += 1;
                if !unsafe { IsWindowVisible(previous) }.as_bool()
                    || unsafe { IsIconic(previous) }.as_bool()
                {
                    continue;
                }
                if window_outer_rect(previous).is_some_and(|r| overlaps(rect, r)) {
                    let state = window_state(previous);
                    if state["cloaked"] != 0 && !state["cloaked"].is_null() {
                        continue;
                    }
                    above.push(state);
                    if above.len() == 3 {
                        complete = false;
                        break;
                    }
                }
            }
            if scanned == 256 {
                complete = false;
            }
        } else {
            complete = false;
        }
    }
    json!({
        "toast": toast,
        "foreground": window_state(unsafe { GetForegroundWindow() }),
        // Bounding rectangles are candidates, not proof of opaque pixel occlusion.
        "overlapping_above": above,
        "scan_complete": complete,
    })
}

fn abnormal(state: &Value) -> bool {
    state["toast"]["visible"] == true
        && (state["toast"]["topmost"] == false
            || state["toast"]["minimized"] == true
            || state["overlapping_above"]
                .as_array()
                .is_some_and(|a| !a.is_empty()))
}

fn emit(stage: &str, state: &Value) {
    if abnormal(state) {
        crate::log_warn!("toast-win", "{} stage={} state={}", PREFIX, stage, state);
    } else {
        crate::log_info!("toast-win", "{} stage={} state={}", PREFIX, stage, state);
    }
}

pub(super) fn record(hwnd: HWND, stage: &str) {
    emit(stage, &snapshot(hwnd));
}

pub(super) fn start(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    let key = hwnd.0 as isize;
    let label = window.label().to_string();
    let app = window.app_handle().clone();
    let destroyed = Arc::new(AtomicBool::new(false));
    let event_destroyed = destroyed.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            event_destroyed.store(true, Ordering::SeqCst);
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut last = Value::Null;
        loop {
            if destroyed.load(Ordering::SeqCst) {
                break;
            }
            let Some(window) = app.get_webview_window(&label) else {
                break;
            };
            if window.hwnd().ok().map(|h| h.0 as isize) != Some(key) {
                break;
            }
            let hwnd = HWND(key as *mut _);
            let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
            // Hidden windows only need one transition snapshot, not desktop scans.
            if visible || last["toast"]["visible"] != false {
                let mut state = snapshot(hwnd);
                state["tauri_visible"] = json!(window.is_visible().ok());
                if state != last {
                    emit("sample-change", &state);
                    last = state;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        crate::log_info!("toast-win", "{} stage=monitor-stop hwnd={:#x}", PREFIX, key);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires an interactive Windows desktop"]
    fn native_snapshot_identifies_normal_window_above_without_changing_state() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE,
            SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_POPUP,
        };
        struct TestWindow(HWND);
        impl TestWindow {
            fn new() -> Self {
                Self(
                    unsafe {
                        CreateWindowExW(
                            WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                            w!("STATIC"),
                            w!("Catrace diagnostics test"),
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
                    .expect("create offscreen fixture"),
                )
            }
        }
        impl Drop for TestWindow {
            fn drop(&mut self) {
                let _ = unsafe { DestroyWindow(self.0) };
            }
        }
        let toast = TestWindow::new();
        let browser = TestWindow::new();
        unsafe {
            let _ = ShowWindow(toast.0, SW_SHOWNOACTIVATE);
            let _ = ShowWindow(browser.0, SW_SHOWNOACTIVATE);
            SetWindowPos(
                browser.0,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .unwrap();
        }
        let foreground = unsafe { GetForegroundWindow() };
        let style = exstyle_bits(toast.0);
        let previous = unsafe { GetWindow(toast.0, GW_HWNDPREV) }.ok();
        let rect = rect_value(window_outer_rect(toast.0));
        let log_root =
            std::env::temp_dir().join(format!("catrace-toast-diagnostics-{}", std::process::id()));
        crate::log::init(&log_root);
        record(toast.0, "native-test");
        let log = log_root.join("logs").join(format!(
            "catrace-{}.log",
            chrono::Local::now().format("%Y-%m-%d")
        ));
        let written =
            std::fs::read_to_string(log).expect("diagnostics must be written at default log level");
        assert!(written.contains("[DEBUG-toast-zorder] stage=native-test"));
        assert!(written.contains("\"topmost\":false"));
        for _ in 0..10 {
            let state = snapshot(toast.0);
            let blocker = state["overlapping_above"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["hwnd"] == format!("{:#x}", browser.0 .0 as usize))
                .expect("ordinary overlapping window must be recorded");
            assert_eq!(blocker["topmost"], false);
            assert_eq!(state["toast"]["topmost"], false);
            assert!(abnormal(&state));
            assert_eq!(unsafe { GetForegroundWindow() }, foreground);
            assert_eq!(exstyle_bits(toast.0), style);
            assert_eq!(unsafe { GetWindow(toast.0, GW_HWNDPREV) }.ok(), previous);
            assert_eq!(rect_value(window_outer_rect(toast.0)), rect);
            assert!(unsafe { IsWindowVisible(toast.0) }.as_bool());
        }
    }

    #[test]
    fn touching_rectangles_are_not_overlap_candidates() {
        let rect = RECT {
            left: -100,
            top: 0,
            right: 0,
            bottom: 100,
        };
        assert!(overlaps(rect, rect));
        assert!(!overlaps(
            rect,
            RECT {
                left: 0,
                top: 0,
                right: 50,
                bottom: 50
            }
        ));
    }

    #[test]
    fn missing_topmost_and_normal_window_above_are_both_reported() {
        assert!(abnormal(
            &json!({"toast": {"visible": true, "topmost": false}})
        ));
        assert!(abnormal(&json!({
            "toast": {"visible": true, "topmost": true},
            "overlapping_above": [{"topmost": false}]
        })));
        assert!(!abnormal(&json!({
            "toast": {"visible": false, "topmost": false},
            "overlapping_above": []
        })));
    }
}
