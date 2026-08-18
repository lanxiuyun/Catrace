use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::plugins::PluginManager;
use crate::{log_info, log_warn};

const WINDOW_LABEL_PREFIX: &str = "plugin-bg-";

#[derive(Clone, Default)]
pub struct PluginWindowManager {
    running: Arc<Mutex<HashMap<String, String>>>,
    sync_lock: Arc<Mutex<()>>,
}

impl PluginWindowManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn schedule_sync(&self, app: tauri::AppHandle, plugins: PluginManager) {
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = manager.sync(&app, &plugins) {
                log_warn!("plugin-runtime", "background window sync failed: {e}");
            }
        });
    }

    pub fn sync(&self, app: &tauri::AppHandle, plugins: &PluginManager) -> Result<(), String> {
        let _sync_guard = self.sync_lock.lock().map_err(|e| e.to_string())?;
        let desired = plugins.background_plugins()?;
        let desired_map: HashMap<_, _> = desired
            .iter()
            .map(|spec| (spec.id.clone(), spec.fingerprint.clone()))
            .collect();
        let current = self.running.lock().map_err(|e| e.to_string())?.clone();

        for id in current.keys() {
            if !desired_map.contains_key(id) {
                self.stop(app, id)?;
            }
        }

        for spec in desired {
            if current.get(&spec.id) != Some(&spec.fingerprint) {
                if current.contains_key(&spec.id) {
                    self.stop(app, &spec.id)?;
                }
                self.start(app, &spec.id, &spec.fingerprint)?;
            }
        }
        Ok(())
    }

    fn start(&self, app: &tauri::AppHandle, id: &str, fingerprint: &str) -> Result<(), String> {
        let label = window_label(id);
        if app.get_webview_window(&label).is_some() {
            return Err(format!("plugin background window still exists: {id}"));
        }

        let url = format!("index.html?plugin_id={id}#/plugin-host");
        let window =
            tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(url.into()))
                .title(format!("Catrace Plugin: {id}"))
                .inner_size(320.0, 240.0)
                .visible(false)
                .skip_taskbar(true)
                .decorations(false)
                .resizable(false)
                .build()
                .map_err(|e| format!("create plugin background window {id}: {e}"))?;
        let _ = window.hide();

        self.running
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.to_string(), fingerprint.to_string());
        log_info!("plugin-runtime", "started background window for {id}");
        Ok(())
    }

    fn stop(&self, app: &tauri::AppHandle, id: &str) -> Result<(), String> {
        if let Some(window) = app.get_webview_window(&window_label(id)) {
            if let Err(e) = window.destroy() {
                log_warn!(
                    "plugin-runtime",
                    "destroy background window for {id} failed: {e}"
                );
                return Err(e.to_string());
            }
        }
        self.running.lock().map_err(|e| e.to_string())?.remove(id);
        log_info!("plugin-runtime", "stopped background window for {id}");
        Ok(())
    }
}

pub fn plugin_id_from_label(label: &str) -> Result<&str, String> {
    label
        .strip_prefix(WINDOW_LABEL_PREFIX)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "plugin command must be called from a plugin background window".into())
}

fn window_label(id: &str) -> String {
    format!("{WINDOW_LABEL_PREFIX}{id}")
}

#[cfg(test)]
mod tests {
    use super::plugin_id_from_label;

    #[test]
    fn extracts_plugin_id_from_background_window_label() {
        assert_eq!(
            plugin_id_from_label("plugin-bg-demo-timer"),
            Ok("demo-timer")
        );
    }

    #[test]
    fn rejects_non_plugin_and_empty_background_labels() {
        assert!(plugin_id_from_label("main").is_err());
        assert!(plugin_id_from_label("plugin-bg-").is_err());
    }
}
