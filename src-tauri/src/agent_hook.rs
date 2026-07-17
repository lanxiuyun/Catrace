//! Agent 通知模块：本地 HTTP 服务接收 AI agent（Claude Code 等）hook 发来的状态事件，
//! 去抖后复用 Toast 窗口弹出卡片；并提供一键安装/卸载 ~/.claude/settings.json hook 的命令。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
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
    // 只通知不审批：弹 sticky 待办，不阻塞 agent 的权限 UI
    "PermissionRequest",
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
        // 召唤型：完成/出错/喊你/等批准 → 默认常驻；用户可在设置里改 off/auto/sticky
        "Stop" | "StopFailure" | "Notification" | "PermissionRequest" => "sticky",
        // 播报型：开会话/思考中 → 默认不弹（UserPromptSubmit 仍参与自动销 sticky）
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
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    transcript_path: String,
    #[serde(default)]
    prompt: String,
    /// PermissionRequest 等事件带来的工具名，作摘要兜底
    #[serde(default)]
    tool_name: String,
}

/// 从 transcript（JSONL）里找最后一条 assistant 文本消息，截断成摘要。
/// 读不到或没有文本时返回 None，前端降级为默认文案。
fn summarize_transcript(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    // 从后往前找 assistant 消息，避免整文件解析
    for line in text.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let content = v.pointer("/message/content")?;
        let snippet = match content {
            serde_json::Value::Array(arr) => arr.iter().find_map(|c| {
                if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                    c.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })?,
            serde_json::Value::String(s) => s.clone(),
            _ => continue,
        };
        // 取首行并截断，避免摘要里塞多行 markdown
        let first_line = snippet.lines().next().unwrap_or("").trim();
        if first_line.is_empty() {
            continue;
        }
        return Some(truncate_chars(first_line, 80));
    }
    None
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max).collect();
    format!("{}…", truncated)
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

    // 自动销项：用户重新提交 prompt 说明已回到该会话，撤掉对应 sticky 待办。
    // 即使 UserPromptSubmit 自身 mode=off（默认），也要处理销项。
    if payload.event == "UserPromptSubmit"
        && !payload.session_id.is_empty()
        && payload.session_id != "unknown"
    {
        crate::reminder_toast::dismiss_agent_session_toast(app, &payload.session_id);
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

    let summary = summarize_transcript(&payload.transcript_path).or_else(|| {
        if !payload.tool_name.is_empty() {
            Some(format!("等待批准：{}", payload.tool_name))
        } else if payload.event == "PermissionRequest" {
            Some("等待你批准工具调用".to_string())
        } else {
            None
        }
    });
    crate::reminder_toast::create_agent_toast_window(
        app,
        &payload.event,
        &payload.state,
        &mode,
        &payload.session_id,
        &payload.cwd,
        &payload.prompt,
        summary.as_deref(),
    );
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
// 提示音：内置音释放 + 自定义文件读取
// ------------------------------------------------------------------

/// 提示音设置 key（存 SQLite，前端用 Store 同步一份用于自定义路径）
const SOUND_MODE_SETTING_KEY: &str = "agent_sound_mode"; // builtin | custom | muted
const SOUND_PATH_SETTING_KEY: &str = "agent_sound_path";
const SOUND_VOLUME_SETTING_KEY: &str = "agent_sound_volume";

#[derive(Debug, Serialize)]
pub struct AgentSoundSettings {
    pub mode: String,
    pub custom_path: String,
    pub volume: f32,
}

fn parse_volume(s: &str) -> f32 {
    s.parse::<f32>().unwrap_or(1.0).clamp(0.0, 1.0)
}

#[tauri::command]
pub fn get_agent_sound_settings(db: tauri::State<'_, Db>) -> AgentSoundSettings {
    AgentSoundSettings {
        mode: db.get_setting(SOUND_MODE_SETTING_KEY, "builtin"),
        custom_path: db.get_setting(SOUND_PATH_SETTING_KEY, ""),
        volume: parse_volume(&db.get_setting(SOUND_VOLUME_SETTING_KEY, "1.0")),
    }
}

#[tauri::command]
pub fn set_agent_sound_settings(
    db: tauri::State<'_, Db>,
    mode: String,
    custom_path: String,
    volume: f32,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !["builtin", "custom", "muted"].contains(&mode.as_str()) {
        return Err(format!("未知提示音模式: {}", mode));
    }
    let volume = volume.clamp(0.0, 1.0);
    db.set_setting(SOUND_MODE_SETTING_KEY, &mode)
        .map_err(|e| e.to_string())?;
    db.set_setting(SOUND_PATH_SETTING_KEY, &custom_path)
        .map_err(|e| e.to_string())?;
    db.set_setting(SOUND_VOLUME_SETTING_KEY, &volume.to_string())
        .map_err(|e| e.to_string())?;

    // 通知所有 Toast 窗口刷新缓存的提示音 data URL
    let _ = app.emit("catrace-agent-sound-changed", ());
    Ok(())
}

/// 返回提示音的 data URL。
/// mode=builtin 时把内置 mp3 释放到 app_data_dir/sounds/ 后读回；
/// mode=custom 时读用户选择的本地文件；muted 或读失败返回 None。
#[tauri::command]
pub fn get_agent_sound_data_url(app: tauri::AppHandle) -> Option<String> {
    let db = app.state::<Db>();
    let mode = db.get_setting(SOUND_MODE_SETTING_KEY, "builtin");
    if mode == "muted" {
        return None;
    }

    let bytes: Vec<u8> = if mode == "custom" {
        let path = db.get_setting(SOUND_PATH_SETTING_KEY, "");
        if path.is_empty() {
            return None;
        }
        std::fs::read(&path).ok()?
    } else {
        // builtin：释放内置资源（wav 格式，HTML Audio 原生支持）
        let app_data_dir = app.path().app_data_dir().ok()?;
        let sounds_dir = app_data_dir.join("sounds");
        std::fs::create_dir_all(&sounds_dir).ok()?;
        let dest = sounds_dir.join("agent-notify.wav");
        if !dest.exists() {
            std::fs::write(&dest, include_bytes!("../resources/agent-notify.wav")).ok()?;
        }
        std::fs::read(&dest).ok()?
    };

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    // 自定义文件可能是 mp3 也可能是 wav，统一用 mpeg MIME（Audio 宽容处理）
    let mime = if mode == "custom" {
        let path = db.get_setting(SOUND_PATH_SETTING_KEY, "");
        if path.to_lowercase().ends_with(".mp3") {
            "audio/mpeg"
        } else if path.to_lowercase().ends_with(".ogg") {
            "audio/ogg"
        } else {
            "audio/wav"
        }
    } else {
        "audio/wav"
    };
    Some(format!("data:{};base64,{}", mime, b64))
}

// ------------------------------------------------------------------
// 前往会话：在 cwd 下新开终端恢复 Claude Code 会话
// ------------------------------------------------------------------

/// 在用户指定的 cwd 下新开一个终端窗口，执行 `claude -r <session_id>`。
/// 目前仅恢复 Claude Code 会话；其他 agent 暂无 resume 机制。
#[tauri::command]
pub fn open_agent_session(cwd: String, session_id: String) -> Result<(), String> {
    if session_id.trim().is_empty() || session_id == "unknown" {
        return Err("无效的会话 ID".to_string());
    }
    let dir = if cwd.trim().is_empty() {
        dirs::home_dir().ok_or("home dir not found")?
    } else {
        std::path::PathBuf::from(&cwd)
    };
    if !dir.exists() {
        return Err(format!("目录不存在: {}", dir.display()));
    }
    open_terminal_resume(&dir, &session_id)
}

#[cfg(windows)]
fn open_terminal_resume(dir: &std::path::Path, session_id: &str) -> Result<(), String> {
    // cmd /k 保持窗口；命令里的参数全部来自内部，无用户注入风险
    std::process::Command::new("cmd")
        .args(["/c", "start", "cmd", "/k", "claude", "-r", session_id])
        .current_dir(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开终端: {}", e))
}

#[cfg(target_os = "macos")]
fn open_terminal_resume(dir: &std::path::Path, session_id: &str) -> Result<(), String> {
    let script = format!(
        "tell application \"Terminal\" to do script \"cd {} && claude -r {}\"",
        dir.display(),
        session_id
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开终端: {}", e))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_terminal_resume(_dir: &std::path::Path, _session_id: &str) -> Result<(), String> {
    Err("当前平台暂不支持前往会话".to_string())
}

// ------------------------------------------------------------------
// Hook 脚本释放 + ~/.claude/settings.json 安装/卸载
// ------------------------------------------------------------------

/// 将内置 hook 脚本释放到 app_data_dir/hooks/，保证写进 settings.json 的路径稳定。
fn ensure_hook_script(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let hooks_dir = app_data_dir.join("hooks");
    std::fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;
    let dest = hooks_dir.join("catrace-agent-hook.cjs");
    let bytes = include_bytes!("../resources/catrace-agent-hook.cjs");
    // 每次写入保持脚本与内置版本同步
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

fn claude_settings_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("home dir not found")?;
    Ok(home.join(".claude").join("settings.json"))
}

fn read_json_settings(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("{} 解析失败: {}", path.display(), e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn write_json_settings(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid settings path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // 原子写入：先写临时文件再 rename
    let tmp = path.with_extension("tmp");
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

/// 找到数组里第一个含 catrace marker 的 entry 的可变引用。
fn find_catrace_entry_mut(arr: &mut [serde_json::Value]) -> Option<&mut serde_json::Value> {
    arr.iter_mut().find(|e| entry_contains_catrace_hook(e))
}

/// 取 entry 里第一个含 marker 的 hook 对象的可变引用（兼容 entry.command 与 entry.hooks[].command）。
fn catrace_hook_obj_mut(entry: &mut serde_json::Value) -> Option<&mut serde_json::Value> {
    if entry
        .get("command")
        .and_then(|c| c.as_str())
        .map_or(false, |s| s.contains(HOOK_SCRIPT_MARKER))
    {
        return Some(entry);
    }
    entry
        .get_mut("hooks")
        .and_then(|h| h.as_array_mut())
        .and_then(|hooks| {
            hooks.iter_mut().find(|h| {
                h.get("command")
                    .and_then(|c| c.as_str())
                    .map_or(false, |s| s.contains(HOOK_SCRIPT_MARKER))
            })
        })
}

// ------------------------------------------------------------------
// P4：安装可靠性 —— node 绝对路径、平台命令包装、字段级 sync、备份
// ------------------------------------------------------------------

/// 解析 node 可执行文件绝对路径。
/// macOS/Linux 打包环境下 agent 给 hook 的 PATH 极简，裸 `node` 找不到 Homebrew/nvm 的 node，
/// 必须写绝对路径；Windows 上走 PowerShell `& "node"`，裸 node 已可用，返回 None。
#[cfg(not(windows))]
fn resolve_node_path() -> Option<std::path::PathBuf> {
    // 1. 当前进程的 PATH（GUI 应用常缺 /opt/homebrew/bin 等，故这只是第一候选）
    if let Some(p) = which_in_path("node") {
        return Some(p);
    }
    // 2. 常见安装位置
    let mut candidates: Vec<std::path::PathBuf> = vec![
        "/opt/homebrew/bin/node".into(), // Apple Silicon Homebrew
        "/usr/local/bin/node".into(),    // Intel Homebrew / 常规
        "/usr/bin/node".into(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        // nvm 默认
        candidates.push(std::path::PathBuf::from(format!(
            "{}/.nvm/current/bin/node",
            home
        )));
        // fnm
        candidates.push(std::path::PathBuf::from(format!(
            "{}/.local/share/fnm/aliases/default/bin/node",
            home
        )));
        // volta
        candidates.push(std::path::PathBuf::from(format!(
            "{}/.volta/bin/node",
            home
        )));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// 在 PATH 环境变量里查找可执行文件，返回绝对路径。
#[cfg(not(windows))]
fn which_in_path(bin: &str) -> Option<std::path::PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let cand = dir.join(bin);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

#[cfg(windows)]
#[allow(dead_code)] // Windows 上 PowerShell `& "node"` 已可用，此函数仅为 POSIX 解析绝对路径
fn resolve_node_path() -> Option<std::path::PathBuf> {
    None
}

/// 判断一个 command 字符串里的 node 是否已是绝对路径（用于「别用裸 node 覆盖已有绝对路径」）。
fn command_uses_absolute_node(command: &str) -> bool {
    // 提取首个引号包裹或空白分隔的 token 作为解释器路径
    let token = command
        .split('"')
        .nth(1)
        .map(|s| s.to_string())
        .or_else(|| command.split_whitespace().next().map(|s| s.to_string()));
    match token {
        Some(t) => {
            let p = std::path::Path::new(t.trim_matches('&').trim());
            p.is_absolute()
        }
        None => false,
    }
}

/// Claude Code 的 hook spec。
/// Windows：Claude 默认用 bash 跑 hook，需显式 `shell: "powershell"` + `& "node" "script"` 调用符。
/// POSIX/WSL：用 node 绝对路径 + 引号包裹的 shell 形式。
fn claude_hook_spec(script_path: &std::path::Path) -> serde_json::Value {
    #[cfg(windows)]
    {
        let cmd = format!("& \"node\" \"{}\"", script_path.to_string_lossy());
        serde_json::json!({
            "type": "command",
            "shell": "powershell",
            "command": cmd,
            "async": true,
            "timeout": 5
        })
    }
    #[cfg(not(windows))]
    {
        let node = resolve_node_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "node".to_string());
        let cmd = format!("\"{}\" \"{}\"", node, script_path.to_string_lossy());
        serde_json::json!({
            "type": "command",
            "command": cmd,
            "async": true,
            "timeout": 5
        })
    }
}

/// Codex 的 hook spec。
/// Windows 上 Codex 用 PowerShell 执行 command 字符串，裸引号会 exit 1，必须 `&` 调用符；
/// 共享 CODEX_HOME 时 Windows 走 commandWindows，WSL 走 command（plain，不带引号）。
fn codex_hook_spec(script_path: &std::path::Path) -> serde_json::Value {
    #[cfg(windows)]
    {
        let ps = format!("& \"node\" \"{}\"", script_path.to_string_lossy());
        // WSL 走 command：plain 形式（引号会被当成可执行文件名一部分）
        let wsl = format!("node {}", script_path.to_string_lossy().replace('\\', "/"));
        serde_json::json!({
            "type": "command",
            "command": wsl,
            "commandWindows": ps,
            "timeout": 30
        })
    }
    #[cfg(not(windows))]
    {
        let node = resolve_node_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "node".to_string());
        let cmd = format!("\"{}\" \"{}\"", node, script_path.to_string_lossy());
        serde_json::json!({
            "type": "command",
            "command": cmd,
            "timeout": 30
        })
    }
}

/// Gemini 的 hook 命令（entry 带 name 字段）。
fn gemini_hook_command(script_path: &std::path::Path) -> String {
    #[cfg(windows)]
    {
        format!("& \"node\" \"{}\"", script_path.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        let node = resolve_node_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "node".to_string());
        format!("\"{}\" \"{}\"", node, script_path.to_string_lossy())
    }
}

/// Kimi 的 hook 命令（TOML literal string，单引号包裹）。
fn kimi_hook_command(script_path: &std::path::Path) -> String {
    #[cfg(windows)]
    {
        // Kimi 直接 spawn shell；Windows 用 & 调用符
        format!("& \"node\" \"{}\"", script_path.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        let node = resolve_node_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "node".to_string());
        format!("\"{}\" \"{}\"", node, script_path.to_string_lossy())
    }
}

/// 备份配置文件（写前调用一次，失败仅记日志不阻断安装）。
fn backup_file(path: &std::path::Path) {
    if path.exists() {
        let bak = path.with_extension("bak");
        if let Err(e) = std::fs::copy(path, &bak) {
            crate::log_error!("agent-hook", "备份 {} 失败: {}", path.display(), e);
        }
    }
}

// ------------------------------------------------------------------
// 支持的 agent 定义
// ------------------------------------------------------------------

/// 支持的 agent；前端 agent 列表与此保持一致。
pub const SUPPORTED_AGENTS: &[&str] = &["claude", "codex", "gemini", "kimi"];

#[tauri::command]
pub fn get_supported_agents() -> Vec<String> {
    SUPPORTED_AGENTS.iter().map(|s| s.to_string()).collect()
}

/// 各 agent 写入配置的 hook 事件（安装用；通知策略仍按归一化后的事件配置）。
fn agent_hook_events(agent: &str) -> &'static [&'static str] {
    match agent {
        // Codex 原生支持 PermissionRequest（command hook，非阻塞通知）
        "codex" => &[
            "SessionStart",
            "UserPromptSubmit",
            "Stop",
            "PermissionRequest",
        ],
        // Gemini 无 PermissionRequest；BeforeTool 是 gating hook，需 stdout 决策，暂不注册
        "gemini" => &["SessionStart", "BeforeAgent", "AfterAgent", "Notification"],
        // Kimi Code 支持 PermissionRequest；旧 CLI 不认识时会忽略该块或跳过（安装仍幂等）
        "kimi" => &[
            "SessionStart",
            "UserPromptSubmit",
            "Stop",
            "Notification",
            "PermissionRequest",
        ],
        // Claude：PermissionRequest 用 command hook 只推状态（async），不替代终端审批 UI
        _ => KNOWN_EVENTS,
    }
}

// ------------------------------------------------------------------
// Claude Code：~/.claude/settings.json
// ------------------------------------------------------------------

fn install_claude_hooks(script_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let settings_path = claude_settings_path()?;
    backup_file(&settings_path);
    let mut settings = read_json_settings(&settings_path)?;

    let hooks = settings
        .as_object_mut()
        .ok_or("settings.json 根节点不是对象")?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks 字段不是对象")?;

    let spec = claude_hook_spec(script_path);
    let mut installed_events = Vec::new();
    let mut synced_events = Vec::new();

    for event in agent_hook_events("claude") {
        let entries = hooks_obj
            .entry(event.to_string())
            .or_insert_with(|| serde_json::json!([]));
        let arr = entries.as_array_mut().ok_or(format!("hooks.{} 不是数组", event))?;
        // 已装：字段级 sync（更新 command/timeout/shell），而非 skip——脚本路径/node 路径变更后不陈旧
        if let Some(entry) = find_catrace_entry_mut(arr) {
            if let Some(hook) = catrace_hook_obj_mut(entry) {
                let existing = hook
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                let new_cmd = spec.get("command").and_then(|c| c.as_str()).unwrap_or("");
                // 解析不到 node 绝对路径时，别用裸 node 覆盖已有的绝对路径
                let should_update_cmd = !existing.is_empty()
                    && (command_uses_absolute_node(new_cmd) || !command_uses_absolute_node(&existing));
                if should_update_cmd {
                    hook["command"] = spec["command"].clone();
                }
                if let Some(t) = spec.get("timeout") {
                    hook["timeout"] = t.clone();
                }
                match spec.get("shell") {
                    Some(s) => hook["shell"] = s.clone(),
                    None => {
                        if let Some(o) = hook.as_object_mut() {
                            o.remove("shell");
                        }
                    }
                }
                synced_events.push(event.to_string());
            }
            continue;
        }
        arr.push(serde_json::json!({
            "matcher": "",
            "hooks": [spec.clone()]
        }));
        installed_events.push(event.to_string());
    }

    write_json_settings(&settings_path, &settings)?;
    Ok(serde_json::json!({ "installed_events": installed_events, "synced_events": synced_events }))
}

fn uninstall_json_hooks(settings_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let mut settings = read_json_settings(settings_path)?;
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
        write_json_settings(settings_path, &settings)?;
    }
    Ok(serde_json::json!({ "removed": removed }))
}

fn is_json_hook_installed(settings_path: &std::path::Path) -> Result<bool, String> {
    let settings = read_json_settings(settings_path)?;
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

// ------------------------------------------------------------------
// Codex：~/.codex/hooks.json + config.toml [features] hooks = true
// ------------------------------------------------------------------

fn codex_hooks_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("home dir not found")?;
    Ok(home.join(".codex").join("hooks.json"))
}

fn codex_config_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("home dir not found")?;
    Ok(home.join(".codex").join("config.toml"))
}

/// 在 config.toml 里启用 [features].hooks = true（行级解析 features 表，不引入 TOML 解析器）。
/// 尊重用户显式的 hooks = false；旧 key codex_hooks 迁移为 hooks。
fn ensure_codex_hooks_feature() -> Result<(), String> {
    let path = codex_config_path()?;
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();

    let is_section = |l: &str| {
        let t = l.trim();
        t.starts_with('[') && t.ends_with(']')
    };

    // 定位 [features] 段
    let mut in_features = false;
    let mut features_header: Option<usize> = None;
    let mut hooks_line: Option<usize> = None;
    let mut codex_hooks_line: Option<usize> = None;
    let mut hooks_value: Option<bool> = None;

    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if is_section(t) {
            in_features = t == "[features]";
            if in_features {
                features_header = Some(i);
            }
            continue;
        }
        if !in_features {
            continue;
        }
        if let Some(eq) = t.find('=') {
            let key = t[..eq].trim();
            let val = t[eq + 1..].trim().trim_matches('"').eq_ignore_ascii_case("true");
            if key == "hooks" {
                hooks_line = Some(i);
                hooks_value = Some(val);
            } else if key == "codex_hooks" {
                codex_hooks_line = Some(i);
                if hooks_value.is_none() {
                    hooks_value = Some(val);
                }
            }
        }
    }

    // 用户显式关闭：不动
    if hooks_value == Some(false) {
        return Ok(());
    }
    // 已启用且无迁移需求：不动
    if hooks_value == Some(true) && hooks_line.is_some() && codex_hooks_line.is_none() {
        return Ok(());
    }

    backup_file(&path);
    let mut out = lines.clone();
    match features_header {
        Some(h) => {
            // 有 [features]：更新/插入 hooks = true，移除旧 codex_hooks 行
            if let Some(hl) = hooks_line {
                out[hl] = "hooks = true".to_string();
            } else {
                let insert_at = codex_hooks_line.unwrap_or(h + 1);
                out.insert(insert_at, "hooks = true".to_string());
                // 插入后后续索引位移，重算 codex_hooks 行
                if let Some(chl) = codex_hooks_line {
                    let shifted = if chl >= insert_at { chl + 1 } else { chl };
                    out.remove(shifted);
                }
                write_lines_atomic(&path, &out)?;
                return Ok(());
            }
            if let Some(chl) = codex_hooks_line {
                out.remove(chl);
            }
            write_lines_atomic(&path, &out)
        }
        None => {
            // 没有 [features]：追加整段
            if !out.is_empty() && !out.last().map_or(true, |l| l.trim().is_empty()) {
                out.push(String::new());
            }
            out.push("[features]".to_string());
            out.push("hooks = true".to_string());
            write_lines_atomic(&path, &out)
        }
    }
}

fn write_lines_atomic(path: &std::path::Path, lines: &[String]) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid config path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut content = lines.join("\n");
    if !content.ends_with('\n') {
        content.push('\n');
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn install_codex_hooks(script_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let hooks_path = codex_hooks_path()?;
    backup_file(&hooks_path);
    let mut settings = read_json_settings(&hooks_path)?;

    let hooks = settings
        .as_object_mut()
        .ok_or("hooks.json 根节点不是对象")?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks 字段不是对象")?;

    let spec = codex_hook_spec(script_path);
    let mut installed_events = Vec::new();
    let mut synced_events = Vec::new();

    for event in agent_hook_events("codex") {
        let entries = hooks_obj
            .entry(event.to_string())
            .or_insert_with(|| serde_json::json!([]));
        let arr = entries.as_array_mut().ok_or(format!("hooks.{} 不是数组", event))?;
        if let Some(entry) = find_catrace_entry_mut(arr) {
            if let Some(hook) = catrace_hook_obj_mut(entry) {
                let new_cmd = spec.get("command").and_then(|c| c.as_str()).unwrap_or("");
                let existing = hook
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                if !existing.is_empty()
                    && (command_uses_absolute_node(new_cmd) || !command_uses_absolute_node(&existing))
                {
                    hook["command"] = spec["command"].clone();
                }
                // commandWindows 双字段（Windows）同步写入；POSIX 下无此字段则移除旧的
                match spec.get("commandWindows") {
                    Some(cw) => hook["commandWindows"] = cw.clone(),
                    None => {
                        if let Some(o) = hook.as_object_mut() {
                            o.remove("commandWindows");
                        }
                    }
                }
                if let Some(t) = spec.get("timeout") {
                    hook["timeout"] = t.clone();
                }
                synced_events.push(event.to_string());
            }
            continue;
        }
        arr.push(serde_json::json!({
            "hooks": [spec.clone()]
        }));
        installed_events.push(event.to_string());
    }

    write_json_settings(&hooks_path, &settings)?;
    ensure_codex_hooks_feature()?;
    Ok(serde_json::json!({ "installed_events": installed_events, "synced_events": synced_events }))
}

// ------------------------------------------------------------------
// Gemini CLI：~/.gemini/settings.json（entry 带 name 字段）
// ------------------------------------------------------------------

fn gemini_settings_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("home dir not found")?;
    Ok(home.join(".gemini").join("settings.json"))
}

fn install_gemini_hooks(script_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let settings_path = gemini_settings_path()?;
    backup_file(&settings_path);
    let mut settings = read_json_settings(&settings_path)?;

    let hooks = settings
        .as_object_mut()
        .ok_or("settings.json 根节点不是对象")?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks 字段不是对象")?;

    let command = gemini_hook_command(script_path);
    let mut installed_events = Vec::new();
    let mut synced_events = Vec::new();

    for event in agent_hook_events("gemini") {
        let entries = hooks_obj
            .entry(event.to_string())
            .or_insert_with(|| serde_json::json!([]));
        let arr = entries.as_array_mut().ok_or(format!("hooks.{} 不是数组", event))?;
        if let Some(entry) = find_catrace_entry_mut(arr) {
            if let Some(hook) = catrace_hook_obj_mut(entry) {
                let existing = hook
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                if !existing.is_empty()
                    && (command_uses_absolute_node(&command)
                        || !command_uses_absolute_node(&existing))
                {
                    hook["command"] = serde_json::json!(command);
                }
                synced_events.push(event.to_string());
            }
            continue;
        }
        arr.push(serde_json::json!({
            "matcher": "*",
            "hooks": [{
                "name": "catrace",
                "type": "command",
                "command": command
            }]
        }));
        installed_events.push(event.to_string());
    }

    write_json_settings(&settings_path, &settings)?;
    Ok(serde_json::json!({ "installed_events": installed_events, "synced_events": synced_events }))
}

// ------------------------------------------------------------------
// Kimi：~/.kimi/config.toml（旧）+ ~/.kimi-code/config.toml（新），TOML [[hooks]] 块
// ------------------------------------------------------------------

fn kimi_config_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".kimi").join("config.toml"));
        // Kimi Code 尊重 KIMI_CODE_HOME
        let kimi_code_dir = std::env::var("KIMI_CODE_HOME")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".kimi-code"));
        paths.push(kimi_code_dir.join("config.toml"));
    }
    paths
}

const KIMI_HOOK_BLOCK_HEADER: &str = "[[hooks]]";

fn kimi_config_has_hook(content: &str) -> bool {
    content.contains(KIMI_HOOK_BLOCK_HEADER) && content.contains(HOOK_SCRIPT_MARKER)
}

fn strip_kimi_hook_blocks(content: &str) -> (String, usize) {
    let lines: Vec<&str> = content.lines().collect();
    let mut output: Vec<&str> = Vec::new();
    let mut removed = 0usize;
    let mut i = 0;
    let is_header = |l: &str| {
        let t = l.trim();
        t.starts_with('[') && t.ends_with(']')
    };
    while i < lines.len() {
        let line = lines[i];
        if line.trim() == KIMI_HOOK_BLOCK_HEADER {
            let start = i;
            let mut j = i + 1;
            while j < lines.len() && !is_header(lines[j]) {
                j += 1;
            }
            let block = lines[start..j].join("\n");
            if block.contains(HOOK_SCRIPT_MARKER) {
                removed += 1;
            } else {
                output.extend(&lines[start..j]);
            }
            i = j;
        } else {
            output.push(line);
            i += 1;
        }
    }
    (output.join("\n"), removed)
}

fn install_kimi_hooks(script_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let command = kimi_hook_command(script_path);
    // TOML literal string（单引号）避免 Windows 路径反斜杠转义问题
    let command_escaped = command.replace('\'', "");
    let mut installed_targets = Vec::new();
    let mut synced_targets = Vec::new();

    for path in kimi_config_paths() {
        // 配置目录不存在说明这代 CLI 没装，跳过
        if !path.parent().map_or(false, |p| p.exists()) {
            continue;
        }
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        if kimi_config_has_hook(&content) {
            // 已装：strip 全部 catrace 块后重写，保证 command 随脚本路径/node 路径更新
            backup_file(&path);
            let (mut new_content, _) = strip_kimi_hook_blocks(&content);
            if !new_content.is_empty() && !new_content.ends_with('\n') {
                new_content.push('\n');
            }
            new_content.push('\n');
            for event in agent_hook_events("kimi") {
                new_content.push_str(&format!(
                    "{}\nevent = \"{}\"\ncommand = '{}'\nmatcher = \"\"\ntimeout = 30\n\n",
                    KIMI_HOOK_BLOCK_HEADER, event, command_escaped
                ));
            }
            let tmp = path.with_extension("tmp");
            std::fs::write(&tmp, &new_content).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
            synced_targets.push(path.display().to_string());
            continue;
        }
        backup_file(&path);
        let mut content = content;
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push('\n');
        for event in agent_hook_events("kimi") {
            content.push_str(&format!(
                "{}\nevent = \"{}\"\ncommand = '{}'\nmatcher = \"\"\ntimeout = 30\n\n",
                KIMI_HOOK_BLOCK_HEADER, event, command_escaped
            ));
        }
        // 原子写
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, &content).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        installed_targets.push(path.display().to_string());
    }

    if installed_targets.is_empty() && synced_targets.is_empty() {
        return Err("未找到 Kimi 配置目录（~/.kimi 或 ~/.kimi-code）".to_string());
    }
    Ok(serde_json::json!({ "installed_targets": installed_targets, "synced_targets": synced_targets }))
}

fn uninstall_kimi_hooks() -> Result<serde_json::Value, String> {
    let mut removed = 0usize;
    for path in kimi_config_paths() {
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let (new_content, n) = strip_kimi_hook_blocks(&content);
        if n > 0 {
            let tmp = path.with_extension("tmp");
            std::fs::write(&tmp, &new_content).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
            removed += n;
        }
    }
    Ok(serde_json::json!({ "removed": removed }))
}

fn is_kimi_hook_installed() -> bool {
    kimi_config_paths().iter().any(|p| {
        std::fs::read_to_string(p)
            .map(|c| kimi_config_has_hook(&c))
            .unwrap_or(false)
    })
}

// ------------------------------------------------------------------
// 命令入口：按 agent 分发
// ------------------------------------------------------------------

#[tauri::command]
pub fn install_agent_hooks(app: tauri::AppHandle, agent: String) -> Result<serde_json::Value, String> {
    let script_path = ensure_hook_script(&app)?;
    match agent.as_str() {
        "claude" => install_claude_hooks(&script_path),
        "codex" => install_codex_hooks(&script_path),
        "gemini" => install_gemini_hooks(&script_path),
        "kimi" => install_kimi_hooks(&script_path),
        _ => Err(format!("不支持的 agent: {}", agent)),
    }
}

#[tauri::command]
pub fn uninstall_agent_hooks(agent: String) -> Result<serde_json::Value, String> {
    match agent.as_str() {
        "claude" => uninstall_json_hooks(&claude_settings_path()?),
        "codex" => uninstall_json_hooks(&codex_hooks_path()?),
        "gemini" => uninstall_json_hooks(&gemini_settings_path()?),
        "kimi" => uninstall_kimi_hooks(),
        _ => Err(format!("不支持的 agent: {}", agent)),
    }
}

#[tauri::command]
pub fn is_agent_hook_installed(agent: String) -> Result<bool, String> {
    match agent.as_str() {
        "claude" => is_json_hook_installed(&claude_settings_path()?),
        "codex" => is_json_hook_installed(&codex_hooks_path()?),
        "gemini" => is_json_hook_installed(&gemini_settings_path()?),
        "kimi" => Ok(is_kimi_hook_installed()),
        _ => Err(format!("不支持的 agent: {}", agent)),
    }
}
