use std::time::Duration;

use dbus::blocking::{stdintf::org_freedesktop_dbus::Properties, BlockingSender, Connection};
use x11rb::protocol::dpms::{ConnectionExt, DPMSMode};
use x11rb::rust_connection::RustConnection;

#[derive(Default)]
pub struct Probe {
    session: Option<Connection>,
    x11: Option<RustConnection>,
}

impl Probe {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn active(&mut self) -> Option<bool> {
        let locked = self.locked();
        if locked == Some(true) {
            return Some(false);
        }
        // Xwayland's virtual outputs do not describe the physical monitor's power state.
        let wayland = match std::env::var("XDG_SESSION_TYPE").as_deref() {
            Ok("wayland") => true,
            Ok("x11") => false,
            _ => std::env::var_os("WAYLAND_DISPLAY").is_some(),
        };
        let screen_on = if wayland {
            self.gnome_screen_on()
        } else {
            match self.x11_screen_on() {
                Some(on) => Some(on),
                None => self.gnome_screen_on(),
            }
        };
        crate::activity::screen_active(screen_on, locked)
    }

    fn session(&mut self) -> Option<&Connection> {
        if self.session.is_none() {
            self.session = Connection::new_session().ok();
        }
        self.session.as_ref()
    }

    fn locked(&mut self) -> Option<bool> {
        let connection = self.session()?;
        session_locked(connection)
    }

    fn gnome_screen_on(&mut self) -> Option<bool> {
        let connection = self.session()?;
        gnome_screen_on(connection)
    }

    fn x11_screen_on(&mut self) -> Option<bool> {
        if self.x11.is_none() {
            self.x11 = x11rb::connect(None).ok().map(|(connection, _)| connection);
        }
        let connection = self.x11.as_ref()?;
        let capable = connection.dpms_capable().ok()?.reply().ok()?;
        if !capable.capable {
            return None;
        }
        let info = connection.dpms_info().ok()?.reply().ok()?;
        // With DPMS disabled, power_level is undefined; the display stays powered on.
        Some(!info.state || info.power_level == DPMSMode::ON)
    }
}

pub fn active() -> Option<bool> {
    let mut probe = Probe::new();
    probe.active()
}

fn session_locked(connection: &Connection) -> Option<bool> {
    let mut unlocked = None;
    for (service, path, interface) in [
        ("org.freedesktop.ScreenSaver", "/ScreenSaver", "org.freedesktop.ScreenSaver"),
        ("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver", "org.freedesktop.ScreenSaver"),
        ("org.gnome.Shell.ScreenShield", "/org/gnome/ScreenSaver", "org.gnome.ScreenSaver"),
        ("org.gnome.ScreenSaver", "/org/gnome/ScreenSaver", "org.gnome.ScreenSaver"),
    ] {
        let Ok(mut message) = dbus::Message::new_method_call(service, path, interface, "GetActive") else {
            continue;
        };
        // Observe the running desktop only; never launch an installed, inactive locker.
        message.set_auto_start(false);
        let active = connection
            .send_with_reply_and_block(message, Duration::from_millis(750))
            .ok()
            .and_then(|reply| reply.read1::<bool>().ok());
        match active {
            Some(true) => return Some(true),
            Some(false) => unlocked = Some(false),
            None => {},
        }
    }
    unlocked
}

fn gnome_screen_on(connection: &Connection) -> Option<bool> {
    let proxy = connection.with_proxy(
        "org.gnome.Mutter.DisplayConfig",
        "/org/gnome/Mutter/DisplayConfig",
        Duration::from_millis(750),
    );
    let mode: i32 = proxy
        .get("org.gnome.Mutter.DisplayConfig", "PowerSaveMode")
        .ok()?;
    match mode {
        0 => Some(true),
        1..=3 => Some(false),
        _ => None,
    }
}
