//! Stable desktop capabilities exposed to enabled external plugins.
//!
//! Keep this module independent from plugin scanning and plugin-specific business logic.

mod audio;
mod clipboard;
mod dialog;
mod events;
mod host;
mod shell;
mod storage;
mod window;

pub use audio::*;
pub use clipboard::*;
pub use dialog::*;
pub use events::*;
pub use host::*;
pub use shell::*;
pub use storage::*;
pub use window::*;

use crate::plugins::PluginManager;

pub(crate) fn require_plugin_api(
    window: &tauri::WebviewWindow,
    plugins: &PluginManager,
    plugin_id: &str,
) -> Result<(), String> {
    match window.label() {
        "main" | "reminder-toast" => plugins.ensure_enabled(plugin_id),
        label if label == format!("plugin-bg-{plugin_id}") => plugins.ensure_enabled(plugin_id),
        _ => Err("plugin API caller does not match plugin".into()),
    }
}

pub(crate) fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.contains(':') {
        return Err("storage key must be non-empty and must not contain ':'".into());
    }
    Ok(())
}
