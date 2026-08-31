use std::time::Duration;

use serde::Serialize;
use tauri::{ipc::Channel, Manager, ResourceId, State, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::db::Db;

const SETTING_KEY: &str = "update_source";
const DEFAULT_SOURCE: &str = "auto";
const GITHUB_LATEST_JSON: &str =
    "https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json";

const PROXY_PREFIXES: &[&str] = &[
    "https://ghfast.top/",
    "https://gh.ddlc.top/",
    "https://ghproxy.net/",
    "https://mirror.ghproxy.com/",
    "https://ghps.cc/",
];

pub fn is_valid_source(id: &str) -> bool {
    matches!(id, "auto" | "ghfast" | "ghddlc" | "ghproxy" | "github")
}

pub fn normalize_source(id: &str) -> &str {
    if is_valid_source(id) {
        id
    } else {
        DEFAULT_SOURCE
    }
}

pub fn read_saved_source(db: &Db) -> String {
    normalize_source(&db.get_setting(SETTING_KEY, DEFAULT_SOURCE)).to_string()
}

fn endpoints_for(source: &str) -> Result<Vec<Url>, String> {
    let urls: Vec<&str> = match source {
        "ghfast" => vec![
            "https://ghfast.top/https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json",
        ],
        "ghddlc" => vec![
            "https://gh.ddlc.top/https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json",
        ],
        "ghproxy" => vec![
            "https://ghproxy.net/https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json",
        ],
        "github" => vec![GITHUB_LATEST_JSON],
        _ => vec![
            "https://ghfast.top/https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json",
            "https://gh.ddlc.top/https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json",
            "https://ghproxy.net/https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json",
            GITHUB_LATEST_JSON,
        ],
    };
    urls.into_iter()
        .map(|s| s.parse::<Url>().map_err(|e| e.to_string()))
        .collect()
}

fn unwrap_github_url(url: &str) -> String {
    let mut rest = url;
    loop {
        let mut stripped = false;
        for prefix in PROXY_PREFIXES {
            if let Some(s) = rest.strip_prefix(prefix) {
                rest = s;
                stripped = true;
                break;
            }
        }
        if !stripped {
            break;
        }
    }
    rest.to_string()
}

fn apply_download_source(url: &str, source: &str) -> String {
    let github = unwrap_github_url(url);
    if !github.starts_with("https://github.com/") {
        return url.to_string();
    }
    match source {
        "ghfast" => format!("https://ghfast.top/{github}"),
        "ghddlc" => format!("https://gh.ddlc.top/{github}"),
        "ghproxy" => format!("https://ghproxy.net/{github}"),
        "github" => github,
        _ => url.to_string(),
    }
}

fn download_sources_to_try(source: &str) -> Vec<&str> {
    match source {
        "ghfast" | "ghddlc" | "ghproxy" | "github" => vec![source],
        _ => vec!["ghfast", "ghddlc", "ghproxy", "github"],
    }
}

pub fn rewrite_download_url(update: &mut Update, source: &str) {
    if source == "auto" {
        return;
    }
    let rewritten = apply_download_source(update.download_url.as_str(), source);
    if rewritten == update.download_url.as_str() {
        return;
    }
    match rewritten.parse::<Url>() {
        Ok(parsed) => update.download_url = parsed,
        Err(e) => crate::log_warn!("update", "rewrite download url failed: {}", e),
    }
}

pub fn build_updater(
    app: &tauri::AppHandle,
    source: &str,
    timeout: Duration,
) -> Result<tauri_plugin_updater::Updater, String> {
    let source = normalize_source(source);
    let endpoints = endpoints_for(source)?;
    app.updater_builder()
        .timeout(timeout)
        .endpoints(endpoints)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

pub async fn check_for_update(
    app: &tauri::AppHandle,
    source: &str,
    timeout: Duration,
) -> Result<Option<Update>, String> {
    let source = normalize_source(source);
    let updater = build_updater(app, source, timeout)?;
    let mut found = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(ref mut update) = found {
        rewrite_download_url(update, source);
    }
    Ok(found)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub fn get_update_source(db: State<Db>) -> String {
    read_saved_source(&db)
}

#[tauri::command]
pub fn set_update_source(source: String, db: State<Db>) -> Result<(), String> {
    if !is_valid_source(&source) {
        return Err(format!("invalid update source: {source}"));
    }
    db.set_setting(SETTING_KEY, &source)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_app_update(
    webview: Webview,
    db: State<'_, Db>,
    source: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<Option<UpdateCheckMetadata>, String> {
    let source_owned = source
        .filter(|s| is_valid_source(s))
        .unwrap_or_else(|| read_saved_source(&db));
    let app = webview.app_handle().clone();
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));
    let found = check_for_update(&app, &source_owned, timeout).await?;
    let Some(update) = found else {
        return Ok(None);
    };

    Ok(Some(UpdateCheckMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: None,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

#[tauri::command]
pub async fn install_app_update(
    webview: Webview,
    rid: ResourceId,
    source: Option<String>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    let mut update = (*update).clone();
    let source = source
        .as_deref()
        .map(normalize_source)
        .unwrap_or("auto")
        .to_string();
    let tries = download_sources_to_try(&source);
    let mut last_err = None;

    for (i, try_source) in tries.iter().enumerate() {
        rewrite_download_url(&mut update, try_source);
        crate::log_info!(
            "update",
            "download try {}/{} source={} url={}",
            i + 1,
            tries.len(),
            try_source,
            update.download_url
        );
        let mut first_chunk = true;
        let result = update
            .download_and_install(
                |chunk_length, content_length| {
                    if first_chunk {
                        first_chunk = false;
                        let _ = on_event.send(DownloadEvent::Started { content_length });
                    }
                    let _ = on_event.send(DownloadEvent::Progress { chunk_length });
                },
                || {
                    let _ = on_event.send(DownloadEvent::Finished);
                },
            )
            .await;
        match result {
            Ok(()) => return Ok(()),
            Err(e) => {
                crate::log_warn!("update", "download failed source={}: {}", try_source, e);
                last_err = Some(e.to_string());
            }
        }
    }

    Err(last_err.unwrap_or_else(|| "update download failed".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_strips_proxy_prefixes() {
        let url = "https://ghfast.top/https://ghproxy.net/https://github.com/lanxiuyun/Catrace/releases/download/v1/a.exe";
        assert_eq!(
            unwrap_github_url(url),
            "https://github.com/lanxiuyun/Catrace/releases/download/v1/a.exe"
        );
    }

    #[test]
    fn apply_rewrites_to_selected_mirror() {
        let raw = "https://ghproxy.net/https://github.com/lanxiuyun/Catrace/releases/download/v1/a.exe";
        assert_eq!(
            apply_download_source(raw, "ghfast"),
            "https://ghfast.top/https://github.com/lanxiuyun/Catrace/releases/download/v1/a.exe"
        );
        assert_eq!(
            apply_download_source(raw, "github"),
            "https://github.com/lanxiuyun/Catrace/releases/download/v1/a.exe"
        );
        assert_eq!(apply_download_source(raw, "auto"), raw);
    }

    #[test]
    fn invalid_source_falls_back_to_auto() {
        assert_eq!(normalize_source("nope"), "auto");
        assert_eq!(normalize_source("ghproxy"), "ghproxy");
    }

    #[test]
    fn auto_download_tries_all_mirrors() {
        assert_eq!(
            download_sources_to_try("auto"),
            vec!["ghfast", "ghddlc", "ghproxy", "github"]
        );
        assert_eq!(download_sources_to_try("ghproxy"), vec!["ghproxy"]);
    }
}
