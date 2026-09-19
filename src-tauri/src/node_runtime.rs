//! Portable Node.js runtime for plugins whose sidecar runs `node`.
//!
//! Detection rides on `sidecar::command::find_program`, which consults the
//! host-managed bin dirs registered in setup. The installer downloads the
//! pinned LTS zip, extracts it into `app_data/runtime/node` and swaps it in
//! atomically — no admin rights, no system PATH mutation, no app restart:
//! the next sidecar spawn resolves `node` from the managed dir.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Node LTS pinned by the host; version upgrades ride host releases.
pub const NODE_VERSION: &str = "v22.20.0";

const PROGRESS_EVENT: &str = "node-install-progress";
const DOWNLOAD_CHUNK_EMIT: u64 = 256 * 1024;

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRuntimeStatus {
    pub available: bool,
    pub path: Option<String>,
    /// Pinned version the installer would provision (not the detected binary's).
    pub version: String,
    pub installing: bool,
}

pub fn runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("runtime").join("node"))
}

pub fn status(_app: &AppHandle) -> NodeRuntimeStatus {
    let found = crate::sidecar::find_program("node");
    NodeRuntimeStatus {
        available: found.is_some(),
        path: found.map(|p| p.to_string_lossy().into_owned()),
        version: NODE_VERSION.to_string(),
        installing: INSTALLING.load(Ordering::SeqCst),
    }
}

/// Zip asset for the current platform; `None` = auto-install not supported.
fn asset_name() -> Option<String> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        Some(format!("node-{NODE_VERSION}-win-x64.zip"))
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        None
    }
}

fn download_urls(asset: &str) -> Vec<String> {
    vec![
        // Mirror first (fast in CN), official dist as fallback.
        format!("https://npmmirror.com/mirrors/node/{NODE_VERSION}/{asset}"),
        format!("https://nodejs.org/dist/{NODE_VERSION}/{asset}"),
    ]
}

async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest: &Path,
) -> Result<u64, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GET {url}: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut resp = resp;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    loop {
        let chunk = resp.chunk().await.map_err(|e| format!("read {url}: {e}"))?;
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk)
            .map_err(|e| format!("write {}: {e}", dest.display()))?;
        received += chunk.len() as u64;
        if received.saturating_sub(last_emit) >= DOWNLOAD_CHUNK_EMIT {
            last_emit = received;
            app.emit(PROGRESS_EVENT, ProgressPayload { received, total })
                .ok();
        }
    }
    file.flush().ok();
    app.emit(PROGRESS_EVENT, ProgressPayload { received, total })
        .ok();
    if total != 0 && received != total {
        return Err(format!("download truncated: {received}/{total} bytes"));
    }
    Ok(received)
}

/// Extract the node zip into `staging`, then swap the single top-level dir
/// into `final_dir` (replacing any stale install).
fn extract_and_swap(zip_path: &Path, staging: &Path, final_dir: &Path) -> Result<(), String> {
    if staging.exists() {
        std::fs::remove_dir_all(staging)
            .map_err(|e| format!("clean staging {}: {e}", staging.display()))?;
    }
    std::fs::create_dir_all(staging)
        .map_err(|e| format!("create {}: {e}", staging.display()))?;

    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("open {}: {e}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("read zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out_path = staging.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("mkdir {}: {e}", out_path.display()))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create {}: {e}", out_path.display()))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("extract {}: {e}", out_path.display()))?;
        }
    }

    // The zip wraps everything in node-vX.Y.Z-win-x64/ — find it.
    let top = std::fs::read_dir(staging)
        .map_err(|e| format!("read {}: {e}", staging.display()))?
        .filter_map(|e| e.ok())
        .find(|e| e.path().is_dir())
        .map(|e| e.path())
        .ok_or_else(|| "zip has no top-level directory".to_string())?;

    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    if final_dir.exists() {
        std::fs::remove_dir_all(final_dir)
            .map_err(|e| format!("replace {}: {e}", final_dir.display()))?;
    }
    std::fs::rename(&top, final_dir)
        .map_err(|e| format!("activate {}: {e}", final_dir.display()))?;
    std::fs::remove_dir_all(staging).ok();
    std::fs::write(final_dir.join(".catrace-node"), NODE_VERSION).ok();
    Ok(())
}

#[tauri::command]
pub fn get_node_runtime_status(app: AppHandle) -> NodeRuntimeStatus {
    status(&app)
}

#[tauri::command]
pub async fn install_node_runtime(app: AppHandle) -> Result<(), String> {
    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("node_runtime_already_installing".into());
    }
    let result = install_inner(&app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn install_inner(app: &AppHandle) -> Result<(), String> {
    let Some(asset) = asset_name() else {
        return Err("node_runtime_platform_unsupported".into());
    };
    let Some(runtime_root) = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("runtime"))
    else {
        return Err("node_runtime_no_app_data_dir".into());
    };
    let downloads = runtime_root.join("downloads");
    std::fs::create_dir_all(&downloads)
        .map_err(|e| format!("mkdir {}: {e}", downloads.display()))?;
    let zip_path = downloads.join(&asset);

    let urls = download_urls(&asset);
    let mut last_err = String::new();
    for url in &urls {
        match download_with_progress(app, url, &zip_path).await {
            Ok(_) => break,
            Err(e) => {
                crate::log_warn!("node_runtime", "download failed from {url}: {e}");
                last_err = e;
                std::fs::remove_file(&zip_path).ok();
            }
        }
    }
    if !zip_path.exists() {
        return Err(format!("node_runtime_download_failed: {last_err}"));
    }

    let staging = runtime_root.join(".node-stage");
    let final_dir = runtime_root.join("node");
    if let Err(e) = extract_and_swap(&zip_path, &staging, &final_dir) {
        crate::log_error!("node_runtime", "extract failed: {e}");
        return Err(format!("node_runtime_extract_failed: {e}"));
    }
    std::fs::remove_file(&zip_path).ok();

    if crate::sidecar::find_program("node").is_none() {
        return Err("node_runtime_missing_after_install".into());
    }
    crate::log_info!("node_runtime", "portable node {NODE_VERSION} installed");
    Ok(())
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    received: u64,
    total: u64,
}
