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

fn refresh_with<F>(
    state: &Arc<Mutex<ActivityState>>,
    active: F,
) -> Result<ScreenActivityStatus, String>
where
    F: FnOnce() -> Option<bool>,
{
    let revision = state.lock().map_err(|e| e.to_string())?.screen.revision();
    let started = Instant::now();
    let active = active();
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.screen.update(revision, started, active);
    Ok(status(&state))
}

fn refresh(state: &Arc<Mutex<ActivityState>>) -> Result<ScreenActivityStatus, String> {
    refresh_with(state, probe)
}

fn status(state: &ActivityState) -> ScreenActivityStatus {
    ScreenActivityStatus {
        supported: cfg!(target_os = "linux"),
        enabled: state.screen.enabled,
        active: state.screen.active(),
    }
}

pub fn start(state: Arc<Mutex<ActivityState>>, db: &Db) {
    let enabled = cfg!(target_os = "linux") && db.get_setting(ENABLED_KEY, "false") == "true";
    state.lock().unwrap().screen.set_enabled(enabled);
    #[cfg(target_os = "linux")]
    std::thread::spawn(move || {
        const SAMPLE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
        let mut probe = linux::Probe::new();
        state
            .lock()
            .unwrap()
            .screen
            .attach_sampler(std::thread::current());
        loop {
            let enabled = state.lock().unwrap().screen.enabled;
            if !enabled {
                probe = linux::Probe::new();
                std::thread::park();
                continue;
            }
            let _ = refresh_with(&state, || probe.active());
            std::thread::park_timeout(SAMPLE_INTERVAL);
        }
    });
}

#[tauri::command]
pub fn get_screen_activity_status(
    activity: tauri::State<'_, Arc<Mutex<ActivityState>>>,
) -> Result<ScreenActivityStatus, String> {
    let state = activity.lock().map_err(|e| e.to_string())?;
    Ok(status(&state))
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
    {
        let mut state = activity.lock().map_err(|e| e.to_string())?;
        state.screen.set_enabled(enabled);
    }
    if !enabled {
        let state = activity.lock().map_err(|e| e.to_string())?;
        return Ok(status(&state));
    }
    let state = activity.inner().clone();
    tauri::async_runtime::spawn_blocking(move || refresh(&state))
        .await
        .map_err(|e| e.to_string())?
}
