//! Agent 通知模块：本地 HTTP 服务接收 AI agent（Claude Code 等）hook 发来的状态事件，
//! 去抖后复用 Toast 窗口弹出卡片；并提供一键安装/卸载 ~/.claude/settings.json hook 的命令。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::Db;
use crate::{log_error, log_info};

/// 固定监听端口，避开 clawd-on-desk 的 23333-23337。
const AGENT_HOOK_PORT: u16 = 23456;
/// 所有可订阅的 hook 事件；每个事件的显示策略由用户配置。
const KNOWN_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "Stop",
    "StopFailure",
    "Notification",
];
/// 同会话同事件的去重窗口（仅 auto 模式生效），防止连续触发刷屏。
const DEDUP_TTL: Duration = Duration::from_secs(8);
const ENABLED_SETTING_KEY: &str = "agent_notification_enabled";
const EVENT_MODES_SETTING_KEY: &str = "agent_event_modes";
const HOOK_SCRIPT_MARKER: &str = "catrace-agent-hook";

static SERVER_STARTED: AtomicBool = AtomicBool::new(false);
static SERVER_ENABLED: AtomicBool = AtomicBool::new(true);
static EVENT_MODES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static DEDUP_CACHE: Mutex<Option<HashMap<(String, String), Instant>>> = Mutex::new(None);

/// 事件显示策略：off=不通知 / auto=弹出后自动消失 / sticky=常驻直到用户关闭。
fn default_event_mode(event: &str) -> &'static str {
    match event {
        "Stop" | "StopFailure" | "Notification" => "sticky",
        _ => "off",
    }
}

fn event_mode(event: &str) -> String {
    let guard = EVENT_MODES.lock().unwrap();
    if let Some(map) = guard.as_ref() {
        if let Some(m) = map.get(event) {
            return m.clone();
        }
    }
    default_event_mode(event).to_string()
}

#[derive(Debug, Clone, Deserialize)]
struct AgentHookPayload {
    event: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    session_id: String,
}

// ------------------------------------------------------------------
// HTTP 接收端
// ------------------------------------------------------------------

/// 启动 HTTP 服务（整个进程生命周期只启动一次，开关通过 SERVER_ENABLED 控制是否投递）。
pub fn start_server(app: tauri::AppHandle, db: Db) {
    if SERVER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    SERVER_ENABLED.store(db.get_setting(ENABLED_SETTING_KEY, "true") == "true", Ordering::SeqCst);
    let stored = db.get_setting(EVENT_MODES_SETTING_KEY, "");
    let parsed: HashMap<String, String> =
        serde_json::from_str(&stored).unwrap_or_default();
    *EVENT_MODES.lock().unwrap() = Some(parsed);

    thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", AGENT_HOOK_PORT);
        let server = match tiny_http::Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                log_error!("agent-hook", "failed to bind {}: {}", addr, e);
                SERVER_STARTED.store(false, Ordering::SeqCst);
                return;
            }
        };
        log_info!("agent-hook", "listening on {}", addr);
        for request in server.incoming_requests() {
            handle_request(&app, request);
        }
    });
}

fn handle_request(app: &tauri::AppHandle, mut request: tiny_http::Request) {
    if request.method() != &tiny_http::Method::Post || request.url() != "/state" {
        let _ = request.respond(tiny_http::Response::empty(404));
        return;
    }

    let mut body = String::new();
    if request.as_reader().read_to_string(&mut body).is_err() {
        let _ = request.respond(tiny_http::Response::empty(400));
        return;
    }

    let payload: AgentHookPayload = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(_) => {
            let _ = request.respond(tiny_http::Response::empty(400));
            return;
        }
    };

    // 立即响应，不阻塞 agent 的 hook 执行
    let _ = request.respond(tiny_http::Response::empty(200));

    if !SERVER_ENABLED.load(Ordering::SeqCst) {
        return;
    }
    let mode = event_mode(&payload.event);
    if mode == "off" {
        return;
    }
    // sticky 事件是「召唤用户回来」型，不去重——每次都要让用户看到；
    // auto 事件走 8 秒去重，防止刷屏。
    if mode != "sticky" && is_duplicate(&payload) {
        return;
    }

    crate::reminder_toast::create_agent_toast_window(app, &payload.event, &payload.state, &mode);
}

fn is_duplicate(payload: &AgentHookPayload) -> bool {
    let key = (payload.session_id.clone(), payload.event.clone());
    let now = Instant::now();
    let mut guard = DEDUP_CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(HashMap::new);
    cache.retain(|_, t| now.duration_since(*t) < DEDUP_TTL);
    if cache.contains_key(&key) {
        return true;
    }
    cache.insert(key, now);
    false
}

// ------------------------------------------------------------------
// 开关命令
// ------------------------------------------------------------------

#[tauri::command]
pub fn get_agent_notification_enabled(db: tauri::State<'_, Db>) -> Result<bool, String> {
    Ok(db.get_setting(ENABLED_SETTING_KEY, "true") == "true")
}

#[tauri::command]
pub fn set_agent_notification_enabled(
    db: tauri::State<'_, Db>,
    enabled: bool,
) -> Result<(), String> {
    db.set_setting(ENABLED_SETTING_KEY, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    SERVER_ENABLED.store(enabled, Ordering::SeqCst);
    Ok(())
}

// ------------------------------------------------------------------
// 每事件显示策略命令
// ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct AgentEventMode {
    pub event: String,
    pub mode: String,
}

#[tauri::command]
pub fn get_agent_event_modes() -> Vec<AgentEventMode> {
    KNOWN_EVENTS
        .iter()
        .map(|e| AgentEventMode {
            event: e.to_string(),
            mode: event_mode(e),
        })
        .collect()
}

#[tauri::command]
pub fn set_agent_event_mode(
    db: tauri::State<'_, Db>,
    event: String,
    mode: String,
) -> Result<(), String> {
    if !KNOWN_EVENTS.contains(&event.as_str()) {
        return Err(format!("未知事件: {}", event));
    }
    if !["off", "auto", "sticky"].contains(&mode.as_str()) {
        return Err(format!("未知模式: {}", mode));
    }
    let mut guard = EVENT_MODES.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(event, mode);
    let serialized = serde_json::to_string(map).map_err(|e| e.to_string())?;
    db.set_setting(EVENT_MODES_SETTING_KEY, &serialized)
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------------
// Hook 脚本释放 + ~/.claude/settings.json 安装/卸载
// ------------------------------------------------------------------

/// 将内置 hook 脚本释放到 app_data_dir/hooks/，保证写进 settings.json 的路径稳定。
fn ensure_hook_script(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let hooks_dir = app_data_dir.join("hooks");
    std::fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;
    let dest = hooks_dir.join("catrace-agent-hook.js");
    let bytes = include_bytes!("../resources/catrace-agent-hook.js");
    // 每次写入保持脚本与内置版本同步
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

fn claude_settings_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("home dir not found")?;
    Ok(home.join(".claude").join("settings.json"))
}

fn read_claude_settings(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("settings.json 解析失败: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn write_claude_settings(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid settings path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // 原子写入：先写临时文件再 rename
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn entry_contains_catrace_hook(entry: &serde_json::Value) -> bool {
    let has_marker = |cmd: Option<&str>| cmd.map_or(false, |s| s.contains(HOOK_SCRIPT_MARKER));
    if has_marker(entry.get("command").and_then(|c| c.as_str())) {
        return true;
    }
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .map_or(false, |hooks| {
            hooks.iter().any(|h| has_marker(h.get("command").and_then(|c| c.as_str())))
        })
}

fn build_hook_command(script_path: &std::path::Path) -> String {
    format!("node \"{}\"", script_path.to_string_lossy())
}

#[tauri::command]
pub fn install_agent_hooks(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let script_path = ensure_hook_script(&app)?;
    let settings_path = claude_settings_path()?;
    let mut settings = read_claude_settings(&settings_path)?;

    let hooks = settings
        .as_object_mut()
        .ok_or("settings.json 根节点不是对象")?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks 字段不是对象")?;

    let command = build_hook_command(&script_path);
    let mut installed_events = Vec::new();

    for event in KNOWN_EVENTS {
        let entries = hooks_obj
            .entry(event.to_string())
            .or_insert_with(|| serde_json::json!([]));
        let arr = entries.as_array_mut().ok_or(format!("hooks.{} 不是数组", event))?;
        if arr.iter().any(entry_contains_catrace_hook) {
            continue;
        }
        arr.push(serde_json::json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": command,
                "async": true,
                "timeout": 5
            }]
        }));
        installed_events.push(event.to_string());
    }

    write_claude_settings(&settings_path, &settings)?;
    Ok(serde_json::json!({ "installed_events": installed_events }))
}

#[tauri::command]
pub fn uninstall_agent_hooks() -> Result<serde_json::Value, String> {
    let settings_path = claude_settings_path()?;
    let mut settings = read_claude_settings(&settings_path)?;
    let mut removed = 0usize;

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        let mut empty_events = Vec::new();
        for (event, entries) in hooks.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                let before = arr.len();
                arr.retain(|e| !entry_contains_catrace_hook(e));
                removed += before - arr.len();
                if arr.is_empty() {
                    empty_events.push(event.clone());
                }
            }
        }
        for event in empty_events {
            hooks.remove(&event);
        }
    }

    if removed > 0 {
        write_claude_settings(&settings_path, &settings)?;
    }
    Ok(serde_json::json!({ "removed": removed }))
}

#[tauri::command]
pub fn is_agent_hook_installed() -> Result<bool, String> {
    let settings_path = claude_settings_path()?;
    let settings = read_claude_settings(&settings_path)?;

    if let Some(hooks) = settings.get("hooks").and_then(|h| h.as_object()) {
        for entries in hooks.values() {
            if let Some(arr) = entries.as_array() {
                if arr.iter().any(entry_contains_catrace_hook) {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}
