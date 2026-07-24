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
    pub background: Option<String>,
    #[serde(default)]
    pub events: Vec<String>,
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
    pub background: Option<String>,
    pub events: Vec<String>,
    pub enabled: bool,
    pub enabled_by_default: bool,
    pub dir: String,
    pub has_ui: bool,
    pub has_background: bool,
    pub anomalous: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedPlugin {
    info: ExternalPluginInfo,
    main_abs: Option<PathBuf>,
    background_abs: Option<PathBuf>,
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
                            background: None,
                            events: vec![],
                            enabled: false,
                            enabled_by_default: false,
                            dir: path.to_string_lossy().to_string(),
                            has_ui: false,
                            has_background: false,
                            anomalous: false,
                            error: Some(e),
                        },
                        main_abs: None,
                        background_abs: None,
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
        db: &Db,
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
        let key = format!("{ENABLED_KEY_PREFIX}{id}");
        db.set_setting(&key, if enabled { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
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

    let main_abs = resolve_entry(dir, m.main.as_deref(), "main")?;
    let background_abs = resolve_entry(dir, m.background.as_deref(), "background")?;

    let key = format!("{ENABLED_KEY_PREFIX}{}", m.id);
    let default = if m.enabled_by_default {
        "true"
    } else {
        "false"
    };
    let enabled = db.get_setting(&key, default) == "true";

    Ok(CachedPlugin {
        info: ExternalPluginInfo {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            main: m.main,
            background: m.background,
            events: m.events,
            enabled,
            enabled_by_default: m.enabled_by_default,
            dir: dir.to_string_lossy().to_string(),
            has_ui: main_abs.is_some(),
            has_background: background_abs.is_some(),
            anomalous: false,
            error: None,
        },
        main_abs,
        background_abs,
    })
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

// ---------- Tauri commands ----------

#[tauri::command]
pub fn list_external_plugins(
    app: AppHandle,
    db: State<'_, Db>,
    mgr: State<'_, PluginManager>,
    windows: State<'_, crate::plugin_window::PluginWindowManager>,
) -> Result<Vec<ExternalPluginInfo>, String> {
    let list = mgr.rescan(&app, &db)?;
    windows.schedule_sync(app, mgr.inner().clone());
    Ok(list)
}

#[tauri::command]
pub fn set_external_plugin_enabled(
    app: AppHandle,
    db: State<'_, Db>,
    mgr: State<'_, PluginManager>,
    windows: State<'_, crate::plugin_window::PluginWindowManager>,
    id: String,
    enabled: bool,
) -> Result<ExternalPluginInfo, String> {
    let info = mgr.set_enabled(&db, &id, enabled)?;
    windows.schedule_sync(app, mgr.inner().clone());
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
    #[cfg(debug_assertions)]
    ensure_dev_plugin_links(app);

    if let Err(e) = mgr.rescan(app, db) {
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
