use std::time::Duration;

use dbus::blocking::{stdintf::org_freedesktop_dbus::Properties, BlockingSender, Connection};
use x11rb::protocol::dpms::{ConnectionExt, DPMSMode};

pub fn active() -> Option<bool> {
    let session = Connection::new_session().ok();
    let locked = session.as_ref().and_then(session_locked);
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
        session.as_ref().and_then(gnome_screen_on)
    } else {
        x11_screen_on().or_else(|| session.as_ref().and_then(gnome_screen_on))
    };
    crate::activity::screen_active(screen_on, locked)
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

fn x11_screen_on() -> Option<bool> {
    let (connection, _) = x11rb::connect(None).ok()?;
    let capable = connection.dpms_capable().ok()?.reply().ok()?;
    if !capable.capable {
        return None;
    }
    let info = connection.dpms_info().ok()?.reply().ok()?;
    // With DPMS disabled, power_level is undefined; the display stays powered on.
    Some(!info.state || info.power_level == DPMSMode::ON)
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
