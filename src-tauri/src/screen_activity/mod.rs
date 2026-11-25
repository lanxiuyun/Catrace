#[cfg(target_os = "linux")]
mod linux;

use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::{db::Db, ActivityState};

const ENABLED_KEY: &str = "screen_active_enabled";

#[derive(serde::Serialize)]
pub struct ScreenActivityStatus {
    supported: bool,
    enabled: bool,
    active: Option<bool>,
}

fn probe() -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        linux::active()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn refresh(state: &Arc<Mutex<ActivityState>>) -> Result<ScreenActivityStatus, String> {
    let revision = state.lock().map_err(|e| e.to_string())?.screen.revision();
    let started = Instant::now();
    let active = probe();
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.screen.update(revision, started, active);
    Ok(status(&state))
}

fn status(state: &ActivityState) -> ScreenActivityStatus {
    ScreenActivityStatus {
        supported: cfg!(target_os = "linux"),
        enabled: state.screen.enabled,
        active: state.screen.detected(),
    }
}

pub fn start(state: Arc<Mutex<ActivityState>>, db: &Db) {
    let enabled = cfg!(target_os = "linux") && db.get_setting(ENABLED_KEY, "false") == "true";
    state.lock().unwrap().screen.set_enabled(enabled);
    #[cfg(target_os = "linux")]
    std::thread::spawn(move || loop {
        let enabled = state.lock().unwrap().screen.enabled;
        if enabled {
            let _ = refresh(&state);
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    });
}

#[tauri::command]
pub async fn get_screen_activity_status(
    activity: tauri::State<'_, Arc<Mutex<ActivityState>>>,
) -> Result<ScreenActivityStatus, String> {
    {
        let state = activity.lock().map_err(|e| e.to_string())?;
        if state.screen.enabled {
            return Ok(status(&state));
        }
    }
    let state = activity.inner().clone();
    tauri::async_runtime::spawn_blocking(move || refresh(&state))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_screen_active_enabled(
    enabled: bool,
    activity: tauri::State<'_, Arc<Mutex<ActivityState>>>,
    db: tauri::State<'_, Db>,
) -> Result<ScreenActivityStatus, String> {
    if enabled && !cfg!(target_os = "linux") {
        return Err("Screen activity is only supported on Linux".into());
    }
    db.set_setting(ENABLED_KEY, &enabled.to_string())
        .map_err(|e| e.to_string())?;
    activity
        .lock()
        .map_err(|e| e.to_string())?
        .screen
        .set_enabled(enabled);
    let state = activity.inner().clone();
    tauri::async_runtime::spawn_blocking(move || refresh(&state))
        .await
        .map_err(|e| e.to_string())?
}
