//! GitHub plugin sources. User input only selects validated owner/repo path segments;
//! every request still uses fixed HTTPS hosts and immutable commits.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::plugins::{self, PluginInstallResult, PluginManager, PluginManifestFile};

const DEFAULT_REPOSITORY: &str = "lanxiuyun/catrace-plugin";
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PLUGINS: usize = 128;
const SOURCE_FILE: &str = ".catrace-source.json";

#[derive(Debug, Clone, PartialEq, Eq)]
struct GithubRepository {
    slug: String,
    name: String,
}

impl GithubRepository {
    fn parse(input: Option<&str>) -> Result<Self, String> {
        let input = input.unwrap_or(DEFAULT_REPOSITORY).trim();
        let lower = input.to_ascii_lowercase();
        let path = lower.strip_prefix("https://github.com/").unwrap_or(&lower);
        // Do not URL-normalize: reject escaped slashes, dot segments, credentials,
        // query strings and alternate hosts rather than accepting a rewritten URL.
        let path = path.strip_suffix('/').unwrap_or(path);
        let path = path.strip_suffix(".git").unwrap_or(path);
        let parts: Vec<_> = path.split('/').collect();
        if input.len() > 512 || parts.len() != 2 {
            return Err("请输入 GitHub 公开仓库地址（https://github.com/owner/repo）或 owner/repo，不支持分支、子目录或其他主机。".into());
        }
        let (owner, name) = (parts[0], parts[1]);
        let owner_valid = !owner.is_empty()
            && owner.len() <= 39
            && owner
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            && !owner.starts_with('-')
            && !owner.ends_with('-')
            && !owner.contains("--");
        let name_valid = !name.is_empty()
            && name.len() <= 100
            && name != "."
            && name != ".."
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
        if !owner_valid || !name_valid {
            return Err(
                "GitHub 仓库格式无效；仅支持 owner/repo 或 https://github.com/owner/repo。".into(),
            );
        }
        Ok(Self {
            slug: format!("{owner}/{name}"),
            name: name.to_string(),
        })
    }

    fn api(&self) -> String {
        format!("https://api.github.com/repos/{}", self.slug)
    }
    fn raw(&self) -> String {
        format!("https://raw.githubusercontent.com/{}", self.slug)
    }
    fn archive(&self, commit: &str) -> String {
        format!("https://codeload.github.com/{}/zip/{commit}", self.slug)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct InstalledPluginSource {
    pub repository: String,
    pub commit: String,
}

impl InstalledPluginSource {
    fn new(repository: &GithubRepository, commit: &str) -> Result<Self, String> {
        validate_commit(commit)?;
        Ok(Self {
            repository: repository.slug.clone(),
            commit: commit.to_ascii_lowercase(),
        })
    }
}

/// Host-owned metadata is outside manifest.json and replaced before publication,
/// even if a downloaded package includes its own file or directory with this name.
pub(crate) fn write_installed_source(
    dir: &Path,
    source: &InstalledPluginSource,
) -> Result<(), String> {
    let repository = GithubRepository::parse(Some(&source.repository))?;
    let source = InstalledPluginSource::new(&repository, &source.commit)?;
    let path = dir.join(SOURCE_FILE);
    plugins::remove_path_all(&path)?;
    let bytes = serde_json::to_vec(&source).map_err(|e| format!("serialize plugin source: {e}"))?;
    fs::write(path, bytes).map_err(|e| format!("write installed plugin source: {e}"))
}

/// Old or manually installed packages have no reliable origin. Invalid metadata
/// never invents an official source and does not prevent managing the old plugin.
pub(crate) fn read_installed_source(dir: &Path) -> Option<InstalledPluginSource> {
    let path = dir.join(SOURCE_FILE);
    let meta = fs::symlink_metadata(&path).ok()?;
    if !meta.file_type().is_file() || meta.len() > 2048 {
        return None;
    }
    let source: InstalledPluginSource = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let repository = GithubRepository::parse(Some(&source.repository)).ok()?;
    InstalledPluginSource::new(&repository, &source.commit).ok()
}

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
    repository: String,
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
        // Only direct children of the repository root are plugin packages.
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
    if ids.is_empty() {
        return Err("仓库中没有可安装插件。每个插件须位于仓库根目录下的独立文件夹，并包含 <id>/manifest.json。".into());
    }
    Ok(ids)
}

async fn repository_tree(
    client: &reqwest::Client,
    repository: &GithubRepository,
    commit: &str,
) -> Result<Vec<String>, String> {
    validate_commit(commit)?;
    let bytes = fetch_bytes(
        client,
        &format!("{}/git/trees/{commit}?recursive=1", repository.api()),
        MAX_JSON_BYTES,
    )
    .await?;
    let tree: Tree =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid repository tree: {e}"))?;
    manifest_ids(tree)
}

async fn catalog_at(
    client: &reqwest::Client,
    repository: &GithubRepository,
    commit: String,
) -> Result<RepositoryCatalog, String> {
    let ids = repository_tree(client, repository, &commit).await?;
    let mut entries = Vec::new();
    for batch in ids.chunks(4) {
        let mut requests = tokio::task::JoinSet::new();
        for id in batch {
            let (client, repository, commit, id) = (
                client.clone(),
                repository.clone(),
                commit.clone(),
                id.clone(),
            );
            requests.spawn(async move { fetch_manifest(&client, &repository, &commit, &id).await });
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
        repository: repository.slug.clone(),
        commit,
        plugins: entries,
    })
}

async fn fetch_manifest(
    client: &reqwest::Client,
    repository: &GithubRepository,
    commit: &str,
    id: &str,
) -> Result<PluginManifestFile, String> {
    let bytes = fetch_bytes(
        client,
        &format!("{}/{commit}/{id}/manifest.json", repository.raw()),
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
    repository: Option<String>,
) -> Result<RepositoryCatalog, String> {
    plugins::ensure_management_window(&window)?;
    let repository = GithubRepository::parse(repository.as_deref())?;
    current_catalog(&repository).await
}

async fn current_catalog(repository: &GithubRepository) -> Result<RepositoryCatalog, String> {
    let client = client()?;
    let head: Commit = serde_json::from_slice(
        &fetch_bytes(
            &client,
            &format!("{}/commits/HEAD", repository.api()),
            MAX_JSON_BYTES,
        )
        .await?,
    )
    .map_err(|e| format!("invalid repository HEAD: {e}"))?;
    catalog_at(&client, repository, head.sha.to_ascii_lowercase()).await
}

#[tauri::command]
pub async fn install_repository_plugin(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    commit: String,
    repository: Option<String>,
) -> Result<PluginInstallResult, String> {
    plugins::ensure_management_window(&window)?;
    let repository = GithubRepository::parse(repository.as_deref())?;
    plugins::validate_id(&id)?;
    let source = InstalledPluginSource::new(&repository, &commit)?;
    let commit = source.commit.clone();
    // Reject duplicates before downloading. The installer repeats this under its
    // mutation lock so another window or repository can never overwrite this ID.
    let root = plugins::mutation_root(&app)?;
    ensure_not_installed(&root, &id)?;
    let client = client()?;
    if !repository_tree(&client, &repository, &commit)
        .await?
        .contains(&id)
    {
        return Err(format!("plugin not present in repository commit: {id}"));
    }
    fetch_manifest(&client, &repository, &commit, &id).await?;
    let bytes = fetch_bytes(&client, &repository.archive(&commit), MAX_ARCHIVE_BYTES).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = plugins::mutation_root(&app)?;
        let work = root.join(format!(".repository-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&work).map_err(|e| format!("create repository staging: {e}"))?;
        let result = (|| {
            let archive = work.join("repository.zip");
            fs::write(&archive, bytes).map_err(|e| format!("save repository archive: {e}"))?;
            let unpacked = work.join("unpacked");
            fs::create_dir(&unpacked).map_err(|e| format!("create extraction staging: {e}"))?;
            plugins::unpack_plugin_zip(&archive, &unpacked)?;
            let package = repository_package(&unpacked, &repository, &commit, &id)?;
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
                &source,
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

fn ensure_not_installed(root: &Path, id: &str) -> Result<(), String> {
    match fs::symlink_metadata(root.join(id)) {
        Ok(_) => Err(format!(
            "插件 ID「{id}」已安装，请先卸载再从其他仓库安装；不会覆盖已有插件。"
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("inspect installed plugin {id}: {error}")),
    }
}

fn repository_package(
    unpacked: &Path,
    repository: &GithubRepository,
    commit: &str,
    id: &str,
) -> Result<PathBuf, String> {
    plugins::validate_id(id)?;
    validate_commit(commit)?;
    let mut roots =
        fs::read_dir(unpacked).map_err(|e| format!("read repository archive root: {e}"))?;
    let root = roots
        .next()
        .ok_or("repository archive is empty")?
        .map_err(|e| e.to_string())?;
    // Repository display casing can differ from the canonical lowercase source.
    let expected = format!("{}-{commit}", repository.name);
    if roots.next().is_some()
        || !root.file_type().map_err(|e| e.to_string())?.is_dir()
        || !root
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(&expected)
    {
        return Err(
            "repository archive root does not match the selected repository and commit".into(),
        );
    }
    let package = root.path().join(id);
    if !package.join("manifest.json").is_file() {
        return Err("repository archive does not contain the selected package".into());
    }
    Ok(package)
}

#[cfg(test)]
mod tests {
    use super::*;
    const COMMIT: &str = "7f7b4104e7c5bc16bd63bc147c39e72f9ab89e87";

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("catrace-source-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = plugins::remove_path_all(&self.0);
        }
    }

    #[test]
    fn github_source_accepts_normalized_slugs_and_public_urls() {
        for input in [
            "Owner/My_Plugins",
            "https://github.com/Owner/My_Plugins",
            "https://github.com/Owner/My_Plugins.git/",
            " owner/my_plugins/ ",
        ] {
            let source = GithubRepository::parse(Some(input)).unwrap();
            assert_eq!(source.slug, "owner/my_plugins");
            assert_eq!(
                source.api(),
                "https://api.github.com/repos/owner/my_plugins"
            );
            assert_eq!(
                source.archive(COMMIT),
                format!("https://codeload.github.com/owner/my_plugins/zip/{COMMIT}")
            );
        }
        assert_eq!(
            GithubRepository::parse(None).unwrap().slug,
            DEFAULT_REPOSITORY
        );
    }

    #[test]
    fn github_source_rejects_other_hosts_credentials_refs_and_escaped_paths() {
        for input in [
            "",
            "https://example.com/owner/repo",
            "http://github.com/owner/repo",
            "https://github.com.evil/owner/repo",
            "https://github.com:443/owner/repo",
            "https://me@github.com/owner/repo",
            "https://github.com/owner/repo?x=1",
            "https://github.com/owner/repo#x",
            "https://github.com/owner/repo/tree/main",
            "owner/repo/subdir",
            "owner/repo//",
            "owner/../repo",
            "owner/%72epo",
            "owner/repo%2f..",
            "owner/repo\\x",
            "-owner/repo",
            "owner-/repo",
            "own--er/repo",
            "owner/..",
            "owner/.",
            "所有者/repo",
            "owner/re po",
            "owner/repo\nother",
        ] {
            assert!(
                GithubRepository::parse(Some(input)).is_err(),
                "accepted {input}"
            );
        }
    }

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
        assert!(validate_commit(COMMIT).is_ok());
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
    fn truncated_and_non_plugin_repositories_are_errors() {
        for truncated in [true, false] {
            assert!(manifest_ids(Tree {
                tree: vec![],
                truncated
            })
            .is_err());
        }
    }

    #[test]
    fn source_metadata_is_host_written_and_survives_complete_package_publication() {
        let work = TempDir::new();
        let staged = work.0.join("staged");
        fs::create_dir(&staged).unwrap();
        // A source supplied by the package must never survive host installation.
        fs::write(
            staged.join(SOURCE_FILE),
            r#"{"repository":"impostor/package","commit":"fake"}"#,
        )
        .unwrap();
        let repository = GithubRepository::parse(Some("owner/real-source")).unwrap();
        let source = InstalledPluginSource::new(&repository, COMMIT).unwrap();
        write_installed_source(&staged, &source).unwrap();
        let installed = work.0.join("installed");
        fs::rename(&staged, &installed).unwrap();
        assert_eq!(read_installed_source(&installed), Some(source.clone()));
        fs::remove_file(installed.join(SOURCE_FILE)).unwrap();
        fs::create_dir(installed.join(SOURCE_FILE)).unwrap();
        write_installed_source(&installed, &source).unwrap();
        assert_eq!(read_installed_source(&installed), Some(source));
    }

    #[test]
    fn missing_invalid_or_manifest_claimed_source_remains_unknown() {
        let work = TempDir::new();
        assert!(read_installed_source(&work.0).is_none());
        fs::write(
            work.0.join("manifest.json"),
            format!(r#"{{"sourceRepository":"owner/repo","sourceCommit":"{COMMIT}"}}"#),
        )
        .unwrap();
        assert!(read_installed_source(&work.0).is_none());
        for text in [
            "not JSON".to_string(),
            format!(r#"{{"repository":"https://evil/owner/repo","commit":"{COMMIT}"}}"#),
            r#"{"repository":"owner/repo","commit":"main"}"#.to_string(),
        ] {
            fs::write(work.0.join(SOURCE_FILE), text).unwrap();
            assert!(read_installed_source(&work.0).is_none());
        }
    }

    #[test]
    fn custom_archive_root_is_case_insensitive_but_commit_and_single_root_are_required() {
        let work = TempDir::new();
        let repository = GithubRepository::parse(Some("owner/custom-plugins")).unwrap();
        let package = work
            .0
            .join(format!("Custom-Plugins-{COMMIT}"))
            .join("timer");
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("manifest.json"), "{}").unwrap();
        assert_eq!(
            repository_package(&work.0, &repository, COMMIT, "timer").unwrap(),
            package
        );
        assert!(repository_package(&work.0, &repository, &"0".repeat(40), "timer").is_err());
        assert!(repository_package(&work.0, &repository, COMMIT, "../timer").is_err());
        fs::create_dir(work.0.join("other-root")).unwrap();
        assert!(repository_package(&work.0, &repository, COMMIT, "timer").is_err());
    }

    #[test]
    fn installed_id_is_rejected_without_modifying_existing_plugin() {
        let work = TempDir::new();
        ensure_not_installed(&work.0, "timer").unwrap();
        fs::create_dir(work.0.join("timer")).unwrap();
        fs::write(work.0.join("timer/keep"), "original").unwrap();
        assert!(ensure_not_installed(&work.0, "timer").is_err());
        assert_eq!(
            fs::read_to_string(work.0.join("timer/keep")).unwrap(),
            "original"
        );
    }

    /// Explicit opt-in smoke test. Downloads only to an isolated temporary directory.
    #[tokio::test]
    #[ignore = "uses the real public GitHub repository"]
    async fn official_repository_catalog_and_archive_smoke() {
        let repository = GithubRepository::parse(None).unwrap();
        let catalog = current_catalog(&repository).await.unwrap();
        assert_eq!(catalog.repository, DEFAULT_REPOSITORY);
        let timer = catalog.plugins.iter().find(|p| p.id == "timer").unwrap();
        assert!(timer.has_background);
        let client = client().unwrap();
        let bytes = fetch_bytes(
            &client,
            &repository.archive(&catalog.commit),
            MAX_ARCHIVE_BYTES,
        )
        .await
        .unwrap();
        let work = TempDir::new();
        let archive = work.0.join("repository.zip");
        fs::write(&archive, bytes).unwrap();
        let unpacked = work.0.join("unpacked");
        fs::create_dir(&unpacked).unwrap();
        plugins::unpack_plugin_zip(&archive, &unpacked).unwrap();
        let package = repository_package(&unpacked, &repository, &catalog.commit, "timer").unwrap();
        let manifest: PluginManifestFile =
            serde_json::from_slice(&fs::read(package.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest.id, timer.id);
        assert_eq!(manifest.version, timer.version);
        println!(
            "GitHub catalog: {} plugins at {}/{}; timer v{} validated",
            catalog.plugins.len(),
            catalog.repository,
            catalog.commit,
            timer.version
        );
    }
}
