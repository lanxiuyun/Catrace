use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::read_unaligned;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Once;
use ::windows::core::{w, GUID, PCWSTR, PWSTR};
use ::windows::Win32::Foundation::{HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
use ::windows::Win32::System::Power::{
    RegisterPowerSettingNotification, UnregisterPowerSettingNotification, HPOWERNOTIFY,
};
use ::windows::Win32::System::RemoteDesktop::{
    WTSFreeMemory, WTSQuerySessionInformationW, WTSINFOEXW, WTSSessionInfoEx, WTS_CURRENT_SERVER_HANDLE,
    WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK, WTS_SESSIONSTATE_UNLOCK,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, DEVICE_NOTIFY_WINDOW_HANDLE, HWND_MESSAGE, MSG, PBT_POWERSETTINGCHANGE,
    WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST, WNDCLASSW,
};

const WINDOW_CLASS: PCWSTR = w!("CatraceScreenActivity");

const CONSOLE_DISPLAY_STATE: GUID = GUID::from_u128(0x6fe69556_704a_47a0_8f24_c28d936fda47);

const STATE_UNKNOWN: u8 = 0;
const STATE_OFF: u8 = 1;
const STATE_ON: u8 = 2;

static DISPLAY_STATE: AtomicU8 = AtomicU8::new(STATE_ON);
static WINDOW_CLASS_REGISTERED: AtomicBool = AtomicBool::new(false);
static REGISTER_WINDOW_CLASS: Once = Once::new();
static START_LISTENER: Once = Once::new();

#[repr(C)]
struct PowerBroadcastSetting {
    power_setting: GUID,
    data_length: u32,
    data: [u8; 1],
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_POWERBROADCAST
        && wparam.0 as u32 == PBT_POWERSETTINGCHANGE
        && lparam.0 != 0
    {
        let setting = &*(lparam.0 as *const PowerBroadcastSetting);
        if setting.power_setting == CONSOLE_DISPLAY_STATE && setting.data_length >= 4 {
            let value = read_unaligned(setting.data.as_ptr() as *const u32);
            DISPLAY_STATE.store(
                if value == 0 { STATE_OFF } else { STATE_ON },
                Ordering::Relaxed,
            );
        }
        return LRESULT(1);
    }
    DefWindowProcW(window, message, wparam, lparam)
}

unsafe fn create_window() -> Option<HWND> {
    REGISTER_WINDOW_CLASS.call_once(|| {
        let Ok(instance) = GetModuleHandleW(None) else {
            return;
        };
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: HINSTANCE(instance.0),
            lpszClassName: WINDOW_CLASS,
            ..Default::default()
        };
        WINDOW_CLASS_REGISTERED.store(RegisterClassW(&class) != 0, Ordering::Relaxed);
    });
    if !WINDOW_CLASS_REGISTERED.load(Ordering::Relaxed) {
        return None;
    }
    let instance = GetModuleHandleW(None).ok()?;
    CreateWindowExW(
        WINDOW_EX_STYLE(0),
        WINDOW_CLASS,
        w!("Catrace screen activity"),
        WINDOW_STYLE(0),
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        None,
        Some(HINSTANCE(instance.0)),
        None,
    )
    .ok()
}

fn session_locked() -> Option<bool> {
    unsafe {
        let mut buffer = PWSTR::null();
        let mut bytes = 0u32;
        WTSQuerySessionInformationW(
            Some(WTS_CURRENT_SERVER_HANDLE),
            WTS_CURRENT_SESSION,
            WTSSessionInfoEx,
            &mut buffer,
            &mut bytes,
        )
        .ok()?;
        let locked = if !buffer.0.is_null() && bytes as usize >= size_of::<WTSINFOEXW>() {
            let info = &*(buffer.0 as *const WTSINFOEXW);
            let flags = if info.Level == 1 {
                Some(info.Data.WTSInfoExLevel1.SessionFlags)
            } else {
                None
            };
            flags.and_then(|flags| {
                if flags == WTS_SESSIONSTATE_LOCK as i32 {
                    Some(true)
                } else if flags == WTS_SESSIONSTATE_UNLOCK as i32 {
                    Some(false)
                } else {
                    None
                }
            })
        } else {
            None
        };
        if !buffer.0.is_null() {
            WTSFreeMemory(buffer.0 as *mut c_void);
        }
        locked
    }
}

struct NotificationGuard(HPOWERNOTIFY);

impl Drop for NotificationGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = UnregisterPowerSettingNotification(self.0);
        }
    }
}

pub struct Probe;

impl Probe {
    pub fn new() -> Self {
        START_LISTENER.call_once(|| {
            std::thread::spawn(listen);
        });
        Self
    }

    pub fn active(&mut self) -> Option<bool> {
        let screen_on = match DISPLAY_STATE.load(Ordering::Relaxed) {
            STATE_ON => Some(true),
            STATE_OFF => Some(false),
            _ => None,
        };
        crate::activity::screen_active(screen_on, session_locked())
    }
}

pub fn active() -> Option<bool> {
    Probe::new().active()
}

fn listen() {
    unsafe {
        let Some(window) = create_window() else {
            DISPLAY_STATE.store(STATE_UNKNOWN, Ordering::Relaxed);
            return;
        };
        let Some(notification) = RegisterPowerSettingNotification(
            HANDLE(window.0),
            &CONSOLE_DISPLAY_STATE,
            DEVICE_NOTIFY_WINDOW_HANDLE,
        )
        .ok() else {
            DISPLAY_STATE.store(STATE_UNKNOWN, Ordering::Relaxed);
            let _ = DestroyWindow(window);
            return;
        };
        let _registration = NotificationGuard(notification);
        let _ = DISPLAY_STATE.compare_exchange(
            STATE_UNKNOWN,
            STATE_ON,
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let _ = DestroyWindow(window);
    }
}
