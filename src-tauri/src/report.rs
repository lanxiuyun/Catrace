use crate::db::Db;
use chrono::SecondsFormat;
use std::sync::OnceLock;

const APP_KEY: &str = "RBrITa0T5PKRzdYuwwxzow";
const ACCESS_KEY: &str = "9SzxzOb3pQgkOB-LU-QU1Q";
const SECRET_KEY: &str = "auf6yeKP1JLKBSAx3cfAKAjZynKl3siahyHXDoQPyWU";
const REPORT_URL: &str = "https://api.upgrade.toolsetlink.com/v1/app/report";
const SIGN_URI: &str = "/v1/app/report";
const DEV_KEY_SETTING: &str = "toolsetlink_dev_key";
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// 将 Tauri 版本号转换为 toolsetlink 所需的整数 versionCode。
/// 规则：major * 10000 + minor * 100 + patch。
/// 例如 26.6.18 -> 260618。
fn version_code(version: &semver::Version) -> i64 {
    (version.major as i64) * 10000 + (version.minor as i64) * 100 + (version.patch as i64)
}

/// 将 Rust 目标系统名映射为 toolsetlink 期望的值。
fn map_target(os: &str) -> &'static str {
    match os {
        "macos" => "darwin",
        "windows" => "windows",
        "linux" => "linux",
        _ => "unknown",
    }
}

/// 生成 16 位十六进制 nonce。
fn generate_nonce() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(16)
        .collect()
}

/// 根据 toolsetlink 签名规则生成 MD5 签名。
/// signStr = body=${body}&nonce=${X-Nonce}&secretKey=${SecretKey}&timestamp=${X-Timestamp}&url=${uri}
fn generate_signature(
    body: &str,
    nonce: &str,
    timestamp: &str,
    secret_key: &str,
    uri: &str,
) -> String {
    let sign_str = format!(
        "body={}&nonce={}&secretKey={}&timestamp={}&url={}",
        body, nonce, secret_key, timestamp, uri
    );
    format!("{:x}", md5::compute(sign_str))
}

/// 获取或生成设备唯一标识 devKey。
fn get_or_create_dev_key(db: &Db) -> String {
    if let Some(existing) = db.get_setting(DEV_KEY_SETTING, "").strip_prefix("dev_") {
        if existing.len() == 32 {
            return format!("dev_{}", existing);
        }
    }
    let new_key = format!("dev_{}", uuid::Uuid::new_v4().simple());
    let _ = db.set_setting(DEV_KEY_SETTING, &new_key);
    new_key
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EventData {
    launch_time: String,
    version_code: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    arch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_model_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_key: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportBody {
    event_type: String,
    timestamp: String,
    app_key: String,
    event_data: EventData,
}

async fn do_report_app_start(
    app_handle: &tauri::AppHandle,
    db: &Db,
) -> Result<(), Box<dyn std::error::Error>> {
    let package_info = app_handle.package_info();
    let version = package_info.version.clone();
    let launch_time = chrono::Local::now().to_rfc3339_opts(SecondsFormat::Secs, false);
    let timestamp = launch_time.clone();
    let nonce = generate_nonce();
    let dev_key = get_or_create_dev_key(db);

    let body = ReportBody {
        event_type: "app_start".to_string(),
        timestamp: timestamp.clone(),
        app_key: APP_KEY.to_string(),
        event_data: EventData {
            launch_time,
            version_code: version_code(&version),
            target: Some(map_target(std::env::consts::OS).to_string()),
            arch: Some(std::env::consts::ARCH.to_string()),
            dev_model_key: None,
            dev_key: Some(dev_key),
        },
    };

    let body_str = serde_json::to_string(&body)?;
    let signature = generate_signature(&body_str, &nonce, &timestamp, SECRET_KEY, SIGN_URI);

    let resp = http_client()
        .post(REPORT_URL)
        .header("Content-Type", "application/json")
        .header("X-Timestamp", timestamp)
        .header("X-Nonce", nonce)
        .header("X-AccessKey", ACCESS_KEY)
        .header("X-Signature", signature)
        .body(body_str)
        .send()
        .await?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status.is_success() {
        println!(
            "[toolsetlink-report] app_start reported successfully: {}",
            text
        );
    } else {
        eprintln!(
            "[toolsetlink-report] app_start report failed ({}): {}",
            status, text
        );
    }
    Ok(())
}

/// 在异步运行时中上报应用启动事件。
/// 该函数不阻塞启动流程，失败仅打印日志。
pub fn spawn_report_app_start(app_handle: tauri::AppHandle, db: Db) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = do_report_app_start(&app_handle, &db).await {
            eprintln!("[toolsetlink-report] failed to report app_start: {}", e);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_code() {
        let v = semver::Version::parse("26.6.18").unwrap();
        assert_eq!(super::version_code(&v), 260618);
    }

    #[test]
    fn test_map_target() {
        assert_eq!(map_target("macos"), "darwin");
        assert_eq!(map_target("windows"), "windows");
        assert_eq!(map_target("linux"), "linux");
        assert_eq!(map_target("freebsd"), "unknown");
    }

    #[test]
    fn test_generate_signature_format() {
        let sig = generate_signature(
            r#"{"eventType":"app_start"}"#,
            "89c8b3d5f2a74e1b",
            "2025-02-17T10:34:55+08:00",
            "secret",
            "/v1/app/report",
        );
        assert_eq!(sig.len(), 32);
        assert!(sig.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_generate_signature_matches_official_rule() {
        // 与文档签名示例(1)对齐：body + nonce + secretKey + timestamp + url
        let body = r#"{"urlKey": "key1","versionCode": 1,"appointVersionCode": 0}"#;
        let sig = generate_signature(
            body,
            "abcdef1234567890",
            "2025-02-17T10:34:55+08:00",
            "89c8b3d5f2a74e1b",
            "/v1/url/upgrade",
        );
        let expected = format!(
            "{:x}",
            md5::compute(
                r#"body={"urlKey": "key1","versionCode": 1,"appointVersionCode": 0}&nonce=abcdef1234567890&secretKey=89c8b3d5f2a74e1b&timestamp=2025-02-17T10:34:55+08:00&url=/v1/url/upgrade"#
            )
        );
        assert_eq!(sig, expected);
    }
}
