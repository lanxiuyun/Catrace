//! Local external plugins — scan app_data_dir/plugins, enable gate, UI URL.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{log_debug, log_error, log_info, log_warn};

/// Kinds plugins must not claim (includes sdk — reserved for M9 generic path).
pub const RESERVED_KINDS: &[&str] = &["rest", "agent", "permission", "update", "rest-timer", "sdk"];

// Serialize filesystem mutations and enable toggles, including remote installs.
static PLUGIN_MUTATION: Mutex<()> = Mutex::new(());

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
    pub icon: Option<String>,
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
    pub icon: Option<String>,
    pub sidecar: Option<PluginSidecarManifest>,
    pub events: Vec<String>,
    pub enabled: bool,
    pub enabled_by_default: bool,
    pub dir: String,
    pub has_ui: bool,
    pub has_background: bool,
    pub has_settings: bool,
    /// Max mtime (unix ms) of ui/settings entry files — frontend uses this to bust blob cache.
    pub content_mtime_ms: u64,
    pub anomalous: bool,
    pub error: Option<String>,
}

/// 「插件中心」列表条目：清单 + 图标 data URL。
///
/// 迁移期用它**只读**地展示已安装插件：不写运行时缓存，因此不会加载 UI、
/// 不会起后台 WebView / sidecar，也不会放行插件事件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub info: ExternalPluginInfo,
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedPlugin {
    info: ExternalPluginInfo,
    dir: PathBuf,
    main_abs: Option<PathBuf>,
    background_abs: Option<PathBuf>,
    settings_abs: Option<PathBuf>,
    icon_abs: Option<PathBuf>,
    sidecar: Option<PluginSidecarSpec>,
    content_hash: String,
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
    pub version: String,
    pub content_hash: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct PluginSidecarSpec {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
    /// Recorded for diagnostics / tests. Restart policy is enable/disable +
    /// the reload button, not fingerprint mismatch.
    #[allow(dead_code)]
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

/// 读磁盘上的插件目录，返回缓存结构但**不写入** `PluginManager`。
fn scan_disk(app: &AppHandle) -> Result<Vec<CachedPlugin>, String> {
    let root = plugins_root(app)?;
    fs::create_dir_all(&root).map_err(|e| format!("create plugins dir: {e}"))?;

    let mut found: Vec<CachedPlugin> = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("read plugins dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
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
                        icon: None,
                        sidecar: None,
                        events: vec![],
                        enabled: false,
                        enabled_by_default: false,
                        dir: path.to_string_lossy().to_string(),
                        has_ui: false,
                        has_background: false,
                        has_settings: false,
                        content_mtime_ms: 0,
                        anomalous: false,
                        error: Some(e),
                    },
                    dir: path.to_path_buf(),
                    main_abs: None,
                    background_abs: None,
                    settings_abs: None,
                    icon_abs: None,
                    sidecar: None,
                    content_hash: String::new(),
                });
            }
        }
    }
    found.sort_by(|a, b| a.info.id.cmp(&b.info.id));
    // 扫描在一次运行里会随重载/设置页打开反复发生，逐次 info 纯噪音；
    // 启动时的汇总见 log_loaded_plugins 的一行版
    log_debug!(
        "plugins",
        "scanned {} plugin(s) in {}",
        found.len(),
        root.display()
    );
    Ok(found)
}

/// 迁移期「插件中心」的只读目录：清单 + 图标，不进入运行时。
pub fn scan_catalog(app: &AppHandle) -> Result<Vec<PluginCatalogEntry>, String> {
    let found = scan_disk(app)?;
    Ok(found
        .into_iter()
        .map(|p| {
            let icon_data_url = p
                .icon_abs
                .as_ref()
                .and_then(|path| icon_data_url_from_path(path).ok());
            PluginCatalogEntry {
                info: p.info,
                icon_data_url,
            }
        })
        .collect())
}

fn icon_data_url_from_path(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("read icon: {e}"))?;
    if bytes.len() > 256 * 1024 {
        return Err("plugin icon too large (>256KiB)".into());
    }
    use base64::Engine;
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

impl PluginManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PluginCache::empty())),
        }
    }

    pub fn rescan(&self, app: &AppHandle) -> Result<Vec<ExternalPluginInfo>, String> {
        let mut found = scan_disk(app)?;

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
                    version: p.info.version.clone(),
                    content_hash: p.content_hash.clone(),
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

    /// Disabled plugins must not execute settings modules in a host WebView.
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
        if !p.info.enabled {
            return Err(format!("plugin disabled: {id}"));
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

    pub fn icon_data_url(&self, id: &str) -> Result<String, String> {
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
            .icon_abs
            .as_ref()
            .ok_or_else(|| format!("plugin has no icon: {id}"))?;
        icon_data_url_from_path(path)
    }

    /// Return the plugin's install directory.
    pub fn plugin_dir(&self, id: &str) -> Result<String, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        let p = guard
            .plugins
            .iter()
            .find(|p| p.info.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?;
        Ok(p.dir.to_string_lossy().to_string())
    }

    fn log_loaded_plugins(&self) {
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        let mut enabled: Vec<&str> = Vec::new();
        for p in &guard.plugins {
            if let Some(err) = &p.info.error {
                log_warn!("plugins", "loaded {} error={err}", p.info.id);
                continue;
            }
            log_debug!(
                "plugins",
                "loaded {} v{} hash={} enabled={}",
                p.info.id,
                p.info.version,
                p.content_hash,
                p.info.enabled
            );
            if p.info.enabled {
                enabled.push(p.info.id.as_str());
            }
        }
        // 逐插件明细走 debug（今日日志实测：每启动 14 行、多轮重启时占日志大头）；
        // 默认级别只留一行汇总，enabled 名单是「装了没生效」类问题的第一排查线索
        log_info!(
            "plugins",
            "loaded {} plugin(s), enabled: {}",
            guard.plugins.len(),
            if enabled.is_empty() {
                "none".to_string()
            } else {
                enabled.join(", ")
            }
        );
    }
}

fn plugins_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("plugins"))
        .map_err(|e| e.to_string())
}

pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err(format!("invalid plugin id: {id}"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("invalid plugin id: {id}"));
    }
    let device = matches!(id, "con" | "prn" | "aux" | "nul")
        || (id.len() == 4
            && (id.starts_with("com") || id.starts_with("lpt"))
            && matches!(id.as_bytes()[3], b'1'..=b'9'));
    if device || RESERVED_KINDS.contains(&id) {
        return Err(format!("reserved plugin id: {id}"));
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
    // Builtin plugins (rest/agent) are managed on the frontend, not on disk; the
    // optional manifest icon is only meaningful for external plugins.
    let icon_abs = if RESERVED_KINDS.contains(&m.id.as_str()) {
        None
    } else {
        resolve_icon(dir, m.icon.as_deref())?
    };
    let sidecar = m
        .sidecar
        .as_ref()
        .map(|manifest| sidecar_spec(dir, &m.id, &m.version, manifest));

    let enabled = crate::plugin_config::get_plugin_config_entry(app, &m.id, "enabled")?
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let content_mtime_ms =
        file_mtime_ms(main_abs.as_ref()).max(file_mtime_ms(settings_abs.as_ref()));
    let content_hash = plugin_content_hash(dir);

    Ok(CachedPlugin {
        info: ExternalPluginInfo {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            main: m.main,
            background: m.background,
            settings: m.settings,
            icon: m.icon,
            sidecar: m.sidecar,
            events: m.events,
            enabled,
            enabled_by_default: m.enabled_by_default,
            dir: dir.to_string_lossy().to_string(),
            has_ui: main_abs.is_some(),
            has_background: background_abs.is_some(),
            has_settings: settings_abs.is_some(),
            content_mtime_ms,
            anomalous: false,
            error: None,
        },
        dir: dir.to_path_buf(),
        main_abs,
        background_abs,
        settings_abs,
        icon_abs,
        sidecar,
        content_hash,
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

fn skip_plugin_hash_entry(name: &str) -> bool {
    name == "."
        || name == ".."
        || name == ".git"
        || name == "node_modules"
        || name == "runtime"
        || name.starts_with('.')
}

/// Short content hash of the installed package (what actually runs from app_data).
/// Skips .git / node_modules / runtime / dotfiles so sidecar state does not churn the hash.
fn plugin_content_hash(dir: &Path) -> String {
    use sha2::Digest;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    collect_plugin_hash_files(dir, dir, &mut files);
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = sha2::Sha256::new();
    for (rel, bytes) in files {
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        hasher.update(&bytes);
        hasher.update([0u8]);
    }
    let hex = format!("{:x}", hasher.finalize());
    hex.chars().take(12).collect()
}

fn collect_plugin_hash_files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if skip_plugin_hash_entry(&name) {
            continue;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            collect_plugin_hash_files(root, &path, out);
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.len() > 1024 * 1024 {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        out.push((rel, bytes));
    }
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
    // Entry-file stats (len:mtime_ms, in args order) so script edits change the
    // fingerprint like the background entry does (ADR sidecar-runtime #6).
    let entry_stats: Vec<String> = args
        .iter()
        .filter(|a| !a.starts_with('-') && !a.contains("..") && !Path::new(a).is_absolute())
        .filter_map(|a| fs::metadata(cwd.join(a)).ok())
        .map(|meta| {
            let len = meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or_default();
            format!("{len}:{modified}")
        })
        .collect();
    format!(
        "{version}:{command}:{args:?}:{}:{env_pairs:?}:{entry_stats:?}",
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

/// Resolve a plugin's optional icon entry. Must be a relative path inside the
/// plugin directory pointing at an existing file (png/jpg/svg/webp/ico).
/// Optional: a missing/anonymous icon field yields None, never a scan error.
fn resolve_icon(dir: &Path, entry: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(entry) = entry.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if entry.contains("..") || Path::new(entry).is_absolute() {
        return Err("icon must be a relative path inside the plugin directory".into());
    }
    let abs = dir
        .join(entry)
        .canonicalize()
        .map_err(|e| format!("icon path resolve failed: {e}"))?;
    let root = dir
        .canonicalize()
        .map_err(|e| format!("plugin root resolve failed: {e}"))?;
    if !abs.starts_with(&root) {
        return Err("icon escapes plugin directory".into());
    }
    if !abs.is_file() {
        return Err(format!("icon file not found: {entry}"));
    }
    if !matches!(
        abs.extension()
            .and_then(|m| m.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "svg" | "webp" | "ico"
    ) {
        return Err(format!("unsupported icon file type: {entry}"));
    }
    Ok(Some(abs))
}

#[cfg(test)]
mod icon_tests {
    use super::resolve_icon;

    #[test]
    fn icon_resolution_checks_traversal_and_type() {
        let tmp = std::env::temp_dir().join(format!("catrace-icon-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let plugin = tmp.join("demo");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(plugin.join("icon.svg"), "<svg/>").unwrap();
        std::fs::write(plugin.join("evil.txt"), "x").unwrap();

        // Valid: relative icon inside the plugin dir.
        let got = resolve_icon(&plugin, Some("icon.svg")).unwrap();
        assert!(got.is_some());

        // Directory traversal and absolute paths are rejected.
        assert!(resolve_icon(&plugin, Some("../evil.txt")).is_err());
        let abs = plugin.join("icon.svg").to_string_lossy().to_string();
        assert!(resolve_icon(&plugin, Some(&abs)).is_err());

        // Unsupported extension rejected; missing field OK.
        assert!(resolve_icon(&plugin, Some("evil.txt")).is_err());
        assert!(resolve_icon(&plugin, None).unwrap().is_none());

        let _ = std::fs::remove_dir_all(&tmp);
    }
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
    use super::{sidecar_fingerprint, sidecar_spec, PluginSidecarManifest};
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

    #[test]
    fn sidecar_fingerprint_tracks_entry_file_changes() {
        let dir = std::env::temp_dir().join(format!("catrace-fp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let entry = dir.join("main.mjs");
        std::fs::write(&entry, "console.log(1)").unwrap();
        let fp1 = sidecar_fingerprint("1", "node", &["main.mjs".into()], &dir, &HashMap::new());
        std::fs::write(&entry, "console.log(1); console.log(2)").unwrap();
        let fp2 = sidecar_fingerprint("1", "node", &["main.mjs".into()], &dir, &HashMap::new());
        let fp3 = sidecar_fingerprint("1", "node", &["main.mjs".into()], &dir, &HashMap::new());
        assert_ne!(
            fp1, fp2,
            "entry file edit must change the sidecar fingerprint"
        );
        assert_eq!(
            fp2, fp3,
            "identical state must produce an identical fingerprint"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn list_external_plugins(
    app: AppHandle,
    mgr: State<'_, PluginManager>,
    windows: State<'_, crate::plugin_window::PluginWindowManager>,
    sidecars: State<'_, crate::plugin_sidecar::PluginSidecarManager>,
    restart_sidecars: Option<bool>,
) -> Result<Vec<ExternalPluginInfo>, String> {
    let list = mgr.rescan(&app)?;

    windows.schedule_sync(app.clone(), mgr.inner().clone());
    // Reload button: restart every enabled sidecar. Other list/rescans only
    // start missing / stop disabled / replace crashed — never bounce healthy ones.
    if restart_sidecars.unwrap_or(false) {
        sidecars.schedule_sync_force(app.clone(), mgr.inner().clone());
    } else {
        sidecars.schedule_sync(app.clone(), mgr.inner().clone());
    }
    Ok(list)
}

/// 迁移期「插件中心」只读目录：列出已安装插件，不加载、不运行、不写缓存。
#[tauri::command]
pub fn list_plugin_catalog(app: AppHandle) -> Result<Vec<PluginCatalogEntry>, String> {
    scan_catalog(&app)
}

#[tauri::command]
pub async fn set_external_plugin_enabled(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    enabled: bool,
) -> Result<ExternalPluginInfo, String> {
    ensure_management_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _mutation = PLUGIN_MUTATION.lock().map_err(|e| e.to_string())?;
        let mgr = app.state::<PluginManager>();
        let windows = app.state::<crate::plugin_window::PluginWindowManager>();
        let sidecars = app.state::<crate::plugin_sidecar::PluginSidecarManager>();
        mgr.rescan(&app)?;
        let info = mgr.set_enabled(&app, &id, enabled)?;
        let result = sidecars
            .sync_plugin(&app, &mgr, &id)
            .and_then(|_| windows.sync_plugin(&app, &mgr, &id));
        if let Err(error) = result {
            // A failed enable never leaves an apparently enabled but unstarted package.
            if enabled {
                mgr.set_enabled(&app, &id, false)?;
                let _ = sidecars.sync_plugin(&app, &mgr, &id);
                let _ = windows.stop_plugin(&app, &id);
            }
            return Err(format!("plugin runtime synchronization failed: {error}"));
        }
        let _ = app.emit(
            "plugin-enabled-changed",
            serde_json::json!({ "id": id, "enabled": enabled }),
        );
        Ok(info)
    })
    .await
    .map_err(|e| format!("plugin toggle task failed: {e}"))?
}

pub(crate) fn ensure_management_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("plugin management is only available from the main window".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn uninstall_external_plugin(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    ensure_management_window(&window)?;
    validate_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _mutation = PLUGIN_MUTATION.lock().map_err(|e| e.to_string())?;
        let root = mutation_root(&app)?;
        let dest = root.join(&id);
        fs::symlink_metadata(&dest).map_err(|e| format!("plugin not installed ({id}): {e}"))?;
        let mgr = app.state::<PluginManager>();
        let windows = app.state::<crate::plugin_window::PluginWindowManager>();
        let sidecars = app.state::<crate::plugin_sidecar::PluginSidecarManager>();
        // Revoke capability before stopping processes or touching files. Works for invalid manifests too.
        crate::plugin_config::set_plugin_config_entry(
            &app,
            &id,
            "enabled".into(),
            serde_json::Value::Bool(false),
        )?;
        mgr.rescan(&app)?;
        sidecars.sync_plugin(&app, &mgr, &id)?;
        windows.stop_plugin(&app, &id)?;
        let tombstone = root.join(format!(".uninstall-{id}-{}", uuid::Uuid::new_v4()));
        fs::rename(&dest, &tombstone).map_err(|e| format!("stage uninstall: {e}"))?;
        if let Err(error) = remove_path_all(&tombstone) {
            let restore = fs::rename(&tombstone, &dest);
            mgr.rescan(&app)?;
            return Err(format!(
                "uninstall cleanup failed: {error}; restore result: {restore:?}"
            ));
        }
        mgr.rescan(&app)?;
        let _ = app.emit("plugins-reloaded", serde_json::json!({}));
        // Keep user settings for a deliberate reinstall, but trust remains disabled.
        Ok(())
    })
    .await
    .map_err(|e| format!("plugin uninstall task failed: {e}"))?
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

/// Plugin icon as a data URL (base64), for the plugin list/header without
/// exposing the raw path. Available for installed plugins even when disabled.
#[tauri::command]
pub fn get_plugin_icon_data_url(
    mgr: State<'_, PluginManager>,
    id: String,
) -> Result<String, String> {
    mgr.icon_data_url(&id)
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
        if let Some(prev) =
            crate::plugin_config::get_plugin_config_entry(&app, &plugin_id, "enabled")?
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
    // Settings panel only loads config on mount; toast "block app" writes via
    // another window — notify so open settings.mjs can refresh blacklist UI.
    let _ = app.emit(
        "catrace:plugin-config-changed",
        serde_json::json!({ "pluginId": plugin_id }),
    );
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

pub(crate) fn install_from_source(
    app: &AppHandle,
    mgr: &PluginManager,
    windows: &crate::plugin_window::PluginWindowManager,
    sidecars: &crate::plugin_sidecar::PluginSidecarManager,
    source: &Path,
    overwrite: bool,
    expected_id: Option<&str>,
) -> Result<PluginInstallResult, String> {
    let _mutation = PLUGIN_MUTATION.lock().map_err(|e| e.to_string())?;
    if source.as_os_str().is_empty() {
        return Err("source path is empty".into());
    }
    if !source.exists() {
        return Err(format!("path not found: {}", source.display()));
    }

    let root = mutation_root(app)?;

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
        let payload = staging.join("payload");
        fs::create_dir(&payload).map_err(|e| format!("create package staging: {e}"))?;
        if source.is_file() {
            unpack_plugin_zip(source, &payload)?;
        } else if source.is_dir() {
            copy_dir_filtered(source, &payload)?;
        } else {
            return Err(format!("unsupported path type: {}", source.display()));
        }

        let package_root = find_plugin_package_root(&payload)?;
        let manifest = read_install_manifest(&package_root)?;
        validate_id(&manifest.id)?;
        if manifest.name.trim().is_empty() {
            return Err("manifest name is required".into());
        }
        if manifest.version.trim().is_empty() {
            return Err("manifest version is required".into());
        }
        if expected_id.is_some_and(|id| id != manifest.id) {
            return Err("downloaded manifest does not match the selected plugin".into());
        }
        // Validate every declared entry before changing an existing installation.
        let validation_dir = staging.join(".validated").join(&manifest.id);
        fs::create_dir_all(validation_dir.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::rename(&package_root, &validation_dir)
            .map_err(|e| format!("stage package validation: {e}"))?;
        load_one(app, &validation_dir)?;
        let package_root = validation_dir;

        let dest = root.join(&manifest.id);
        let overwritten = fs::symlink_metadata(&dest).is_ok();
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

        // Installation never grants trust, including overwrite/reinstall.
        crate::plugin_config::set_plugin_config_entry(
            app,
            &manifest.id,
            "enabled".into(),
            serde_json::Value::Bool(false),
        )?;
        if overwritten {
            mgr.rescan(app)?;
            sidecars.sync_plugin(app, mgr, &manifest.id)?;
            windows.stop_plugin(app, &manifest.id)?;
        }
        publish_package(&package_root, &dest)?;

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

    let cleanup = remove_path_all(&staging);
    let result = match install_result {
        Ok(result) => result,
        Err(error) => {
            return Err(match cleanup {
                Ok(()) => error,
                Err(cleanup) => format!("{error}; staging cleanup also failed: {cleanup}"),
            })
        }
    };
    mgr.rescan(app)?;
    let _ = app.emit("plugins-reloaded", serde_json::json!({}));
    cleanup.map_err(|e| format!("plugin installed, but staging cleanup failed: {e}"))?;
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
        0 => {
            Err("no manifest.json found in package (folder or zip root / one nested folder)".into())
        }
        _ => Err("multiple plugin packages found; package must contain a single plugin".into()),
    }
}

fn safe_archive_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.len() > 1024
        || name.contains(['\\', ':', '\0'])
        || name.starts_with('/')
    {
        return Err(format!("unsafe archive path: {name}"));
    }
    let trimmed = name.trim_end_matches('/');
    let parts: Vec<_> = trimmed.split('/').collect();
    if parts.len() > 32
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.ends_with(['.', ' '])
                || part.chars().any(char::is_control)
                || matches!(
                    part.split('.')
                        .next()
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                        .as_str(),
                    "con"
                        | "prn"
                        | "aux"
                        | "nul"
                        | "com1"
                        | "com2"
                        | "com3"
                        | "com4"
                        | "com5"
                        | "com6"
                        | "com7"
                        | "com8"
                        | "com9"
                        | "lpt1"
                        | "lpt2"
                        | "lpt3"
                        | "lpt4"
                        | "lpt5"
                        | "lpt6"
                        | "lpt7"
                        | "lpt8"
                        | "lpt9"
                )
        })
    {
        return Err(format!("unsafe archive path: {name}"));
    }
    Ok(parts.iter().collect())
}

pub(crate) fn unpack_plugin_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
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
    if archive.len() > MAX_INSTALL_FILE_COUNT {
        return Err(format!(
            "zip has too many entries (max {MAX_INSTALL_FILE_COUNT})"
        ));
    }
    let mut seen = std::collections::HashSet::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;
        let name = entry.name().to_string();
        let rel = safe_archive_path(&name)?;
        if !seen.insert(name.trim_end_matches('/').to_ascii_lowercase()) {
            return Err(format!("duplicate archive path: {name}"));
        }
        let mode = entry.unix_mode().unwrap_or(0);
        if !matches!(mode & 0o170000, 0 | 0o100000 | 0o040000) {
            return Err(format!(
                "archive links/special files are not allowed: {name}"
            ));
        }
        if entry.size() > MAX_INSTALL_UNPACKED_BYTES.saturating_sub(total_unpacked) {
            return Err("unpacked size too large (max 128 MiB)".into());
        }
        let out_path = dest.join(&rel);
        if !out_path.starts_with(dest) {
            return Err(format!("zip path escaped dest: {name}"));
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("mkdir {}: {e}", out_path.display()))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut outfile = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&out_path)
            .map_err(|e| format!("create {}: {e}", out_path.display()))?;
        use std::io::Read;
        let remaining = MAX_INSTALL_UNPACKED_BYTES.saturating_sub(total_unpacked);
        let written = std::io::copy(&mut (&mut entry).take(remaining + 1), &mut outfile)
            .map_err(|e| format!("extract {}: {e}", out_path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // Preserve executable bits, never setuid/setgid/sticky permissions.
            fs::set_permissions(
                &out_path,
                fs::Permissions::from_mode((mode & 0o111) | 0o600),
            )
            .map_err(|e| format!("set extracted permissions: {e}"))?;
        }
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
    copy_dir_filtered_inner(src, dest, &mut file_count, &mut total, 0)
}

fn copy_dir_filtered_inner(
    src: &Path,
    dest: &Path,
    file_count: &mut usize,
    total: &mut u64,
    depth: usize,
) -> Result<(), String> {
    if depth > 32 {
        return Err("package directory nesting exceeds 32 levels".into());
    }
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read dir entry: {e}"))?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name == "." || name == ".." || name == ".git" || name == "node_modules" {
            continue;
        }
        safe_archive_path(&name)?;
        let from = entry.path();
        let to = dest.join(&file_name);
        let meta =
            fs::symlink_metadata(&from).map_err(|e| format!("stat {}: {e}", from.display()))?;
        if is_link(&meta) {
            return Err(format!("package links are not allowed: {}", from.display()));
        }
        let ft = meta.file_type();
        *file_count += 1;
        if *file_count > MAX_INSTALL_FILE_COUNT {
            return Err("package has too many entries (max 5000)".into());
        }
        if ft.is_dir() {
            fs::create_dir_all(&to).map_err(|e| format!("mkdir {}: {e}", to.display()))?;
            copy_dir_filtered_inner(&from, &to, file_count, total, depth + 1)?;
        } else if ft.is_file() {
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

fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions (mount points), not just symbolic links.
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

pub(crate) fn mutation_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = plugins_root(app)?;
    ensure_writable_root(&root)?;
    Ok(root)
}

fn ensure_writable_root(root: &Path) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(root) {
        if is_link(&meta) {
            return Err("插件根目录是 junction/符号链接，已拒绝安装或卸载以保护源码。请先手动断开根目录链接并创建普通 plugins 目录（不会自动迁移或删除目标）。".into());
        }
    }
    fs::create_dir_all(root).map_err(|e| format!("create plugins dir: {e}"))
}

/// Never follow links, even nested junctions or dangling links.
pub(crate) fn remove_path_all(path: &Path) -> Result<(), String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("stat {}: {e}", path.display())),
    };
    if is_link(&meta) {
        // remove_dir unlinks Windows directory junctions; Unix symlinks use remove_file.
        fs::remove_file(path)
            .or_else(|_| fs::remove_dir(path))
            .map_err(|e| format!("remove link {}: {e}", path.display()))?;
    } else if meta.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| format!("read {}: {e}", path.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            remove_path_all(&entry.path())?;
        }
        fs::remove_dir(path).map_err(|e| format!("remove dir {}: {e}", path.display()))?;
    } else {
        fs::remove_file(path).map_err(|e| format!("remove file {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Rename old install aside; restore it if publication fails. Never delete old files first.
fn publish_package(staged: &Path, dest: &Path) -> Result<(), String> {
    let parent = dest.parent().ok_or("plugin destination has no parent")?;
    let backup = parent.join(format!(".install-backup-{}", uuid::Uuid::new_v4()));
    let existed = fs::symlink_metadata(dest).is_ok();
    if existed {
        fs::rename(dest, &backup).map_err(|e| format!("backup previous plugin: {e}"))?;
    }
    if let Err(error) = fs::rename(staged, dest) {
        if existed {
            fs::rename(&backup, dest).map_err(|restore| format!("install failed: {error}; restoring previous plugin failed: {restore} (backup: {})", backup.display()))?;
        }
        return Err(format!("install rename failed: {error}"));
    }
    if existed {
        remove_path_all(&backup)
            .map_err(|e| format!("plugin installed, but previous package cleanup failed: {e}"))?;
    }
    Ok(())
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon(a) == canon(b)
}

#[cfg(test)]
mod content_hash_tests {
    use super::plugin_content_hash;

    #[test]
    fn same_files_same_hash() {
        let dir = std::env::temp_dir().join(format!("catrace-hash-a-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("manifest.json"), r#"{"id":"x","version":"0.1.0"}"#).unwrap();
        std::fs::write(dir.join("background.mjs"), "console.log(1)").unwrap();
        let a = plugin_content_hash(&dir);
        let b = plugin_content_hash(&dir);
        assert_eq!(a.len(), 12);
        assert_eq!(a, b);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn content_change_changes_hash() {
        let dir = std::env::temp_dir().join(format!("catrace-hash-b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("background.mjs"), "console.log(1)").unwrap();
        let before = plugin_content_hash(&dir);
        std::fs::write(dir.join("background.mjs"), "console.log(2)").unwrap();
        let after = plugin_content_hash(&dir);
        assert_ne!(before, after);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn runtime_and_node_modules_do_not_affect_hash() {
        let dir = std::env::temp_dir().join(format!("catrace-hash-c-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("runtime")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("background.mjs"), "ok").unwrap();
        let before = plugin_content_hash(&dir);
        std::fs::write(dir.join("runtime/state.json"), "{\"n\":1}").unwrap();
        std::fs::write(dir.join("node_modules/x/index.js"), "nope").unwrap();
        let after = plugin_content_hash(&dir);
        assert_eq!(before, after);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod install_safety_tests {
    use super::*;
    use std::io::Write;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("catrace-install-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = remove_path_all(&self.0);
        }
    }

    fn zip_file(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
        let path = dir.join("package.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        zip.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(data).unwrap();
        zip.finish().unwrap();
        path
    }

    #[test]
    fn disabled_plugins_never_supply_runtime_specs_or_executable_source() {
        let mgr = PluginManager::new();
        let dir = PathBuf::from("/plugins/demo");
        let manifest = PluginSidecarManifest {
            command: "node".into(),
            args: vec![],
            cwd: ".".into(),
            env: HashMap::new(),
        };
        mgr.inner.lock().unwrap().plugins.push(CachedPlugin {
            info: ExternalPluginInfo {
                id: "demo".into(),
                name: "Demo".into(),
                version: "1".into(),
                description: String::new(),
                main: Some("ui.mjs".into()),
                background: Some("background.mjs".into()),
                settings: Some("settings.mjs".into()),
                icon: None,
                sidecar: Some(manifest.clone()),
                events: vec!["demo".into()],
                enabled: false,
                enabled_by_default: true,
                dir: dir.to_string_lossy().into(),
                has_ui: true,
                has_background: true,
                has_settings: true,
                content_mtime_ms: 0,
                anomalous: false,
                error: None,
            },
            dir: dir.clone(),
            main_abs: Some(dir.join("ui.mjs")),
            background_abs: Some(dir.join("background.mjs")),
            settings_abs: Some(dir.join("settings.mjs")),
            icon_abs: None,
            sidecar: Some(sidecar_spec(&dir, "demo", "1", &manifest)),
            content_hash: String::new(),
        });
        assert!(mgr.background_plugins().unwrap().is_empty());
        assert!(mgr.sidecar_plugins().unwrap().is_empty());
        assert!(mgr
            .settings_source("demo")
            .unwrap_err()
            .contains("disabled"));
        assert!(mgr
            .background_source("demo")
            .unwrap_err()
            .contains("disabled"));
        assert!(mgr.ui_path("demo").unwrap_err().contains("disabled"));
        assert!(mgr
            .allows_event("demo", "demo", "demo.tick")
            .unwrap_err()
            .contains("disabled"));
    }

    #[test]
    fn identifiers_are_portable_and_cannot_replace_host_plugins() {
        for id in [
            "", "../timer", "Timer", "con", "com1", "nul", "rest", "agent", "sdk", "a/b",
        ] {
            assert!(validate_id(id).is_err(), "{id}");
        }
        for id in ["timer", "agent-notify", "dsh-chat"] {
            assert!(validate_id(id).is_ok());
        }
    }

    #[test]
    fn archive_paths_reject_cross_platform_escapes_and_aliases() {
        for name in [
            "../evil",
            "a/../../evil",
            "/absolute",
            "C:/evil",
            "a\\evil",
            "a:stream",
            "a/./b",
            "a//b",
            "CON.txt",
            "folder./x",
            "space /x",
            "a\0b",
        ] {
            assert!(safe_archive_path(name).is_err(), "{name:?}");
        }
        assert_eq!(
            safe_archive_path("timer/runtime/main.mjs").unwrap(),
            PathBuf::from("timer/runtime/main.mjs")
        );
        assert!(safe_archive_path(&format!("{}x", "a/".repeat(33))).is_err());
    }

    #[test]
    fn archive_traversal_cannot_write_outside_staging() {
        let work = TempDir::new();
        let archive = zip_file(&work.0, "../outside.txt", b"unsafe");
        let dest = work.0.join("out");
        fs::create_dir(&dest).unwrap();
        assert!(unpack_plugin_zip(&archive, &dest).is_err());
        assert!(!work.0.join("outside.txt").exists());
    }

    #[test]
    fn archive_size_is_rejected_before_writing_file() {
        let work = TempDir::new();
        let archive = zip_file(
            &work.0,
            "large.bin",
            &vec![0u8; MAX_INSTALL_UNPACKED_BYTES as usize + 1],
        );
        let dest = work.0.join("out");
        fs::create_dir(&dest).unwrap();
        assert!(unpack_plugin_zip(&archive, &dest)
            .unwrap_err()
            .contains("size too large"));
        assert!(!dest.join("large.bin").exists());
    }

    #[test]
    fn failed_publication_restores_previous_package() {
        let work = TempDir::new();
        let dest = work.0.join("demo");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("keep.txt"), "original").unwrap();
        assert!(publish_package(&work.0.join("missing"), &dest).is_err());
        assert_eq!(
            fs::read_to_string(dest.join("keep.txt")).unwrap(),
            "original"
        );
        assert_eq!(fs::read_dir(&work.0).unwrap().count(), 1);
    }

    #[test]
    fn successful_publication_swaps_complete_package() {
        let work = TempDir::new();
        let dest = work.0.join("demo");
        let staged = work.0.join("staged");
        fs::create_dir(&dest).unwrap();
        fs::create_dir(&staged).unwrap();
        fs::write(dest.join("old"), "old").unwrap();
        fs::write(staged.join("new"), "new").unwrap();
        publish_package(&staged, &dest).unwrap();
        assert!(!dest.join("old").exists());
        assert!(dest.join("new").is_file());
        assert_eq!(fs::read_dir(&work.0).unwrap().count(), 1);
    }

    #[cfg(any(unix, windows))]
    fn directory_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "test junction creation failed");
        }
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn unlink_never_deletes_source_and_linked_root_is_rejected() {
        let work = TempDir::new();
        let source = work.0.join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("keep.txt"), "source").unwrap();
        let linked_root = work.0.join("linked-root");
        directory_link(&source, &linked_root);
        assert!(ensure_writable_root(&linked_root).is_err());
        remove_path_all(&linked_root).unwrap();
        assert!(source.join("keep.txt").is_file());
        let package = work.0.join("package");
        fs::create_dir(&package).unwrap();
        directory_link(&source, &package.join("nested-junction"));
        remove_path_all(&package).unwrap();
        assert_eq!(
            fs::read_to_string(source.join("keep.txt")).unwrap(),
            "source"
        );
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn local_package_copy_refuses_nested_links() {
        let work = TempDir::new();
        let source = work.0.join("source");
        fs::create_dir(&source).unwrap();
        let package = work.0.join("package");
        fs::create_dir(&package).unwrap();
        directory_link(&source, &package.join("external"));
        assert!(copy_dir_filtered(&package, &work.0.join("copy"))
            .unwrap_err()
            .contains("links are not allowed"));
    }
}

/// Startup scans only user installations; no bundled packages or demo links are created.
pub fn initial_scan(app: &AppHandle, mgr: &PluginManager) {
    if let Err(e) = mgr.rescan(app) {
        log_error!("plugins", "initial scan failed: {e}");
    } else {
        mgr.log_loaded_plugins();
    }
}
