//! GitHub / Gitee plugin sources. User input only selects validated owner/repo path
//! segments; every request still uses fixed HTTPS hosts and immutable commits.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::plugins::{self, PluginInstallResult, PluginManager, PluginManifestFile};

const DEFAULT_REPOSITORY: &str = "lanxiuyun/catrace-plugin";
/// Third-party GitHub file proxy. Applied only to raw file and archive downloads,
/// because the proxy forwards API requests with a shared, rate-limited GitHub token.
const GITHUB_MIRROR_PREFIX: &str = "https://ghfast.top/";
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
/// Per-file and total budget when a package is assembled from raw file downloads.
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 5_000;
const MAX_PLUGINS: usize = 128;
/// Keep only the few API documents a catalog read needs; entries are replaced per URL.
const MAX_CACHED_API_RESPONSES: usize = 8;
const SOURCE_FILE: &str = ".catrace-source.json";

/// A public repository host whose endpoints, file layout and archive naming are known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provider {
    GitHub,
    Gitee,
}

impl Provider {
    fn label(self) -> &'static str {
        match self {
            Self::GitHub => "GitHub",
            Self::Gitee => "Gitee",
        }
    }

    fn host(self) -> &'static str {
        match self {
            Self::GitHub => "github.com",
            Self::Gitee => "gitee.com",
        }
    }
}

/// A validated public repository. The canonical form is `owner/repo` for GitHub and
/// `https://gitee.com/owner/repo` for Gitee, so both round-trip through settings and
/// `.catrace-source.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RepositorySource {
    provider: Provider,
    slug: String,
    name: String,
    /// Route GitHub file downloads through `GITHUB_MIRROR_PREFIX`. API calls stay direct.
    mirror: bool,
}

impl RepositorySource {
    fn parse(input: Option<&str>) -> Result<Self, String> {
        let input = input.unwrap_or(DEFAULT_REPOSITORY).trim();
        if input.len() > 512 {
            return Err(Self::format_error());
        }
        let lower = input.to_ascii_lowercase();
        let (provider, path) = if let Some(path) = lower.strip_prefix("https://github.com/") {
            (Provider::GitHub, path)
        } else if let Some(path) = lower.strip_prefix("https://gitee.com/") {
            (Provider::Gitee, path)
        } else if let Some(path) = lower.strip_prefix("gitee.com/") {
            // A Gitee host without the scheme is accepted as a hand-typed source.
            (Provider::Gitee, path)
        } else {
            (Provider::GitHub, lower.as_str())
        };
        // Do not URL-normalize: reject escaped slashes, dot segments, credentials,
        // query strings and alternate hosts rather than accepting a rewritten URL.
        let path = path.strip_suffix('/').unwrap_or(path);
        let path = path.strip_suffix(".git").unwrap_or(path);
        let parts: Vec<_> = path.split('/').collect();
        if parts.len() != 2 {
            return Err(Self::format_error());
        }
        let (owner, name) = (parts[0], parts[1]);
        let owner_valid = match provider {
            Provider::GitHub => github_owner_valid(owner),
            Provider::Gitee => gitee_owner_valid(owner),
        };
        if !owner_valid || !repository_name_valid(name) {
            return Err(format!(
                "{} 仓库格式无效；仅支持 owner/repo 或 https://{}/owner/repo。",
                provider.label(),
                provider.host()
            ));
        }
        Ok(Self {
            provider,
            slug: format!("{owner}/{name}"),
            name: name.to_string(),
            mirror: false,
        })
    }

    /// Enable the GitHub file mirror for GitHub sources; Gitee never needs it.
    fn with_mirror(mut self, mirror: bool) -> Self {
        self.mirror = mirror && self.provider == Provider::GitHub;
        self
    }

    fn format_error() -> String {
        "请输入公开仓库地址（https://github.com/owner/repo 或 https://gitee.com/owner/repo，也可只填 owner/repo 表示 GitHub），不支持分支、子目录或其他主机。".into()
    }

    fn canonical(&self) -> String {
        match self.provider {
            Provider::GitHub => self.slug.clone(),
            Provider::Gitee => format!("https://gitee.com/{}", self.slug),
        }
    }

    fn api(&self) -> String {
        match self.provider {
            Provider::GitHub => format!("https://api.github.com/repos/{}", self.slug),
            Provider::Gitee => format!("https://gitee.com/api/v5/repos/{}", self.slug),
        }
    }

    fn commits_head(&self) -> String {
        match self.provider {
            Provider::GitHub => format!("{}/commits/HEAD", self.api()),
            Provider::Gitee => format!("{}/commits?per_page=1", self.api()),
        }
    }

    /// Raw file endpoint without the trailing `/{commit}` segment.
    fn raw(&self) -> String {
        match self.provider {
            Provider::GitHub if self.mirror => format!(
                "{GITHUB_MIRROR_PREFIX}https://raw.githubusercontent.com/{}",
                self.slug
            ),
            Provider::GitHub => format!("https://raw.githubusercontent.com/{}", self.slug),
            Provider::Gitee => format!("https://gitee.com/{}/raw", self.slug),
        }
    }

    fn archive(&self, commit: &str) -> String {
        match self.provider {
            Provider::GitHub if self.mirror => format!(
                "{GITHUB_MIRROR_PREFIX}https://github.com/{}/archive/{commit}.zip",
                self.slug
            ),
            Provider::GitHub => format!("https://codeload.github.com/{}/zip/{commit}", self.slug),
            Provider::Gitee => {
                format!(
                    "https://gitee.com/{}/repository/archive/{commit}.zip",
                    self.slug
                )
            }
        }
    }
}

fn github_owner_valid(owner: &str) -> bool {
    !owner.is_empty()
        && owner.len() <= 39
        && owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !owner.starts_with('-')
        && !owner.ends_with('-')
        && !owner.contains("--")
}

fn gitee_owner_valid(owner: &str) -> bool {
    !owner.is_empty()
        && owner.len() <= 39
        && !owner.starts_with('-')
        && !owner.ends_with('-')
        && !owner.starts_with('_')
        && !owner.ends_with('_')
        && !owner.contains("--")
        && owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

fn repository_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Percent-encode repository paths for raw downloads. Segments stay readable but `#`,
/// `?`, spaces and non-ASCII bytes cannot be mistaken for URL syntax.
fn encode_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct InstalledPluginSource {
    pub repository: String,
    pub commit: String,
}

impl InstalledPluginSource {
    fn new(repository: &RepositorySource, commit: &str) -> Result<Self, String> {
        validate_commit(commit)?;
        Ok(Self {
            repository: repository.canonical(),
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
    let repository = RepositorySource::parse(Some(&source.repository))?;
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
    let repository = RepositorySource::parse(Some(&source.repository)).ok()?;
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
        // GitHub serves files directly. Gitee answers raw/archive requests with a
        // redirect to its signed CDN (raw.giteeusercontent.com) or blazearchive URL,
        // so follow only fixed repository hosts instead of arbitrary redirect targets.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 3 {
                attempt.error("too many repository redirects")
            } else if repository_redirect_allowed(attempt.url().host_str().unwrap_or_default()) {
                attempt.follow()
            } else {
                attempt.error("repository redirect to a disallowed host")
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("create repository client: {e}"))
}

fn repository_redirect_allowed(host: &str) -> bool {
    matches!(
        host,
        "github.com"
            | "api.github.com"
            | "raw.githubusercontent.com"
            | "codeload.github.com"
            | "gitee.com"
            | "raw.giteeusercontent.com"
            | "ghfast.top"
    )
}

async fn fetch_bytes(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("repository request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "repository request returned HTTP {} (the source host may be unavailable or rate-limited)",
            response.status()
        ));
    }
    read_body(&mut response, limit).await
}

async fn read_body(response: &mut reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
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

struct CachedApiResponse {
    etag: String,
    body: Vec<u8>,
}

/// GitHub's unauthenticated API allows about 60 requests per hour, while conditional
/// requests answered with 304 do not consume quota. Catalog refreshes therefore send
/// `If-None-Match` and reuse the stored JSON body while the repository is unchanged.
fn api_cache() -> &'static Mutex<HashMap<String, CachedApiResponse>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedApiResponse>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_api_response(url: &str) -> Option<(String, Vec<u8>)> {
    let cache = api_cache().lock().unwrap();
    cache.get(url).map(|entry| (entry.etag.clone(), entry.body.clone()))
}

fn store_api_response(url: &str, etag: &str, body: &[u8]) {
    let mut cache = api_cache().lock().unwrap();
    if cache.len() >= MAX_CACHED_API_RESPONSES && !cache.contains_key(url) {
        cache.clear();
    }
    cache.insert(
        url.to_string(),
        CachedApiResponse {
            etag: etag.to_string(),
            body: body.to_vec(),
        },
    );
}

/// Marker understood by the plugin center, which turns it into a localized message.
fn rate_limited_error(reset_epoch: u64) -> String {
    format!("rate_limited|{reset_epoch}")
}

/// GitHub answers 403 (and Gitee 429) once the hourly quota is exhausted. Distinguish
/// that from other failures so the UI can explain the wait instead of a bare HTTP code.
fn rate_limit_signal(status: u16, remaining: Option<&str>, reset: Option<&str>) -> Option<String> {
    if status != 403 && status != 429 {
        return None;
    }
    if remaining?.trim() != "0" {
        return None;
    }
    let reset = reset
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    Some(rate_limited_error(reset))
}

fn rate_limit_error(response: &reqwest::Response) -> Option<String> {
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    rate_limit_signal(
        response.status().as_u16(),
        header("x-ratelimit-remaining"),
        header("x-ratelimit-reset"),
    )
}

async fn fetch_api_bytes(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let cached = cached_api_response(url);
    let mut request = client.get(url);
    if let Some((etag, _)) = &cached {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("repository request failed: {e}"))?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return cached
            .map(|(_, body)| body)
            .ok_or_else(|| "repository conditional request has no cached response".to_string());
    }
    if !response.status().is_success() {
        if let Some(error) = rate_limit_error(&response) {
            return Err(error);
        }
        return Err(format!(
            "repository request returned HTTP {} (the source host may be unavailable or rate-limited)",
            response.status()
        ));
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = read_body(&mut response, limit).await?;
    if let Some(etag) = etag {
        store_api_response(url, &etag, &bytes);
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
    repository: &RepositorySource,
    commit: &str,
) -> Result<Vec<String>, String> {
    manifest_ids(fetch_repository_tree(client, repository, commit).await?)
}

async fn fetch_repository_tree(
    client: &reqwest::Client,
    repository: &RepositorySource,
    commit: &str,
) -> Result<Tree, String> {
    validate_commit(commit)?;
    let bytes = fetch_api_bytes(
        client,
        &format!("{}/git/trees/{commit}?recursive=1", repository.api()),
        MAX_JSON_BYTES,
    )
    .await?;
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid repository tree: {e}"))
}

async fn catalog_at(
    client: &reqwest::Client,
    repository: &RepositorySource,
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
        repository: repository.canonical(),
        commit,
        plugins: entries,
    })
}

async fn fetch_manifest(
    client: &reqwest::Client,
    repository: &RepositorySource,
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
    mirror: Option<bool>,
) -> Result<RepositoryCatalog, String> {
    plugins::ensure_management_window(&window)?;
    let repository =
        RepositorySource::parse(repository.as_deref())?.with_mirror(mirror.unwrap_or(false));
    current_catalog(&repository).await
}

async fn current_catalog(repository: &RepositorySource) -> Result<RepositoryCatalog, String> {
    let client = client()?;
    let commit = fetch_head_commit(&client, repository).await?;
    catalog_at(&client, repository, commit).await
}

/// GitHub returns the HEAD commit as an object; Gitee returns the default branch's
/// commits as an array. Both are pinned to a full 40-character SHA before any file
/// is read, so catalogs and installs share the same immutable snapshot.
async fn fetch_head_commit(
    client: &reqwest::Client,
    repository: &RepositorySource,
) -> Result<String, String> {
    let bytes = fetch_api_bytes(client, &repository.commits_head(), MAX_JSON_BYTES).await?;
    let sha = match repository.provider {
        Provider::GitHub => {
            serde_json::from_slice::<Commit>(&bytes)
                .map_err(|e| format!("invalid repository HEAD: {e}"))?
                .sha
        }
        Provider::Gitee => {
            serde_json::from_slice::<Vec<Commit>>(&bytes)
                .map_err(|e| format!("invalid repository HEAD: {e}"))?
                .into_iter()
                .next()
                .ok_or("repository has no commits")?
                .sha
        }
    };
    validate_commit(&sha)?;
    Ok(sha.to_ascii_lowercase())
}

#[tauri::command]
pub async fn install_repository_plugin(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    commit: String,
    repository: Option<String>,
    mirror: Option<bool>,
) -> Result<PluginInstallResult, String> {
    plugins::ensure_management_window(&window)?;
    let repository =
        RepositorySource::parse(repository.as_deref())?.with_mirror(mirror.unwrap_or(false));
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

    // GitHub archives download as one zip. Gitee's archive endpoint can answer with an
    // interactive "preparing download" page instead of the zip, so assemble the plugin
    // from the validated tree through Gitee's raw CDN and reuse the same installer.
    let work = root.join(format!(".repository-{}", uuid::Uuid::new_v4()));
    let task_work = work.clone();
    let result: Result<PluginInstallResult, String> = async move {
        fs::create_dir(&task_work).map_err(|e| format!("create repository staging: {e}"))?;
        match repository.provider {
            Provider::GitHub => {
                let bytes =
                    fetch_bytes(&client, &repository.archive(&commit), MAX_ARCHIVE_BYTES).await?;
                tauri::async_runtime::spawn_blocking(move || {
                    let archive = task_work.join("repository.zip");
                    fs::write(&archive, bytes)
                        .map_err(|e| format!("save repository archive: {e}"))?;
                    let unpacked = task_work.join("unpacked");
                    fs::create_dir(&unpacked)
                        .map_err(|e| format!("create extraction staging: {e}"))?;
                    plugins::unpack_plugin_zip(&archive, &unpacked)?;
                    let package = repository_package(&unpacked, &repository, &commit, &id)?;
                    install_package(&app, &package, &id, &source)
                })
                .await
                .map_err(|e| format!("repository install task failed: {e}"))?
            }
            Provider::Gitee => {
                let package = task_work.join("package");
                fs::create_dir(&package).map_err(|e| format!("create package staging: {e}"))?;
                download_raw_package(&client, &repository, &commit, &id, &package).await?;
                tauri::async_runtime::spawn_blocking(move || {
                    install_package(&app, &package, &id, &source)
                })
                .await
                .map_err(|e| format!("repository install task failed: {e}"))?
            }
        }
    }
    .await;
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
}

fn install_package(
    app: &AppHandle,
    package: &Path,
    id: &str,
    source: &InstalledPluginSource,
) -> Result<PluginInstallResult, String> {
    let mgr = app.state::<PluginManager>();
    let windows = app.state::<crate::plugin_window::PluginWindowManager>();
    let sidecars = app.state::<crate::plugin_sidecar::PluginSidecarManager>();
    plugins::install_from_source(
        app,
        &mgr,
        &windows,
        &sidecars,
        package,
        false,
        Some(id),
        source,
    )
}

/// Materialize one plugin directory from the repository tree. Gitee serves individual
/// files from its raw CDN reliably, while its generated archive may require an
/// interactive download page; every path is still validated before writing.
async fn download_raw_package(
    client: &reqwest::Client,
    repository: &RepositorySource,
    commit: &str,
    id: &str,
    dest: &Path,
) -> Result<(), String> {
    if repository.provider != Provider::Gitee {
        return Err("raw package download is only used for Gitee sources".into());
    }
    let tree = fetch_repository_tree(client, repository, commit).await?;
    if tree.truncated {
        return Err("repository tree is truncated; cannot safely download the plugin".into());
    }
    let prefix = format!("{id}/");
    let mut files = 0usize;
    let mut total = 0usize;
    let mut seen = std::collections::HashSet::new();
    for entry in tree.tree {
        let Some(relative) = entry.path.strip_prefix(&prefix) else {
            continue;
        };
        if entry.kind == "tree" {
            continue;
        }
        if entry.kind != "blob" || !matches!(entry.mode.as_str(), "100644" | "100755") {
            return Err(format!(
                "unsupported repository entry: {} (links and submodules are not allowed)",
                entry.path
            ));
        }
        if !seen.insert(entry.path.to_ascii_lowercase()) {
            return Err(format!("duplicate repository path: {}", entry.path));
        }
        let relative_path = plugins::safe_archive_path(relative)?;
        let out = dest.join(&relative_path);
        if !out.starts_with(dest) {
            return Err(format!("repository path escaped package: {}", entry.path));
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let bytes = fetch_bytes(
            client,
            &format!("{}/{commit}/{}", repository.raw(), encode_path(&entry.path)),
            MAX_PACKAGE_BYTES,
        )
        .await?;
        total = total.saturating_add(bytes.len());
        if total > MAX_PACKAGE_BYTES {
            return Err("plugin package is too large (max 64 MiB)".into());
        }
        files += 1;
        if files > MAX_PACKAGE_FILES {
            return Err(format!(
                "plugin package has too many files (max {MAX_PACKAGE_FILES})"
            ));
        }
        fs::write(&out, &bytes).map_err(|e| format!("write {}: {e}", out.display()))?;
        #[cfg(unix)]
        if entry.mode == "100755" {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out, fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("set permissions on {}: {e}", out.display()))?;
        }
    }
    if files == 0 || !dest.join("manifest.json").is_file() {
        return Err(format!("repository package is missing manifest.json: {id}"));
    }
    Ok(())
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
    repository: &RepositorySource,
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
            let source = RepositorySource::parse(Some(input)).unwrap();
            assert_eq!(source.provider, Provider::GitHub);
            assert_eq!(source.slug, "owner/my_plugins");
            assert_eq!(source.canonical(), "owner/my_plugins");
            assert_eq!(
                source.commits_head(),
                "https://api.github.com/repos/owner/my_plugins/commits/HEAD"
            );
            assert_eq!(
                source.raw(),
                "https://raw.githubusercontent.com/owner/my_plugins"
            );
            assert_eq!(
                source.archive(COMMIT),
                format!("https://codeload.github.com/owner/my_plugins/zip/{COMMIT}")
            );
        }
        assert_eq!(
            RepositorySource::parse(None).unwrap().slug,
            DEFAULT_REPOSITORY
        );
    }

    #[test]
    fn gitee_source_accepts_public_urls_and_round_trips_canonical_form() {
        for input in [
            "https://gitee.com/Owner/My_Plugins",
            "https://gitee.com/Owner/My_Plugins.git/",
            "https://gitee.com/owner/my_plugins",
            "gitee.com/owner/my_plugins",
            " https://gitee.com/owner/my_plugins/ ",
        ] {
            let source = RepositorySource::parse(Some(input)).unwrap();
            assert_eq!(source.provider, Provider::Gitee);
            assert_eq!(source.slug, "owner/my_plugins");
            assert_eq!(source.canonical(), "https://gitee.com/owner/my_plugins");
            assert_eq!(
                source.commits_head(),
                "https://gitee.com/api/v5/repos/owner/my_plugins/commits?per_page=1"
            );
            assert_eq!(
                source.api(),
                "https://gitee.com/api/v5/repos/owner/my_plugins"
            );
            assert_eq!(source.raw(), "https://gitee.com/owner/my_plugins/raw");
            assert_eq!(
                source.archive(COMMIT),
                format!("https://gitee.com/owner/my_plugins/repository/archive/{COMMIT}.zip")
            );
        }
        let parsed = RepositorySource::parse(Some("https://gitee.com/owner/my_plugins")).unwrap();
        let canonical = parsed.canonical();
        assert_eq!(
            RepositorySource::parse(Some(canonical.as_str())).unwrap(),
            parsed
        );
        let underscore_owner =
            RepositorySource::parse(Some("https://gitee.com/my_owner/my.repo")).unwrap();
        assert_eq!(underscore_owner.slug, "my_owner/my.repo");
    }

    #[test]
    fn repository_source_rejects_other_hosts_credentials_refs_and_escaped_paths() {
        for input in [
            "",
            "https://example.com/owner/repo",
            "http://github.com/owner/repo",
            "http://gitee.com/owner/repo",
            "https://github.com.evil/owner/repo",
            "https://gitee.com.evil/owner/repo",
            "https://github.com:443/owner/repo",
            "https://gitee.com:443/owner/repo",
            "https://me@github.com/owner/repo",
            "https://github.com/owner/repo?x=1",
            "https://gitee.com/owner/repo?x=1",
            "https://github.com/owner/repo#x",
            "https://gitee.com/owner/repo#x",
            "https://github.com/owner/repo/tree/main",
            "https://gitee.com/owner/repo/tree/main",
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
                RepositorySource::parse(Some(input)).is_err(),
                "accepted {input}"
            );
        }
    }

    #[test]
    fn repository_redirects_only_follow_fixed_hosts() {
        for host in [
            "github.com",
            "api.github.com",
            "raw.githubusercontent.com",
            "codeload.github.com",
            "gitee.com",
            "raw.giteeusercontent.com",
            "ghfast.top",
        ] {
            assert!(repository_redirect_allowed(host), "blocked {host}");
        }
        for host in ["", "example.com", "gitee.com.evil", "github.io"] {
            assert!(!repository_redirect_allowed(host), "allowed {host}");
        }
    }

    #[test]
    fn github_mirror_rewrites_file_downloads_but_not_api_calls() {
        let source = RepositorySource::parse(Some("owner/my_plugins"))
            .unwrap()
            .with_mirror(true);
        assert_eq!(
            source.api(),
            "https://api.github.com/repos/owner/my_plugins"
        );
        assert_eq!(
            source.commits_head(),
            "https://api.github.com/repos/owner/my_plugins/commits/HEAD"
        );
        assert_eq!(
            source.raw(),
            "https://ghfast.top/https://raw.githubusercontent.com/owner/my_plugins"
        );
        assert_eq!(
            source.archive(COMMIT),
            format!("https://ghfast.top/https://github.com/owner/my_plugins/archive/{COMMIT}.zip")
        );

        let gitee = RepositorySource::parse(Some("https://gitee.com/owner/my_plugins"))
            .unwrap()
            .with_mirror(true);
        assert_eq!(gitee.raw(), "https://gitee.com/owner/my_plugins/raw");
        assert_eq!(
            gitee.archive(COMMIT),
            format!("https://gitee.com/owner/my_plugins/repository/archive/{COMMIT}.zip")
        );
    }

    #[test]
    fn repository_paths_are_percent_encoded_for_raw_downloads() {
        assert_eq!(encode_path("timer/ui.mjs"), "timer/ui.mjs");
        assert_eq!(encode_path("a/b%c"), "a/b%25c");
        assert_eq!(
            encode_path("runtime/中文 文件#1?.mjs"),
            "runtime/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6%231%3F.mjs"
        );
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
        let repository = RepositorySource::parse(Some("owner/real-source")).unwrap();
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
    fn gitee_installed_source_round_trips_through_metadata() {
        let repository =
            RepositorySource::parse(Some("https://gitee.com/owner/my_plugins")).unwrap();
        let source = InstalledPluginSource::new(&repository, COMMIT).unwrap();
        assert_eq!(source.repository, "https://gitee.com/owner/my_plugins");
        let work = TempDir::new();
        write_installed_source(&work.0, &source).unwrap();
        assert_eq!(read_installed_source(&work.0), Some(source));
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
        let repository = RepositorySource::parse(Some("owner/custom-plugins")).unwrap();
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
        smoke_official_repository(RepositorySource::parse(None).unwrap()).await;
    }

    /// Same catalog and archive flow through the GitHub file mirror (`ghfast.top`).
    #[tokio::test]
    #[ignore = "uses ghfast.top and the real public GitHub repository"]
    async fn mirrored_github_repository_catalog_and_archive_smoke() {
        smoke_official_repository(RepositorySource::parse(None).unwrap().with_mirror(true)).await;
    }

    async fn smoke_official_repository(repository: RepositorySource) {
        let label = if repository.mirror {
            "Mirrored GitHub"
        } else {
            "GitHub"
        };
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
            "{label} catalog: {} plugins at {}/{}; timer v{} validated",
            catalog.plugins.len(),
            catalog.repository,
            catalog.commit,
            timer.version
        );
    }

    /// Explicit opt-in smoke test for the Gitee mirror. Uses the same raw-file package
    /// download as a real install and writes only to an isolated temporary directory.
    #[tokio::test]
    #[ignore = "uses the real public Gitee mirror"]
    async fn gitee_mirror_catalog_and_raw_package_smoke() {
        let repository =
            RepositorySource::parse(Some("https://gitee.com/lanxiuyun/catrace-plugin")).unwrap();
        let catalog = current_catalog(&repository).await.unwrap();
        assert_eq!(
            catalog.repository,
            "https://gitee.com/lanxiuyun/catrace-plugin"
        );
        let timer = catalog.plugins.iter().find(|p| p.id == "timer").unwrap();
        let client = client().unwrap();
        let work = TempDir::new();
        let package = work.0.join("package");
        fs::create_dir(&package).unwrap();
        download_raw_package(&client, &repository, &catalog.commit, "timer", &package)
            .await
            .unwrap();
        let manifest: PluginManifestFile =
            serde_json::from_slice(&fs::read(package.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest.id, timer.id);
        assert_eq!(manifest.version, timer.version);
        assert!(package.join("ui.mjs").is_file());
        println!(
            "Gitee catalog: {} plugins at {}/{}; timer v{} downloaded as raw files",
            catalog.plugins.len(),
            catalog.repository,
            catalog.commit,
            timer.version
        );
    }

    #[test]
    fn exhausted_rate_limit_is_reported_with_its_reset_time() {
        assert_eq!(
            rate_limit_signal(403, Some("0"), Some("1793845864")),
            Some("rate_limited|1793845864".to_string())
        );
        assert_eq!(
            rate_limit_signal(429, Some(" 0 "), Some("1793845864")),
            Some("rate_limited|1793845864".to_string())
        );
        // Missing or unparsable reset still surfaces the sentinel without a countdown.
        assert_eq!(
            rate_limit_signal(403, Some("0"), Some("soon")),
            Some("rate_limited|0".to_string())
        );
        assert_eq!(
            rate_limit_signal(403, Some("0"), None),
            Some("rate_limited|0".to_string())
        );
        // Only a 403/429 with an exhausted counter is a rate limit; other failures stay generic.
        assert_eq!(rate_limit_signal(403, Some("12"), Some("1793845864")), None);
        assert_eq!(rate_limit_signal(403, None, Some("1793845864")), None);
        assert_eq!(rate_limit_signal(404, Some("0"), Some("1793845864")), None);
        assert_eq!(rate_limit_signal(500, Some("0"), Some("1793845864")), None);
    }

    #[test]
    fn api_cache_round_trips_by_url_and_stays_bounded() {
        store_api_response("test://cache/body", "etag", b"body");
        assert_eq!(
            cached_api_response("test://cache/body"),
            Some(("etag".to_string(), b"body".to_vec()))
        );
        for index in 0..=MAX_CACHED_API_RESPONSES {
            store_api_response(&format!("test://cache/{index}"), "e", b"b");
        }
        assert!(api_cache().lock().unwrap().len() <= MAX_CACHED_API_RESPONSES);
    }
}
