//! Local external plugins — scan app_data_dir/plugins, enable gate, UI URL.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{log_error, log_info, log_warn};

/// Kinds plugins must not claim (includes sdk — reserved for M9 generic path).
pub const RESERVED_KINDS: &[&str] = &[
    "rest",
    "water",
    "agent",
    "permission",
    "update",
    "rest-timer",
    "sdk",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestFile {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub settings: Option<String>,
    #[serde(default)]
    pub sidecar: Option<PluginSidecarManifest>,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled_by_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSidecarManifest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_sidecar_cwd")]
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

fn default_sidecar_cwd() -> String {
    ".".into()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub main: Option<String>,
    pub background: Option<String>,
    pub settings: Option<String>,
    pub sidecar: Option<PluginSidecarManifest>,
    pub sidecar_running: bool,
    pub events: Vec<String>,
    pub enabled: bool,
    pub enabled_by_default: bool,
    pub dir: String,
    pub has_ui: bool,
    pub has_background: bool,
    pub has_settings: bool,
    pub has_sidecar: bool,
    /// Max mtime (unix ms) of ui/settings entry files — frontend uses this to bust blob cache.
    pub content_mtime_ms: u64,
    pub anomalous: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedPlugin {
    info: ExternalPluginInfo,
    main_abs: Option<PathBuf>,
    background_abs: Option<PathBuf>,
    settings_abs: Option<PathBuf>,
    sidecar: Option<PluginSidecarSpec>,
}

struct PluginCache {
    plugins: Vec<CachedPlugin>,
}

impl PluginCache {
    fn empty() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PluginBackgroundSpec {
    pub id: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct PluginSidecarSpec {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
    pub fingerprint: String,
}

pub struct PluginManager {
    inner: Arc<Mutex<PluginCache>>,
}

impl Clone for PluginManager {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl PluginManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PluginCache::empty())),
        }
    }

    pub fn rescan(&self, app: &AppHandle) -> Result<Vec<ExternalPluginInfo>, String> {
        let root = plugins_root(app)?;
        fs::create_dir_all(&root).map_err(|e| format!("create plugins dir: {e}"))?;

        let mut found: Vec<CachedPlugin> = Vec::new();
        let entries = fs::read_dir(&root).map_err(|e| format!("read plugins dir: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match load_one(app, &path) {
                Ok(p) => found.push(p),
                Err(e) => {
                    log_warn!("plugins", "skip {}: {}", path.display(), e);
                    let id = path
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "unknown".into());
                    found.push(CachedPlugin {
                        info: ExternalPluginInfo {
                            id: id.clone(),
                            name: id,
                            version: String::new(),
                            description: String::new(),
                            main: None,
                            background: None,
                            settings: None,
                            sidecar: None,
                            events: vec![],
                            enabled: false,
                            enabled_by_default: false,
                            dir: path.to_string_lossy().to_string(),
                            has_ui: false,
                            has_background: false,
                            has_settings: false,
                            has_sidecar: false,
                            sidecar_running: false,
                            content_mtime_ms: 0,
                            anomalous: false,
                            error: Some(e),
                        },
                        main_abs: None,
                        background_abs: None,
                        settings_abs: None,
                        sidecar: None,
                    });
                }
            }
        }
        found.sort_by(|a, b| a.info.id.cmp(&b.info.id));

        let previous_anomalies: std::collections::HashSet<String> = self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .plugins
            .iter()
            .filter(|p| p.info.anomalous)
            .map(|p| p.info.id.clone())
            .collect();
        for plugin in &mut found {
            plugin.info.anomalous = previous_anomalies.contains(&plugin.info.id);
        }
        let list: Vec<ExternalPluginInfo> = found.iter().map(|p| p.info.clone()).collect();
        *self.inner.lock().map_err(|e| e.to_string())? = PluginCache { plugins: found };
        log_info!(
            "plugins",
            "scanned {} plugin(s) in {}",
            list.len(),
            root.display()
        );
        Ok(list)
    }

    /// Returns Ok if plugin is installed, error-free, enabled, and may emit this kind/event_type.
    pub fn allows_event(
        &self,
        plugin_id: &str,
        kind: &str,
        event_type: &str,
    ) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == plugin_id)
            .ok_or_else(|| format!("plugin not found: {plugin_id}"))?;
        if let Some(err) = &p.info.error {
            return Err(format!("plugin invalid: {err}"));
        }
        if !p.info.enabled {
            return Err(format!("plugin disabled: {plugin_id}"));
        }
        if RESERVED_KINDS.contains(&kind) {
            return Err(format!("kind '{kind}' is reserved"));
        }
        if !event_allowed(&p.info.events, kind, event_type) {
            return Err(format!(
                "event not declared in plugin manifest (kind={kind}, event_type={event_type})"
            ));
        }
        Ok(())
    }

    pub fn set_enabled(
        &self,
        app: &AppHandle,
        id: &str,
        enabled: bool,
    ) -> Result<ExternalPluginInfo, String> {
        validate_id(id)?;
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter_mut()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        if p.info.error.is_some() {
            return Err("cannot enable invalid plugin".into());
        }
        crate::plugin_config::set_plugin_config_entry(
            app,
            id,
            "enabled".into(),
            serde_json::Value::Bool(enabled),
        )?;
        p.info.enabled = enabled;
        Ok(p.info.clone())
    }

    pub fn mark_anomalous(&self, id: &str) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        let plugin = guard
            .plugins
            .iter_mut()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        plugin.info.anomalous = true;
        Ok(())
    }

    /// Returns Ok when the plugin is installed, valid, and currently enabled.
    pub fn ensure_enabled(&self, id: &str) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        if let Some(err) = &p.info.error {
            return Err(format!("plugin invalid: {err}"));
        }
        if !p.info.enabled {
            return Err(format!("plugin disabled: {id}"));
        }
        Ok(())
    }

    pub fn background_plugins(&self) -> Result<Vec<PluginBackgroundSpec>, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(guard
            .plugins
            .iter()
            .filter(|p| p.info.enabled && p.info.error.is_none())
            .filter_map(|p| {
                p.background_abs.as_ref().map(|path| PluginBackgroundSpec {
                    id: p.info.id.clone(),
                    fingerprint: background_fingerprint(&p.info.version, path),
                })
            })
            .collect())
    }

    pub fn sidecar_plugins(&self) -> Result<Vec<PluginSidecarSpec>, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(guard
            .plugins
            .iter()
            .filter(|p| p.info.enabled && p.info.error.is_none())
            .filter_map(|p| p.sidecar.clone())
            .collect())
    }

    pub fn background_source(&self, id: &str) -> Result<String, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        if !p.info.enabled {
            return Err(format!("plugin disabled: {id}"));
        }
        let path = p
            .background_abs
            .as_ref()
            .ok_or_else(|| format!("plugin has no background entry: {id}"))?;
        let meta = fs::metadata(path).map_err(|e| format!("stat background: {e}"))?;
        if meta.len() > 512 * 1024 {
            return Err("plugin background source too large (>512KiB)".into());
        }
        fs::read_to_string(path).map_err(|e| format!("read background source: {e}"))
    }

    pub fn ui_path(&self, id: &str) -> Result<PathBuf, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        if !p.info.enabled {
            return Err(format!("plugin disabled: {id}"));
        }
        p.main_abs
            .clone()
            .ok_or_else(|| format!("plugin has no UI entry: {id}"))
    }

    /// Settings ESM may be read for installed plugins even when disabled (detail panel).
    pub fn settings_source(&self, id: &str) -> Result<String, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        if let Some(err) = &p.info.error {
            return Err(format!("plugin invalid: {err}"));
        }
        let path = p
            .settings_abs
            .as_ref()
            .ok_or_else(|| format!("plugin has no settings entry: {id}"))?;
        let meta = fs::metadata(path).map_err(|e| format!("stat settings: {e}"))?;
        if meta.len() > 512 * 1024 {
            return Err("plugin settings source too large (>512KiB)".into());
        }
        fs::read_to_string(path).map_err(|e| format!("read settings source: {e}"))
    }

    /// True when plugin is installed and error-free (enabled not required).
    pub fn ensure_installed(&self, id: &str) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        if let Some(err) = &p.info.error {
            return Err(format!("plugin invalid: {err}"));
        }
        Ok(())
    }
}

fn plugins_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("plugins"))
        .map_err(|e| e.to_string())
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err(format!("invalid plugin id: {id}"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("invalid plugin id: {id}"));
    }
    Ok(())
}

fn load_one(app: &AppHandle, dir: &Path) -> Result<CachedPlugin, String> {
    let manifest_path = dir.join("manifest.json");
    if !manifest_path.is_file() {
        return Err("missing manifest.json".into());
    }
    let raw = fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {e}"))?;
    if raw.len() > 64 * 1024 {
        return Err("manifest too large".into());
    }
    let m: PluginManifestFile =
        serde_json::from_str(&raw).map_err(|e| format!("invalid manifest json: {e}"))?;

    validate_id(&m.id)?;
    let dir_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if dir_name != m.id {
        return Err(format!(
            "manifest id '{}' must match directory name '{}'",
            m.id, dir_name
        ));
    }
    if m.name.trim().is_empty() {
        return Err("manifest name is required".into());
    }
    if m.version.trim().is_empty() {
        return Err("manifest version is required".into());
    }

    for ev in &m.events {
        if let Some(k) = ev.strip_prefix("kind:") {
            if RESERVED_KINDS.contains(&k) {
                return Err(format!("events claim reserved kind: {k}"));
            }
        } else if RESERVED_KINDS.contains(&ev.as_str()) {
            return Err(format!("events claim reserved kind: {ev}"));
        }
    }

    let main_abs = resolve_entry(dir, m.main.as_deref(), "main")?;
    let background_abs = resolve_entry(dir, m.background.as_deref(), "background")?;
    let settings_abs = resolve_entry(dir, m.settings.as_deref(), "settings")?;
    let sidecar = m
        .sidecar
        .as_ref()
        .map(|manifest| sidecar_spec(dir, &m.id, &m.version, manifest));

    let enabled = crate::plugin_config::get_plugin_config_entry(app, &m.id, "enabled")?
        .and_then(|value| value.as_bool())
        .unwrap_or(m.enabled_by_default);

    let content_mtime_ms = file_mtime_ms(main_abs.as_ref()).max(file_mtime_ms(settings_abs.as_ref()));

    Ok(CachedPlugin {
        info: ExternalPluginInfo {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            main: m.main,
            background: m.background,
            settings: m.settings,
            sidecar: m.sidecar,
            events: m.events,
            enabled,
            enabled_by_default: m.enabled_by_default,
            dir: dir.to_string_lossy().to_string(),
            has_ui: main_abs.is_some(),
            has_background: background_abs.is_some(),
            has_settings: settings_abs.is_some(),
            has_sidecar: sidecar.is_some(),
            sidecar_running: false, // This will be set by the caller querying the running map
            content_mtime_ms,
            anomalous: false,
            error: None,
        },
        main_abs,
        background_abs,
        settings_abs,
        sidecar,
    })
}

fn file_mtime_ms(path: Option<&PathBuf>) -> u64 {
    let Some(p) = path else { return 0 };
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sidecar_spec(
    dir: &Path,
    id: &str,
    version: &str,
    manifest: &PluginSidecarManifest,
) -> PluginSidecarSpec {
    let cwd = if Path::new(&manifest.cwd).is_absolute() {
        PathBuf::from(&manifest.cwd)
    } else {
        dir.join(&manifest.cwd)
    };
    let command_path = Path::new(&manifest.command);
    let command = if command_path.is_absolute()
        || (!manifest.command.contains('/')
            && !manifest.command.contains('\\')
            && !manifest.command.starts_with('.'))
    {
        manifest.command.clone()
    } else {
        dir.join(command_path).to_string_lossy().to_string()
    };
    let fingerprint = sidecar_fingerprint(version, &command, &manifest.args, &cwd, &manifest.env);
    PluginSidecarSpec {
        id: id.to_string(),
        command,
        args: manifest.args.clone(),
        cwd,
        env: manifest.env.clone(),
        fingerprint,
    }
}

fn sidecar_fingerprint(
    version: &str,
    command: &str,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
) -> String {
    let mut env_pairs: Vec<_> = env.iter().collect();
    env_pairs.sort_by(|a, b| a.0.cmp(b.0));
    format!(
        "{version}:{command}:{args:?}:{}:{env_pairs:?}",
        cwd.display()
    )
}

fn resolve_entry(dir: &Path, entry: Option<&str>, field: &str) -> Result<Option<PathBuf>, String> {
    let Some(entry) = entry.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if entry.contains("..") || Path::new(entry).is_absolute() {
        return Err(format!(
            "{field} must be a relative path inside the plugin directory"
        ));
    }
    let abs = dir
        .join(entry)
        .canonicalize()
        .map_err(|e| format!("{field} path resolve failed: {e}"))?;
    let root = dir
        .canonicalize()
        .map_err(|e| format!("plugin root resolve failed: {e}"))?;
    if !abs.starts_with(&root) {
        return Err(format!("{field} escapes plugin directory"));
    }
    if !abs.is_file() {
        return Err(format!("{field} file not found: {entry}"));
    }
    Ok(Some(abs))
}

fn background_fingerprint(version: &str, path: &Path) -> String {
    let meta = fs::metadata(path).ok();
    let len = meta.as_ref().map(|m| m.len()).unwrap_or_default();
    let modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or_default();
    format!("{version}:{len}:{modified}")
}

fn event_allowed(events: &[String], kind: &str, event_type: &str) -> bool {
    if events.is_empty() {
        // No declarations → allow any non-reserved kind (already checked).
        return true;
    }
    for ev in events {
        if ev == event_type || ev == kind {
            return true;
        }
        if let Some(k) = ev.strip_prefix("kind:") {
            if k == kind {
                return true;
            }
        }
        // prefix match: "demo-timer" allows "demo-timer.tick"
        if event_type.starts_with(ev) && event_type.as_bytes().get(ev.len()) == Some(&b'.') {
            return true;
        }
        if kind.starts_with(ev)
            && (kind.len() == ev.len() || kind.as_bytes().get(ev.len()) == Some(&b'.'))
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{sidecar_spec, PluginSidecarManifest};
    use std::collections::HashMap;
    use std::path::Path;

    #[test]
    fn sidecar_spec_preserves_manifest_command_args_and_env() {
        let manifest = PluginSidecarManifest {
            command: "../tools/custom-runner".into(),
            args: vec!["--script".into(), "../outside/main.js".into()],
            cwd: "../runtime".into(),
            env: HashMap::from([("CATRACE_PLUGIN_ID".into(), "manifest-value".into())]),
        };

        let spec = sidecar_spec(Path::new("/plugins/demo"), "demo", "0.1.0", &manifest);

        assert_eq!(
            Path::new(&spec.command),
            Path::new("/plugins/demo").join("../tools/custom-runner")
        );
        assert_eq!(spec.args, manifest.args);
        assert_eq!(spec.cwd, Path::new("/plugins/demo").join("../runtime"));
        assert_eq!(spec.env, manifest.env);
    }
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn list_external_plugins(
    app: AppHandle,
    mgr: State<'_, PluginManager>,
    windows: State<'_, crate::plugin_window::PluginWindowManager>,
    sidecars: State<'_, crate::plugin_sidecar::PluginSidecarManager>,
) -> Result<Vec<ExternalPluginInfo>, String> {
    let mut list = mgr.rescan(&app)?;
    
    // Inject sidecar_running status
    for plugin in &mut list {
        if plugin.has_sidecar {
            plugin.sidecar_running = sidecars.inner().is_running(&plugin.id);
        }
    }

    windows.schedule_sync(app.clone(), mgr.inner().clone());
    sidecars.schedule_sync(app.clone(), mgr.inner().clone());
    Ok(list)
}

#[tauri::command]
pub fn set_external_plugin_enabled(
    app: AppHandle,
    mgr: State<'_, PluginManager>,
    windows: State<'_, crate::plugin_window::PluginWindowManager>,
    sidecars: State<'_, crate::plugin_sidecar::PluginSidecarManager>,
    id: String,
    enabled: bool,
) -> Result<ExternalPluginInfo, String> {
    let mut info = mgr.set_enabled(&app, &id, enabled)?;
    windows.schedule_sync(app.clone(), mgr.inner().clone());
    // Sync sidecar lifecycle before reporting runtime status so the UI
    // does not lag one refresh behind enable/disable.
    if let Err(e) = sidecars.inner().sync(&app, mgr.inner()) {
        log_warn!("plugins", "sidecar sync after enable toggle failed: {e}");
    }
    if info.has_sidecar {
        info.sidecar_running = sidecars.inner().is_running(&info.id);
    }
    Ok(info)
}

#[tauri::command]
pub fn get_plugin_ui_url(mgr: State<'_, PluginManager>, id: String) -> Result<String, String> {
    let path = mgr.ui_path(&id)?;
    // file:// URL — frontend converts via convertFileSrc when available.
    let s = path.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        Ok(format!("file://{s}"))
    } else {
        Ok(format!("file:///{s}"))
    }
}

/// Read plugin UI ESM source (preferred over asset URL import — WebView-friendly).
#[tauri::command]
pub fn get_plugin_ui_source(mgr: State<'_, PluginManager>, id: String) -> Result<String, String> {
    let path = mgr.ui_path(&id)?;
    let meta = fs::metadata(&path).map_err(|e| format!("stat ui: {e}"))?;
    if meta.len() > 512 * 1024 {
        return Err("plugin UI source too large (>512KiB)".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("read ui source: {e}"))
}

/// Read plugin settings ESM source for the main-window detail panel.
#[tauri::command]
pub fn get_plugin_settings_source(
    mgr: State<'_, PluginManager>,
    id: String,
) -> Result<String, String> {
    mgr.settings_source(&id)
}

/// Whole-object plugin config for main window / settings.mjs (installed plugins only).
#[tauri::command]
pub fn get_plugin_config(
    app: AppHandle,
    mgr: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<Option<serde_json::Value>, String> {
    validate_id(&plugin_id)?;
    mgr.ensure_installed(&plugin_id)?;
    crate::plugin_config::get_plugin_config::<serde_json::Value>(&app, &plugin_id)
}

#[tauri::command]
pub fn set_plugin_config(
    app: AppHandle,
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    validate_id(&plugin_id)?;
    mgr.ensure_installed(&plugin_id)?;
    let serde_json::Value::Object(mut incoming) = value else {
        return Err("plugin config must be a JSON object".into());
    };
    // Enable state is owned by set_external_plugin_enabled. Settings UIs often
    // rewrite the whole plugin_config object and would wipe `enabled` → false
    // on next scan (enabledByDefault). Preserve the stored flag unless the
    // payload explicitly includes `enabled` (timer-style portable settings).
    if !incoming.contains_key("enabled") {
        if let Some(prev) = crate::plugin_config::get_plugin_config_entry(&app, &plugin_id, "enabled")?
        {
            incoming.insert("enabled".into(), prev);
        }
    }
    let value = serde_json::Value::Object(incoming);
    if let Err(e) = crate::plugin_config::set_plugin_config(&app, &plugin_id, &value) {
        // Host UI shows failure toast once — plugins need not.
        let _ = app.emit(
            "catrace:plugin-config-save-failed",
            serde_json::json!({ "pluginId": plugin_id, "error": e }),
        );
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn open_plugins_dir(app: AppHandle) -> Result<(), String> {
    let root = plugins_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&root, None::<&str>)
        .map_err(|e| format!("Failed to open plugins dir: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_plugins_dir(app: AppHandle) -> Result<String, String> {
    let root = plugins_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

/// Result of installing a local plugin package (folder or zip).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallResult {
    pub id: String,
    pub name: String,
    pub version: String,
    pub overwritten: bool,
    pub path: String,
}

const MAX_INSTALL_ZIP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_INSTALL_UNPACKED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_INSTALL_FILE_COUNT: usize = 5_000;

/// Install a plugin from a local folder or `.zip` into `<app_data>/plugins/<id>/`.
/// Does not enable the plugin. Same id requires `overwrite: true`.
#[tauri::command]
pub fn install_external_plugin(
    app: AppHandle,
    mgr: State<'_, PluginManager>,
    windows: State<'_, crate::plugin_window::PluginWindowManager>,
    sidecars: State<'_, crate::plugin_sidecar::PluginSidecarManager>,
    source_path: String,
    overwrite: bool,
) -> Result<PluginInstallResult, String> {
    let source = PathBuf::from(source_path.trim());
    if source.as_os_str().is_empty() {
        return Err("source path is empty".into());
    }
    if !source.exists() {
        return Err(format!("path not found: {}", source.display()));
    }

    let root = plugins_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("create plugins dir: {e}"))?;

    let staging = root.join(format!(
        ".install-staging-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    if staging.exists() {
        remove_path_all(&staging)?;
    }
    fs::create_dir_all(&staging).map_err(|e| format!("create staging: {e}"))?;

    let install_result = (|| {
        if source.is_file() {
            unpack_plugin_zip(&source, &staging)?;
        } else if source.is_dir() {
            copy_dir_filtered(&source, &staging)?;
        } else {
            return Err(format!("unsupported path type: {}", source.display()));
        }

        let package_root = find_plugin_package_root(&staging)?;
        let manifest = read_install_manifest(&package_root)?;
        validate_id(&manifest.id)?;
        if manifest.name.trim().is_empty() {
            return Err("manifest name is required".into());
        }
        if manifest.version.trim().is_empty() {
            return Err("manifest version is required".into());
        }

        let dest = root.join(&manifest.id);
        let overwritten = dest.exists();
        if overwritten && !overwrite {
            return Err(format!(
                "plugin '{}' already installed; pass overwrite to replace",
                manifest.id
            ));
        }

        // Refuse installing over the selected source itself.
        if paths_equal(&source, &dest) {
            return Err("source path is already the installed plugin directory".into());
        }

        let staged_final = root.join(format!(
            ".install-final-{}-{}",
            manifest.id,
            uuid::Uuid::new_v4()
        ));
        if staged_final.exists() {
            remove_path_all(&staged_final)?;
        }
        // Move package contents into a sibling temp dir named for atomic replace.
        fs::rename(&package_root, &staged_final).or_else(|_| {
            copy_dir_filtered(&package_root, &staged_final)?;
            remove_path_all(&package_root)
        })?;

        // Ensure directory name will match id after rename to dest.
        if overwritten {
            // Keep enabled flag in plugin_config; only replace files.
            remove_path_all(&dest)?;
        }
        fs::rename(&staged_final, &dest).map_err(|e| {
            let _ = remove_path_all(&staged_final);
            format!("install rename failed: {e}")
        })?;

        // Soft-validate by loading; keep files even if optional entries warn.
        if let Err(e) = load_one(&app, &dest) {
            log_warn!(
                "plugins",
                "installed {} but load reported: {e}",
                manifest.id
            );
        }

        log_info!(
            "plugins",
            "installed plugin {} v{} (overwrite={overwritten}) from {}",
            manifest.id,
            manifest.version,
            source.display()
        );

        Ok(PluginInstallResult {
            id: manifest.id.clone(),
            name: manifest.name,
            version: manifest.version,
            overwritten,
            path: dest.to_string_lossy().to_string(),
        })
    })();

    let _ = remove_path_all(&staging);

    let result = install_result?;
    // Refresh cache + schedule runtimes (new package is disabled by default unless enabledByDefault).
    let _ = mgr.rescan(&app)?;
    windows.schedule_sync(app.clone(), mgr.inner().clone());
    sidecars.schedule_sync(app.clone(), mgr.inner().clone());
    Ok(result)
}

#[derive(Debug, Deserialize)]
struct InstallManifest {
    id: String,
    name: String,
    version: String,
}

fn read_install_manifest(dir: &Path) -> Result<InstallManifest, String> {
    let path = dir.join("manifest.json");
    if !path.is_file() {
        return Err("missing manifest.json".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read manifest: {e}"))?;
    if raw.len() > 64 * 1024 {
        return Err("manifest too large".into());
    }
    serde_json::from_str(&raw).map_err(|e| format!("invalid manifest json: {e}"))
}

fn find_plugin_package_root(staging: &Path) -> Result<PathBuf, String> {
    if staging.join("manifest.json").is_file() {
        return Ok(staging.to_path_buf());
    }
    let mut matches = Vec::new();
    let entries = fs::read_dir(staging).map_err(|e| format!("read staging: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("manifest.json").is_file() {
            matches.push(path);
        }
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err("no manifest.json found in package (folder or zip root / one nested folder)".into()),
        _ => Err("multiple plugin packages found; package must contain a single plugin".into()),
    }
}

fn unpack_plugin_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let meta = fs::metadata(zip_path).map_err(|e| format!("stat zip: {e}"))?;
    if meta.len() > MAX_INSTALL_ZIP_BYTES {
        return Err(format!(
            "zip too large (max {} MiB)",
            MAX_INSTALL_ZIP_BYTES / (1024 * 1024)
        ));
    }
    let file = fs::File::open(zip_path).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("invalid zip: {e}"))?;
    let mut total_unpacked: u64 = 0;
    let mut file_count = 0usize;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;
        let name = entry.name().to_string();
        if name.contains("..") {
            return Err(format!("zip path traversal rejected: {name}"));
        }
        let rel = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => return Err(format!("zip unsafe path rejected: {name}")),
        };
        let out_path = dest.join(&rel);
        if !out_path.starts_with(dest) {
            return Err(format!("zip path escaped dest: {name}"));
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("mkdir {}: {e}", out_path.display()))?;
            continue;
        }

        file_count += 1;
        if file_count > MAX_INSTALL_FILE_COUNT {
            return Err(format!(
                "zip has too many files (max {MAX_INSTALL_FILE_COUNT})"
            ));
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut outfile =
            fs::File::create(&out_path).map_err(|e| format!("create {}: {e}", out_path.display()))?;
        let written = std::io::copy(&mut entry, &mut outfile)
            .map_err(|e| format!("extract {}: {e}", out_path.display()))?;
        total_unpacked = total_unpacked.saturating_add(written);
        if total_unpacked > MAX_INSTALL_UNPACKED_BYTES {
            return Err(format!(
                "unpacked size too large (max {} MiB)",
                MAX_INSTALL_UNPACKED_BYTES / (1024 * 1024)
            ));
        }
    }
    Ok(())
}

fn copy_dir_filtered(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut file_count = 0usize;
    let mut total: u64 = 0;
    copy_dir_filtered_inner(src, dest, &mut file_count, &mut total)
}

fn copy_dir_filtered_inner(
    src: &Path,
    dest: &Path,
    file_count: &mut usize,
    total: &mut u64,
) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read dir entry: {e}"))?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name == "." || name == ".." || name == ".git" || name == "node_modules" {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&file_name);
        let ft = entry
            .file_type()
            .map_err(|e| format!("file type {}: {e}", from.display()))?;
        if ft.is_dir() {
            fs::create_dir_all(&to).map_err(|e| format!("mkdir {}: {e}", to.display()))?;
            copy_dir_filtered_inner(&from, &to, file_count, total)?;
        } else if ft.is_file() {
            *file_count += 1;
            if *file_count > MAX_INSTALL_FILE_COUNT {
                return Err(format!(
                    "package has too many files (max {MAX_INSTALL_FILE_COUNT})"
                ));
            }
            let meta = fs::metadata(&from).map_err(|e| format!("stat {}: {e}", from.display()))?;
            *total = total.saturating_add(meta.len());
            if *total > MAX_INSTALL_UNPACKED_BYTES {
                return Err(format!(
                    "package too large (max {} MiB)",
                    MAX_INSTALL_UNPACKED_BYTES / (1024 * 1024)
                ));
            }
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} -> {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn remove_path_all(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let meta = fs::symlink_metadata(path).map_err(|e| format!("stat {}: {e}", path.display()))?;
    if meta.file_type().is_symlink() {
        fs::remove_file(path)
            .or_else(|_| fs::remove_dir(path))
            .map_err(|e| format!("remove symlink {}: {e}", path.display()))?;
        return Ok(());
    }
    if meta.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("remove dir {}: {e}", path.display()))?;
    } else {
        fs::remove_file(path).map_err(|e| format!("remove file {}: {e}", path.display()))?;
    }
    Ok(())
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon(a) == canon(b)
}

/// Called from setup after PluginManager is managed.
pub fn initial_scan(app: &AppHandle, mgr: &PluginManager) {
    #[cfg(debug_assertions)]
    ensure_dev_plugin_links(app);

    if let Err(e) = mgr.rescan(app) {
        log_error!("plugins", "initial scan failed: {e}");
    }
}

/// Dev-only: if repo demo plugins are not linked into app_data/plugins, junction/symlink them.
/// Release builds skip this entirely.
#[cfg(debug_assertions)]
fn ensure_dev_plugin_links(app: &AppHandle) {
    let Ok(root) = plugins_root(app) else {
        return;
    };
    if let Err(e) = fs::create_dir_all(&root) {
        log_warn!("plugins", "dev link: create plugins dir failed: {e}");
        return;
    }

    // src-tauri/ -> repo root -> tools/plugin-demo
    let demo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tools")
        .join("plugin-demo");
    let Ok(demo_root) = fs::canonicalize(&demo_root) else {
        log_warn!(
            "plugins",
            "dev link: plugin-demo not found at {}",
            demo_root.display()
        );
        return;
    };

    let Ok(entries) = fs::read_dir(&demo_root) else {
        return;
    };
    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_dir() {
            continue;
        }
        let Some(name) = src.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        // Only link plugin packages (must contain manifest.json).
        if !src.join("manifest.json").is_file() {
            continue;
        }
        let dst = root.join(name);
        match ensure_dir_link(&src, &dst) {
            Ok(DevLinkResult::AlreadyLinked) => {
                log_info!("plugins", "dev link ok: {name} already linked");
            }
            Ok(DevLinkResult::Created) => {
                log_info!(
                    "plugins",
                    "dev link created: {} -> {}",
                    dst.display(),
                    src.display()
                );
            }
            Ok(DevLinkResult::SkippedExisting) => {
                log_info!(
                    "plugins",
                    "dev link skip: {} exists and is not our link",
                    dst.display()
                );
            }
            Err(e) => log_warn!("plugins", "dev link failed for {name}: {e}"),
        }
    }
}

#[cfg(debug_assertions)]
enum DevLinkResult {
    AlreadyLinked,
    Created,
    SkippedExisting,
}

#[cfg(debug_assertions)]
fn ensure_dir_link(src: &Path, dst: &Path) -> Result<DevLinkResult, String> {
    let src_canon = fs::canonicalize(src).map_err(|e| format!("canonicalize src: {e}"))?;

    if dst.exists() || is_symlink_like(dst) {
        if let Ok(dst_canon) = fs::canonicalize(dst) {
            if dst_canon == src_canon {
                return Ok(DevLinkResult::AlreadyLinked);
            }
        }
        // Real directory / foreign link — do not clobber user installs.
        return Ok(DevLinkResult::SkippedExisting);
    }

    create_dir_link(&src_canon, dst)?;
    Ok(DevLinkResult::Created)
}

#[cfg(debug_assertions)]
fn is_symlink_like(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
fn create_dir_link(src: &Path, dst: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;

        // Prefer cmd mklink /J (no admin). Falls back to std symlink_dir.
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dst.as_os_str())
            .arg(src.as_os_str())
            .status()
            .map_err(|e| format!("mklink spawn: {e}"))?;
        if status.success() {
            return Ok(());
        }

        std::os::windows::fs::symlink_dir(src, dst).map_err(|e| {
            format!(
                "junction/symlink failed (mklink exit {:?}): {e}",
                status.code()
            )
        })
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, dst).map_err(|e| format!("symlink: {e}"))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (src, dst);
        Err("dev plugin link unsupported on this platform".into())
    }
}
