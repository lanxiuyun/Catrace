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

/// 固定监听端口。
/// 用 23456 而非 clawd 的 23333：clawd 的 /state 与 PermissionRequest(http) 都指向 23333，
/// 共存时 23333 被 clawd 占用会导致 Catrace 绑定失败、通知静默失效。23456 不在 clawd
/// 探测范围（23333–23337）内，二者可独立运行互不抢占。
const AGENT_HOOK_PORT: u16 = 23456;
/// 所有可订阅的 hook 事件；每个事件的显示策略由用户配置。
/// 注意：PermissionRequest 走阻塞 HTTP（type:"http"）做真审批，不再注册 command hook，
/// 因此不在 KNOWN_EVENTS / 三态策略里。
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

/// 临时诊断：把 hook 请求落盘到 TEMP/catrace-hook-hit.log，绕开应用日志系统。
/// 排查「客户端是否把 http hook 发到 Catrace」——应用日志可能因 dev 缓冲看不到。
fn debug_log_hit(msg: &str) {
    let mut path = std::env::temp_dir();
    path.push("catrace-hook-hit.log");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
}

/// 事件显示策略：off=不通知 / auto=弹出后自动消失 / sticky=常驻直到用户关闭。
fn default_event_mode(event: &str) -> &'static str {
    match event {
        // 召唤型：完成/出错/喊你 → 默认常驻；用户可在设置里改 off/auto/sticky
        "Stop" | "StopFailure" | "Notification" => "sticky",
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
    /// /state 由 hook 脚本带 event；/permission 由 Claude http hook 直发、只有 hook_event_name
    #[serde(default)]
    event: String,
    /// Claude http hook（PermissionRequest）带的事件名，event 缺失时兜底
    #[serde(default)]
    hook_event_name: String,
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
    /// PermissionRequest 带来的工具输入（bash 命令、文件路径等），审批卡展示用
    #[serde(default)]
    tool_input: Option<serde_json::Value>,
    /// 部分 agent / clawd 会直接带会话标题；没有则从 transcript 的 ai-title 行兜底
    #[serde(default)]
    session_title: String,
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

/// 从 transcript 取会话标题。
/// Claude Desktop / Code 会写 `{"type":"ai-title","aiTitle":"修复 approve…"}`（侧栏显示的名字）。
/// 从后往前找最新一条；没有则 None，前端退回 cwd 项目名。
fn extract_session_title(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    for line in text.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        // Claude：ai-title / aiTitle；兼容其它可能字段
        if ty == "ai-title" || ty == "title" || ty == "session-title" {
            for key in ["aiTitle", "title", "session_title", "sessionTitle", "name"] {
                if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
                    let s = s.trim();
                    if !s.is_empty() {
                        return Some(truncate_chars(s, 60));
                    }
                }
            }
        }
    }
    None
}

/// payload.session_title 优先；否则读 transcript。
fn resolve_session_title(payload: &AgentHookPayload) -> Option<String> {
    let direct = payload.session_title.trim();
    if !direct.is_empty() {
        return Some(truncate_chars(direct, 60));
    }
    extract_session_title(&payload.transcript_path)
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
        // 每个请求单独线程：/permission 会阻塞数分钟，若串行处理会卡住后续 /state，
        // 表现为「审批中发了 Stop 卡不弹，点完审批才一起刷出来」。
        for request in server.incoming_requests() {
            let app = app.clone();
            thread::spawn(move || handle_request(&app, request));
        }
    });
}

fn handle_request(app: &tauri::AppHandle, mut request: tiny_http::Request) {
    // 临时诊断：把每个进来的请求落盘，绕开应用日志（排查 http hook 是否到达）
    debug_log_hit(&format!("HIT {} {}", request.method(), request.url()));
    // 主日志同步记一条「请求到达」，一眼确认 /permission 来没来（不用翻后面路由分支）
    log_info!(
        "agent-hook",
        ">>> 收到 HTTP 请求 {} {}",
        request.method(),
        request.url()
    );

    let url = request.url().to_string();
    // 浏览器测试页（file:// 或 localhost）会先发 OPTIONS 预检；只开放本机 hook 路径
    if request.method() == &tiny_http::Method::Options {
        let _ = request.respond(cors_empty(204));
        return;
    }

    if request.method() != &tiny_http::Method::Post {
        let _ = request.respond(cors_empty(404));
        return;
    }
    if url != "/state" && url != "/permission" {
        let _ = request.respond(cors_empty(404));
        return;
    }

    let mut body = String::new();
    if request.as_reader().read_to_string(&mut body).is_err() {
        let _ = request.respond(cors_empty(400));
        return;
    }

    debug_log_hit(&format!("BODY {} -> {}", url, body));

    let mut payload: AgentHookPayload = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(e) => {
            log_error!(
                "agent-hook",
                "JSON 解析失败 url={} err={} body={}",
                url,
                e,
                body
            );
            let _ = request.respond(cors_empty(400));
            return;
        }
    };
    // /permission 由 Claude http hook 直发，body 只有 hook_event_name 没有 event，补齐
    if payload.event.is_empty() {
        payload.event = payload.hook_event_name.clone();
    }

    // 阻塞式权限审批：挂起连接，等 UI 决策或超时才响应
    if url == "/permission" {
        log_info!(
            "agent-hook",
            "【审批】命中 /permission，tool={} session={} enabled={}",
            payload.tool_name,
            payload.session_id,
            SERVER_ENABLED.load(Ordering::SeqCst)
        );
        handle_permission(app, request, payload);
        return;
    }

    // /state：立即响应，不阻塞 agent 的 hook 执行（带 CORS，方便本地网页测试）
    let _ = request.respond(cors_empty(200));

    if !SERVER_ENABLED.load(Ordering::SeqCst) {
        return;
    }

    // 自动销项：用户重新提交 prompt 说明已回到该会话，撤掉对应 sticky 待办。
    // 即使 UserPromptSubmit 自身 mode=off（默认），也要处理销项。
    // 同时：该 session 若有挂起的 /permission，立即 timeout 放行，避免 Claude 卡在阻塞 hook
    // （用户已换话题/重开对话，旧审批卡无人点就会把 agent 线程挂死）。
    if payload.event == "UserPromptSubmit"
        && !payload.session_id.is_empty()
        && payload.session_id != "unknown"
    {
        let cancelled = timeout_pending_permissions_for_session(&payload.session_id);
        if cancelled > 0 {
            log_info!(
                "agent-hook",
                "UserPromptSubmit：取消 session={} 的 {} 个挂起审批",
                payload.session_id,
                cancelled
            );
        }
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

    let summary = summarize_transcript(&payload.transcript_path);
    let session_title = resolve_session_title(&payload);
    crate::reminder_toast::create_agent_toast_window(
        app,
        &payload.event,
        &payload.state,
        &mode,
        &payload.session_id,
        &payload.cwd,
        &payload.prompt,
        summary.as_deref(),
        session_title.as_deref(),
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
// P6：阻塞式权限审批（POST /permission）
// ------------------------------------------------------------------

/// 挂起的权限请求：decision 为 None 表示还在等 UI。
/// HTTP 响应由接收线程在决策到达后直接写 raw writer 完成（`into_writer`），
/// 因为 tiny_http 的 Request::respond 消费 Request、无法跨线程暂存。
struct PendingPermission {
    session_id: String,
    decision: Option<String>,
}

/// request_id → 挂起请求。tiny_http 的 Request 只能在接收线程响应，
/// 所以这里存「decision + 未发送的 response」，由接收线程轮询取回并完成。
static PENDING_PERMISSIONS: Mutex<Option<HashMap<u64, PendingPermission>>> = Mutex::new(None);
static PERMISSION_ID_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Claude hook 侧 timeout（秒）。略大于审批等待，保证是 Catrace 先回决策/超时，而非 Claude 先放弃。
const CLAUDE_PERMISSION_HOOK_TIMEOUT_SECS: u64 = 600;
/// Catrace 审批等待时长（秒）：超时回 timeout 决策，让 Claude 回退终端，不永久挂起。
const PERMISSION_AWAIT_TIMEOUT: Duration = Duration::from_secs(540);

/// 阻塞处理一个权限请求：挂起 ~9 分钟，轮询等 UI 决策；超时回 timeout。
/// 决策通过 `resolve_permission`（UI 按钮 invoke）写入 PENDING_PERMISSIONS。
fn handle_permission(app: &tauri::AppHandle, request: tiny_http::Request, payload: AgentHookPayload) {
    let request_id = PERMISSION_ID_COUNTER.fetch_add(1, Ordering::SeqCst);
    log_info!(
        "agent-hook",
        "/permission 收到请求 id={} tool={} session={}",
        request_id,
        payload.tool_name,
        payload.session_id
    );
    let mut writer = request.into_writer();

    // 同 session 若已有挂起审批，先 timeout 掉旧的——Claude 通常一会话同时只等一个，
    // 残留旧卡会让旧连接一直占着接收线程，表现为「session 改了线程卡死」。
    if !payload.session_id.is_empty() && payload.session_id != "unknown" {
        let superseded = timeout_pending_permissions_for_session(&payload.session_id);
        if superseded > 0 {
            log_info!(
                "agent-hook",
                "/permission id={} 顶替同 session 旧审批 {} 个",
                request_id,
                superseded
            );
            // 顺手撤掉旧审批卡，避免 UI 上残留无人认领的按钮
            crate::reminder_toast::dismiss_agent_session_toast(app, &payload.session_id);
        }
    }

    {
        let mut guard = PENDING_PERMISSIONS.lock().unwrap();
        guard.get_or_insert_with(HashMap::new).insert(
            request_id,
            PendingPermission {
                session_id: payload.session_id.clone(),
                decision: None,
            },
        );
    }

    // 弹审批卡（独立于待办 sticky；窗口不存在则前端不入队，卡片丢但决策仍会超时回退）
    log_info!(
        "agent-hook",
        "/permission id={} 调用 create_agent_permission_window",
        request_id
    );
    crate::reminder_toast::create_agent_permission_window(
        app,
        request_id,
        &payload.tool_name,
        payload.tool_input.as_ref(),
        &payload.session_id,
        &payload.cwd,
    );
    log_info!(
        "agent-hook",
        "/permission id={} 建窗调用已派发，进入决策轮询",
        request_id
    );

    let deadline = Instant::now() + PERMISSION_AWAIT_TIMEOUT;
    let decision = loop {
        if let Some(d) = take_permission_decision(request_id) {
            break d;
        }
        if Instant::now() >= deadline {
            remove_pending_permission(request_id);
            break "timeout".to_string();
        }
        thread::sleep(Duration::from_millis(150));
    };

    log_info!("agent-hook", "/permission id={} 决策={}", request_id, decision);

    // 手写 HTTP 响应（raw writer 上没有 Response 便捷封装）
    // 带 CORS，本地网页测试页才能读到决策 body
    let body = build_permission_response_body(&decision);
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
        body.len()
    );
    use std::io::Write;
    let _ = writer.write_all(head.as_bytes());
    let _ = writer.write_all(body.as_bytes());
    let _ = writer.flush();
}

/// 带 CORS 头的空响应。浏览器测试页（file:// / localhost）直连本机 hook 时需要。
/// Claude / Node hook 不读这些头，无影响。
fn cors_empty(status: u16) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = tiny_http::Response::from_data(Vec::new()).with_status_code(status);
    for (k, v) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type"),
    ] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            resp.add_header(h);
        }
    }
    resp
}

/// 取走某个请求的决策（若有）。取走后 PendingPermission 被移除。
fn take_permission_decision(request_id: u64) -> Option<String> {
    let mut guard = PENDING_PERMISSIONS.lock().unwrap();
    let map = guard.as_mut()?;
    let pending = map.get_mut(&request_id)?;
    if pending.decision.is_some() {
        // 决策一旦取走就从 map 删掉，避免残留条目挡住后续同 id 判断
        let d = pending.decision.take();
        map.remove(&request_id);
        return d;
    }
    None
}

fn remove_pending_permission(request_id: u64) {
    if let Some(map) = PENDING_PERMISSIONS.lock().unwrap().as_mut() {
        map.remove(&request_id);
    }
}

/// 把指定 session 下所有尚未决策的挂起审批标为 timeout。
/// 接收线程轮询到后会回 `{}`，Claude 回退终端审批，不再永久挂起。
/// 返回被取消的数量。
fn timeout_pending_permissions_for_session(session_id: &str) -> usize {
    if session_id.is_empty() || session_id == "unknown" {
        return 0;
    }
    let mut guard = PENDING_PERMISSIONS.lock().unwrap();
    let Some(map) = guard.as_mut() else {
        return 0;
    };
    let mut n = 0;
    for pending in map.values_mut() {
        if pending.session_id == session_id && pending.decision.is_none() {
            pending.decision = Some("timeout".to_string());
            n += 1;
        }
    }
    n
}

/// 构造 Claude 期望的决策 JSON。timeout 不回 hookSpecificOutput，让 Claude 回退终端审批。
fn build_permission_response_body(decision: &str) -> String {
    match decision {
        "allow" | "deny" => serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": decision }
            }
        })
        .to_string(),
        _ => "{}".to_string(), // timeout / 其他：空对象 → Claude 回退终端
    }
}

/// 判断一个 request_id 是否还在等待（前端用来避免对已完成/超时的请求发决策）。
fn is_permission_pending(request_id: u64) -> bool {
    PENDING_PERMISSIONS
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|m| m.contains_key(&request_id))
}

/// UI 决策入口：前端点 Allow/Deny/前往终端时调用。
/// 返回 true 表示决策被接受（请求仍在等待）；false 表示请求已超时/不存在。
#[tauri::command]
pub fn resolve_permission(request_id: u64, decision: String) -> bool {
    if !["allow", "deny", "timeout"].contains(&decision.as_str()) {
        return false;
    }
    if !is_permission_pending(request_id) {
        return false;
    }
    let mut guard = PENDING_PERMISSIONS.lock().unwrap();
    if let Some(pending) = guard.as_mut().and_then(|m| m.get_mut(&request_id)) {
        // 已有决策不覆盖（UserPromptSubmit 取消与用户点击竞态时，先到者胜）
        if pending.decision.is_some() {
            return false;
        }
        pending.decision = Some(decision);
        return true;
    }
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
    let has_marker = |cmd: Option<&str>| cmd.is_some_and(|s| s.contains(HOOK_SCRIPT_MARKER));
    if has_marker(entry.get("command").and_then(|c| c.as_str())) {
        return true;
    }
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .is_some_and(|hooks| {
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
        .is_some_and(|s| s.contains(HOOK_SCRIPT_MARKER))
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
                    .is_some_and(|s| s.contains(HOOK_SCRIPT_MARKER))
            })
        })
}

/// 判断一个 url 是否是 Catrace 的权限审批端点（http hook 的 marker 等价物）。
fn is_catrace_permission_url(url: &str) -> bool {
    url.contains("/permission") && url.contains(&format!(":{}", AGENT_HOOK_PORT))
}

/// 在 entry 数组里找到 Catrace 的 http 权限 hook（type:"http" + url 指向本地 /permission）的可变引用。
/// 用于 P6 安装幂等：命中则更新 url/timeout，未命中则追加。
fn find_catrace_permission_hook_mut(
    arr: &mut [serde_json::Value],
) -> Option<&mut serde_json::Value> {
    arr.iter_mut().find_map(|entry| {
        // entry 自身是 http hook
        let entry_is_http = entry.get("type").and_then(|t| t.as_str()) == Some("http")
            && entry
                .get("url")
                .and_then(|u| u.as_str())
                .is_some_and(is_catrace_permission_url);
        if entry_is_http {
            return Some(entry);
        }
        // entry.hooks[] 里有 http hook
        entry
            .get_mut("hooks")
            .and_then(|h| h.as_array_mut())
            .and_then(|hooks| {
                hooks.iter_mut().find(|h| {
                    h.get("type").and_then(|t| t.as_str()) == Some("http")
                        && h.get("url")
                            .and_then(|u| u.as_str())
                            .is_some_and(is_catrace_permission_url)
                })
            })
    })
}

/// 判断一个 entry 是否是 Catrace 的 http 权限 hook（不可变版，卸载用）。
fn entry_is_catrace_permission_hook(entry: &serde_json::Value) -> bool {
    let url_is = |v: &serde_json::Value| {
        v.get("type").and_then(|t| t.as_str()) == Some("http")
            && v.get("url")
                .and_then(|u| u.as_str())
                .is_some_and(is_catrace_permission_url)
    };
    if url_is(entry) {
        return true;
    }
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .is_some_and(|hooks| hooks.iter().any(url_is))
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
/// 各 agent 写入配置的「状态通知」command hook 事件。
/// PermissionRequest 不在此列：Claude 走 type:"http" 阻塞审批（见 install_claude_hooks 末尾），
/// Codex/Kimi/Gemini 的真审批 v1 未做，旧 command hook 会在安装时被清除（回退终端原生审批）。
fn agent_hook_events(agent: &str) -> &'static [&'static str] {
    match agent {
        "codex" => &["SessionStart", "UserPromptSubmit", "Stop"],
        // Gemini 无 PermissionRequest；BeforeTool 是 gating hook，需 stdout 决策，暂不注册
        "gemini" => &["SessionStart", "BeforeAgent", "AfterAgent", "Notification"],
        "kimi" => &["SessionStart", "UserPromptSubmit", "Stop", "Notification"],
        // Claude 状态事件全集
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

    // ── P6：Claude 权限真审批 ──
    // 1. 清掉 PermissionRequest 下残留的 command hook（旧 P3 只通知版），避免与 http hook 双发
    let mut perm_command_removed = false;
    if let Some(serde_json::Value::Array(arr)) = hooks_obj.get_mut("PermissionRequest") {
        let before = arr.len();
        arr.retain(|e| !entry_contains_catrace_hook(e));
        perm_command_removed = before != arr.len();
    }
    // 2. 注册 type:"http" 阻塞 hook，Claude 会挂起等 /permission 的决策响应
    let perm_url = format!("http://127.0.0.1:{}/permission", AGENT_HOOK_PORT);
    let perm_entries = hooks_obj
        .entry("PermissionRequest".to_string())
        .or_insert_with(|| serde_json::json!([]));
    let perm_arr = perm_entries
        .as_array_mut()
        .ok_or("hooks.PermissionRequest 不是数组")?;
    let perm_hook = serde_json::json!({
        "type": "http",
        "url": perm_url,
        "timeout": CLAUDE_PERMISSION_HOOK_TIMEOUT_SECS
    });
    let mut perm_synced = false;
    if let Some(existing) = find_catrace_permission_hook_mut(perm_arr) {
        if existing.get("url").and_then(|u| u.as_str()) != Some(perm_url.as_str()) {
            existing["url"] = serde_json::json!(perm_url);
        }
        existing["timeout"] = serde_json::json!(CLAUDE_PERMISSION_HOOK_TIMEOUT_SECS);
        perm_synced = true;
    } else {
        perm_arr.push(serde_json::json!({ "matcher": "", "hooks": [perm_hook] }));
    }
    if perm_command_removed || perm_synced {
        synced_events.push("PermissionRequest".to_string());
    } else {
        installed_events.push("PermissionRequest(http)".to_string());
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
                // 清 command hook（marker）与 http 权限 hook（url 指向本地 /permission）
                arr.retain(|e| !entry_contains_catrace_hook(e) && !entry_is_catrace_permission_hook(e));
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
            if !out.is_empty() && !out.last().is_none_or(|l| l.trim().is_empty()) {
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

    // Codex 真审批 v1 未做：清掉旧 P3 只通知版的 PermissionRequest command hook，回退终端原生审批
    if let Some(serde_json::Value::Array(arr)) = hooks_obj.get_mut("PermissionRequest") {
        arr.retain(|e| !entry_contains_catrace_hook(e));
        if arr.is_empty() {
            hooks_obj.remove("PermissionRequest");
        }
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
        if !path.parent().is_some_and(|p| p.exists()) {
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
