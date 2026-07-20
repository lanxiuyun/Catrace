//! Local external plugins — scan app_data_dir/plugins, enable gate, UI URL.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::{log_error, log_info, log_warn};

const ENABLED_KEY_PREFIX: &str = "external_plugin_enabled:";

/// Kinds plugins must not claim (includes sdk — reserved for M9 generic path).
pub const RESERVED_KINDS: &[&str] = &[
    "rest",
    "water",
    "eye",
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
    pub events: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled_by_default: bool,
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
    pub events: Vec<String>,
    pub permissions: Vec<String>,
    pub enabled: bool,
    pub enabled_by_default: bool,
    pub dir: String,
    pub has_ui: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedPlugin {
    info: ExternalPluginInfo,
    main_abs: Option<PathBuf>,
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

    pub fn rescan(&self, app: &AppHandle, db: &Db) -> Result<Vec<ExternalPluginInfo>, String> {
        let root = plugins_root(app)?;
        fs::create_dir_all(&root).map_err(|e| format!("create plugins dir: {e}"))?;

        let mut found: Vec<CachedPlugin> = Vec::new();
        let entries = fs::read_dir(&root).map_err(|e| format!("read plugins dir: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match load_one(&path, db) {
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
                            events: vec![],
                            permissions: vec![],
                            enabled: false,
                            enabled_by_default: false,
                            dir: path.to_string_lossy().to_string(),
                            has_ui: false,
                            error: Some(e),
                        },
                        main_abs: None,
                    });
                }
            }
        }
        found.sort_by(|a, b| a.info.id.cmp(&b.info.id));

        let list: Vec<ExternalPluginInfo> = found.iter().map(|p| p.info.clone()).collect();
        *self.inner.lock().map_err(|e| e.to_string())? = PluginCache { plugins: found };
        log_info!("plugins", "scanned {} plugin(s) in {}", list.len(), root.display());
        Ok(list)
    }

    /// Returns Ok if plugin is installed, error-free, enabled, and may emit this kind/event_type.
    pub fn allows_event(&self, plugin_id: &str, kind: &str, event_type: &str) -> Result<(), String> {
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

    pub fn set_enabled(&self, db: &Db, id: &str, enabled: bool) -> Result<ExternalPluginInfo, String> {
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
        let key = format!("{ENABLED_KEY_PREFIX}{id}");
        db.set_setting(&key, if enabled { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
        p.info.enabled = enabled;
        Ok(p.info.clone())
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

fn load_one(dir: &Path, db: &Db) -> Result<CachedPlugin, String> {
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

    let main_abs = if let Some(main) = m.main.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if main.contains("..") || Path::new(main).is_absolute() || main.contains('\\') && !cfg!(windows)
        {
            // still allow windows-style only after normalize
        }
        if main.contains("..") || Path::new(main).is_absolute() {
            return Err("main must be a relative path inside the plugin directory".into());
        }
        let abs = dir.join(main);
        let abs = abs
            .canonicalize()
            .map_err(|e| format!("main path resolve failed: {e}"))?;
        let root_can = dir
            .canonicalize()
            .map_err(|e| format!("plugin root resolve failed: {e}"))?;
        if !abs.starts_with(&root_can) {
            return Err("main escapes plugin directory".into());
        }
        if !abs.is_file() {
            return Err(format!("main file not found: {main}"));
        }
        Some(abs)
    } else {
        None
    };

    let key = format!("{ENABLED_KEY_PREFIX}{}", m.id);
    let default = if m.enabled_by_default { "true" } else { "false" };
    let enabled = db.get_setting(&key, default) == "true";

    Ok(CachedPlugin {
        info: ExternalPluginInfo {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            main: m.main,
            events: m.events,
            permissions: m.permissions,
            enabled,
            enabled_by_default: m.enabled_by_default,
            dir: dir.to_string_lossy().to_string(),
            has_ui: main_abs.is_some(),
            error: None,
        },
        main_abs,
    })
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
        if kind.starts_with(ev) && (kind.len() == ev.len() || kind.as_bytes().get(ev.len()) == Some(&b'.')) {
            return true;
        }
    }
    false
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn list_external_plugins(
    app: AppHandle,
    db: State<'_, Db>,
    mgr: State<'_, PluginManager>,
) -> Result<Vec<ExternalPluginInfo>, String> {
    mgr.rescan(&app, &db)
}

#[tauri::command]
pub fn set_external_plugin_enabled(
    db: State<'_, Db>,
    mgr: State<'_, PluginManager>,
    id: String,
    enabled: bool,
) -> Result<ExternalPluginInfo, String> {
    mgr.set_enabled(&db, &id, enabled)
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

/// Called from setup after PluginManager is managed.
pub fn initial_scan(app: &AppHandle, db: &Db, mgr: &PluginManager) {
    if let Err(e) = mgr.rescan(app, db) {
        log_error!("plugins", "initial scan failed: {e}");
    }
}
