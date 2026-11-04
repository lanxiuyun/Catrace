//! Official repository catalog. Only fixed GitHub endpoints and immutable commits are accepted.
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::plugins::{self, PluginInstallResult, PluginManager, PluginManifestFile};

const API: &str = "https://api.github.com/repos/lanxiuyun/catrace-plugin";
const RAW: &str = "https://raw.githubusercontent.com/lanxiuyun/catrace-plugin";
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PLUGINS: usize = 128;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPluginInfo {
    id: String,
    name: String,
    version: String,
    description: String,
    has_ui: bool,
    has_background: bool,
    has_settings: bool,
    has_sidecar: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCatalog {
    commit: String,
    plugins: Vec<RepositoryPluginInfo>,
}

#[derive(Deserialize)]
struct Commit {
    sha: String,
}
#[derive(Deserialize)]
struct Tree {
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}
#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    mode: String,
}

fn validate_commit(commit: &str) -> Result<(), String> {
    if commit.len() != 40 || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("repository commit must be a full 40-character SHA".into());
    }
    Ok(())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Catrace-Plugin-Center")
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("create repository client: {e}"))
}

async fn fetch_bytes(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("repository request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "repository request returned HTTP {} (GitHub may be unavailable or rate-limited)",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err(format!("repository response exceeds {} bytes", limit));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("repository download failed: {e}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(format!("repository response exceeds {} bytes", limit));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn manifest_ids(tree: Tree) -> Result<Vec<String>, String> {
    if tree.truncated {
        return Err("repository tree is truncated; cannot safely enumerate plugins".into());
    }
    let mut ids = Vec::new();
    for entry in tree.tree {
        let Some(id) = entry.path.strip_suffix("/manifest.json") else {
            continue;
        };
        // Only direct children of the fixed repository root are plugin packages.
        if id.contains('/') || entry.kind != "blob" || entry.mode != "100644" {
            continue;
        }
        plugins::validate_id(id)?;
        ids.push(id.to_string());
    }
    ids.sort();
    ids.dedup();
    if ids.len() > MAX_PLUGINS {
        return Err("repository contains too many plugins".into());
    }
    Ok(ids)
}

async fn catalog_at(client: &reqwest::Client, commit: String) -> Result<RepositoryCatalog, String> {
    validate_commit(&commit)?;
    let tree: Tree = serde_json::from_slice(
        &fetch_bytes(
            client,
            &format!("{API}/git/trees/{commit}?recursive=1"),
            MAX_JSON_BYTES,
        )
        .await?,
    )
    .map_err(|e| format!("invalid repository tree: {e}"))?;
    let ids = manifest_ids(tree)?;
    let mut entries = Vec::new();
    // Bound concurrency to four; do not make one network round trip per row serially.
    for batch in ids.chunks(4) {
        let mut requests = tokio::task::JoinSet::new();
        for id in batch {
            let (client, commit, id) = (client.clone(), commit.clone(), id.clone());
            requests.spawn(async move { fetch_manifest(&client, &commit, &id).await });
        }
        while let Some(result) = requests.join_next().await {
            let manifest = result.map_err(|e| format!("repository catalog task failed: {e}"))??;
            entries.push(RepositoryPluginInfo {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                has_ui: manifest.main.is_some(),
                has_background: manifest.background.is_some(),
                has_settings: manifest.settings.is_some(),
                has_sidecar: manifest.sidecar.is_some(),
            });
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(RepositoryCatalog {
        commit,
        plugins: entries,
    })
}

async fn fetch_manifest(
    client: &reqwest::Client,
    commit: &str,
    id: &str,
) -> Result<PluginManifestFile, String> {
    let bytes = fetch_bytes(
        client,
        &format!("{RAW}/{commit}/{id}/manifest.json"),
        64 * 1024,
    )
    .await?;
    let manifest: PluginManifestFile =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid manifest for {id}: {e}"))?;
    plugins::validate_id(&manifest.id)?;
    if manifest.id != id || manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
        return Err(format!("invalid repository manifest identity: {id}"));
    }
    Ok(manifest)
}

#[tauri::command]
pub async fn list_repository_plugins(
    window: tauri::WebviewWindow,
) -> Result<RepositoryCatalog, String> {
    plugins::ensure_management_window(&window)?;
    current_catalog().await
}

async fn current_catalog() -> Result<RepositoryCatalog, String> {
    let client = client()?;
    let head: Commit = serde_json::from_slice(
        &fetch_bytes(&client, &format!("{API}/commits/HEAD"), MAX_JSON_BYTES).await?,
    )
    .map_err(|e| format!("invalid repository HEAD: {e}"))?;
    catalog_at(&client, head.sha).await
}

#[tauri::command]
pub async fn install_repository_plugin(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    commit: String,
) -> Result<PluginInstallResult, String> {
    plugins::ensure_management_window(&window)?;
    plugins::mutation_root(&app)?;
    plugins::validate_id(&id)?;
    validate_commit(&commit)?;
    let client = client()?;
    // Verify membership at this immutable commit, not the current moving HEAD.
    let tree: Tree = serde_json::from_slice(
        &fetch_bytes(
            &client,
            &format!("{API}/git/trees/{commit}?recursive=1"),
            MAX_JSON_BYTES,
        )
        .await?,
    )
    .map_err(|e| format!("invalid repository tree: {e}"))?;
    if !manifest_ids(tree)?.contains(&id) {
        return Err(format!("plugin not present in repository commit: {id}"));
    }
    fetch_manifest(&client, &commit, &id).await?;
    let bytes = fetch_bytes(
        &client,
        &format!("https://codeload.github.com/lanxiuyun/catrace-plugin/zip/{commit}"),
        MAX_ARCHIVE_BYTES,
    )
    .await?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = plugins::mutation_root(&app)?;
        let work = root.join(format!(".repository-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&work).map_err(|e| format!("create repository staging: {e}"))?;
        let result = (|| {
            let archive = work.join("repository.zip");
            std::fs::write(&archive, bytes).map_err(|e| format!("save repository archive: {e}"))?;
            let unpacked = work.join("unpacked");
            std::fs::create_dir(&unpacked)
                .map_err(|e| format!("create extraction staging: {e}"))?;
            plugins::unpack_plugin_zip(&archive, &unpacked)?;
            let package = repository_package(&unpacked, &commit, &id)?;
            let mgr = app.state::<PluginManager>();
            let windows = app.state::<crate::plugin_window::PluginWindowManager>();
            let sidecars = app.state::<crate::plugin_sidecar::PluginSidecarManager>();
            plugins::install_from_source(
                &app,
                &mgr,
                &windows,
                &sidecars,
                &package,
                false,
                Some(&id),
            )
        })();
        let cleanup = plugins::remove_path_all(&work);
        match (result, cleanup) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(error), Ok(())) => Err(error),
            (Err(error), Err(cleanup)) => Err(format!(
                "{error}; repository staging cleanup also failed: {cleanup}"
            )),
            (Ok(_), Err(error)) => Err(format!(
                "plugin installed, but staging cleanup failed: {error}"
            )),
        }
    })
    .await
    .map_err(|e| format!("repository install task failed: {e}"))?
}

fn repository_package(
    unpacked: &Path,
    commit: &str,
    id: &str,
) -> Result<std::path::PathBuf, String> {
    let package = unpacked.join(format!("catrace-plugin-{commit}")).join(id);
    if !package.join("manifest.json").is_file() {
        return Err("repository archive does not contain the selected package".into());
    }
    Ok(package)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commit_validation_rejects_refs_and_traversal() {
        for invalid in [
            "HEAD",
            "main",
            "../../evil",
            "a",
            "gggggggggggggggggggggggggggggggggggggggg",
        ] {
            assert!(validate_commit(invalid).is_err());
        }
        assert!(validate_commit("7f7b4104e7c5bc16bd63bc147c39e72f9ab89e87").is_ok());
    }
    #[test]
    fn catalog_only_accepts_direct_regular_manifests() {
        let tree: Tree = serde_json::from_value(serde_json::json!({"tree":[
            {"path":"timer/manifest.json","type":"blob","mode":"100644"},
            {"path":"docs/example/manifest.json","type":"blob","mode":"100644"},
            {"path":"linked/manifest.json","type":"blob","mode":"120000"}
        ]}))
        .unwrap();
        assert_eq!(manifest_ids(tree).unwrap(), vec!["timer"]);
    }
    #[test]
    fn truncated_catalog_is_an_error() {
        assert!(manifest_ids(Tree {
            tree: vec![],
            truncated: true
        })
        .is_err());
    }

    /// Explicit opt-in smoke test. Downloads only to an isolated temporary directory.
    #[tokio::test]
    #[ignore = "uses the real fixed GitHub repository"]
    async fn official_repository_catalog_and_archive_smoke() {
        let catalog = current_catalog().await.unwrap();
        assert!(!catalog.plugins.is_empty());
        let timer = catalog.plugins.iter().find(|p| p.id == "timer").unwrap();
        assert!(timer.has_background);
        let client = client().unwrap();
        let bytes = fetch_bytes(
            &client,
            &format!(
                "https://codeload.github.com/lanxiuyun/catrace-plugin/zip/{}",
                catalog.commit
            ),
            MAX_ARCHIVE_BYTES,
        )
        .await
        .unwrap();
        let work =
            std::env::temp_dir().join(format!("catrace-repository-smoke-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&work).unwrap();
        let result = (|| -> Result<(), String> {
            let archive = work.join("repository.zip");
            std::fs::write(&archive, bytes).map_err(|e| e.to_string())?;
            let unpacked = work.join("unpacked");
            std::fs::create_dir(&unpacked).map_err(|e| e.to_string())?;
            plugins::unpack_plugin_zip(&archive, &unpacked)?;
            let package = repository_package(&unpacked, &catalog.commit, "timer")?;
            let manifest: PluginManifestFile = serde_json::from_slice(
                &std::fs::read(package.join("manifest.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            assert_eq!(manifest.id, timer.id);
            assert_eq!(manifest.version, timer.version);
            println!(
                "GitHub catalog: {} plugins at {}; archive timer v{} validated",
                catalog.plugins.len(),
                catalog.commit,
                timer.version
            );
            Ok(())
        })();
        plugins::remove_path_all(&work).unwrap();
        result.unwrap();
    }
}
