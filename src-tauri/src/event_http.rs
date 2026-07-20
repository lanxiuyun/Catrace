use std::collections::VecDeque;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::bus::EventBus;
use crate::db::Db;
use crate::event::{
    BusEvent, DisplayMode, EventAction, EventLevel, EventPatch, EventProgress, EventResolution,
    EventSource, EventStatus, ResolutionKind,
};
use crate::{log_error, log_info};

pub const EVENT_HTTP_PORT: u16 = 23457;
const ENABLED_SETTING_KEY: &str = "event_sdk_enabled";
const TOKEN_SETTING_KEY: &str = "event_sdk_token";
const MAX_BODY_BYTES: usize = 128 * 1024;
const RATE_WINDOW: Duration = Duration::from_secs(1);
const RATE_MAX_REQUESTS: usize = 10;
const RATE_MAX_PUBLISH: usize = 5;

static SERVER_STARTED: AtomicBool = AtomicBool::new(false);
static SERVER_ENABLED: AtomicBool = AtomicBool::new(true);
static TOKEN: Mutex<Option<String>> = Mutex::new(None);

/// Reserved toast kinds owned by internal producers — external SDK cannot impersonate them.
const RESERVED_KINDS: &[&str] = &[
    "rest",
    "water",
    "eye",
    "agent",
    "permission",
    "update",
    "rest-timer",
];

struct RateLimiter {
    all: VecDeque<Instant>,
    publish: VecDeque<Instant>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            all: VecDeque::new(),
            publish: VecDeque::new(),
        }
    }

    fn allow(&mut self, is_publish: bool) -> bool {
        let now = Instant::now();
        while self
            .all
            .front()
            .is_some_and(|t| now.duration_since(*t) > RATE_WINDOW)
        {
            self.all.pop_front();
        }
        while self
            .publish
            .front()
            .is_some_and(|t| now.duration_since(*t) > RATE_WINDOW)
        {
            self.publish.pop_front();
        }
        if self.all.len() >= RATE_MAX_REQUESTS {
            return false;
        }
        if is_publish && self.publish.len() >= RATE_MAX_PUBLISH {
            return false;
        }
        self.all.push_back(now);
        if is_publish {
            self.publish.push_back(now);
        }
        true
    }
}

fn generate_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn load_or_create_token(db: &Db) -> String {
    let existing = db.get_setting(TOKEN_SETTING_KEY, "");
    if !existing.is_empty() {
        return existing;
    }
    let token = generate_token();
    if let Err(e) = db.set_setting(TOKEN_SETTING_KEY, &token) {
        log_error!("event-http", "failed to persist sdk token: {}", e);
    }
    token
}

fn set_token_memory(token: String) {
    *TOKEN.lock().unwrap() = Some(token);
}

fn token_matches(header_val: Option<&str>) -> bool {
    let Some(raw) = header_val else {
        return false;
    };
    let bearer = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .unwrap_or(raw)
        .trim();
    if bearer.is_empty() {
        return false;
    }
    let guard = TOKEN.lock().unwrap();
    match guard.as_deref() {
        Some(t) => t == bearer,
        None => false,
    }
}

fn is_sdk_source(source: &EventSource) -> bool {
    matches!(source, EventSource::Sdk)
}

/// Start localhost Event HTTP API (127.0.0.1:23457). Safe to call once per process.
pub fn start_server(bus: EventBus, db: Db) {
    if SERVER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let enabled = db.get_setting(ENABLED_SETTING_KEY, "true") == "true";
    SERVER_ENABLED.store(enabled, Ordering::SeqCst);
    let token = load_or_create_token(&db);
    set_token_memory(token);

    let limiter = Arc::new(Mutex::new(RateLimiter::new()));

    thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", EVENT_HTTP_PORT);
        let server = match tiny_http::Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                log_error!("event-http", "failed to bind {}: {}", addr, e);
                SERVER_STARTED.store(false, Ordering::SeqCst);
                return;
            }
        };
        log_info!("event-http", "listening on http://{}/v1", addr);
        for request in server.incoming_requests() {
            let bus = bus.clone();
            let limiter = limiter.clone();
            thread::spawn(move || handle_request(bus, limiter, request));
        }
    });
}

fn handle_request(
    bus: EventBus,
    limiter: Arc<Mutex<RateLimiter>>,
    mut request: tiny_http::Request,
) {
    let method = request.method().as_str().to_string();
    let url = request.url().to_string();
    let (path, _query) = split_url(&url);

    // No CORS by default (scripts/curl only). Reject browser preflight cleanly.
    if method == "OPTIONS" {
        let _ = request.respond(json_response(204, json!({})));
        return;
    }

    if path == "/v1/health" && method == "GET" {
        let _ = request.respond(json_response(
            200,
            json!({
                "ok": true,
                "service": "catrace-event-api",
                "api": "v1",
                "port": EVENT_HTTP_PORT,
                "enabled": SERVER_ENABLED.load(Ordering::SeqCst),
                "version": env!("CARGO_PKG_VERSION"),
            }),
        ));
        return;
    }

    let is_publish = method == "POST" && path == "/v1/events";
    {
        let mut lim = limiter.lock().unwrap();
        if !lim.allow(is_publish) {
            let _ = request.respond(error_response(429, "rate limit exceeded"));
            return;
        }
    }

    let auth = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str());
    if !token_matches(auth) {
        let _ = request.respond(error_response(401, "unauthorized"));
        return;
    }

    if !SERVER_ENABLED.load(Ordering::SeqCst) {
        let _ = request.respond(error_response(503, "event sdk disabled"));
        return;
    }

    let result = match (method.as_str(), path.as_str()) {
        ("POST", "/v1/events") => {
            let body = read_body(&mut request);
            body.and_then(|b| publish_from_body(&bus, &b))
        }
        ("GET", "/v1/events") => list_sdk_active(&bus),
        ("GET", p) if p.starts_with("/v1/events/") => {
            let id = &p["/v1/events/".len()..];
            if id.is_empty() || id.contains('/') {
                Err(HttpErr::new(404, "not found"))
            } else {
                get_sdk_event(&bus, id)
            }
        }
        ("PATCH", p) if p.starts_with("/v1/events/") => {
            let rest = &p["/v1/events/".len()..];
            if rest.is_empty() || rest.contains('/') {
                Err(HttpErr::new(404, "not found"))
            } else {
                let body = read_body(&mut request);
                body.and_then(|b| patch_sdk_event(&bus, rest, &b))
            }
        }
        ("POST", p) if p.starts_with("/v1/events/") && p.ends_with("/resolve") => {
            let mid = &p["/v1/events/".len()..];
            let id = mid.strip_suffix("/resolve").unwrap_or("");
            if id.is_empty() || id.contains('/') {
                Err(HttpErr::new(404, "not found"))
            } else {
                let body = read_body(&mut request);
                body.and_then(|b| resolve_sdk_event(&bus, id, &b))
            }
        }
        _ => Err(HttpErr::new(404, "not found")),
    };

    match result {
        Ok((code, value)) => {
            let _ = request.respond(json_response(code, value));
        }
        Err(e) => {
            let _ = request.respond(error_response(e.status, &e.message));
        }
    }
}

struct HttpErr {
    status: u16,
    message: String,
}

impl HttpErr {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

fn bus_err(e: String) -> HttpErr {
    let status = if e.starts_with("event not found") {
        404
    } else if e.starts_with("event is not active") {
        409
    } else {
        400
    };
    HttpErr::new(status, e)
}

fn split_url(url: &str) -> (String, String) {
    match url.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (url.to_string(), String::new()),
    }
}

fn read_body(request: &mut tiny_http::Request) -> Result<String, HttpErr> {
    let mut buf = Vec::new();
    request
        .as_reader()
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|_| HttpErr::new(400, "failed to read body"))?;
    if buf.len() > MAX_BODY_BYTES {
        return Err(HttpErr::new(400, "body too large"));
    }
    String::from_utf8(buf).map_err(|_| HttpErr::new(400, "body is not utf-8"))
}

#[derive(Debug, Deserialize)]
struct PublishBody {
    #[serde(default)]
    event_type: Option<String>,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    level: Option<EventLevel>,
    #[serde(default)]
    sticky: Option<bool>,
    #[serde(default)]
    actions: Option<Vec<EventAction>>,
    #[serde(default)]
    progress: Option<EventProgress>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    #[serde(default)]
    dedupe_key: Option<String>,
    #[serde(default)]
    expires_at: Option<i64>,
    #[serde(default)]
    correlation_id: Option<String>,
    /// Accepted only to reject reserved values; always forced to "sdk".
    #[serde(default)]
    kind: Option<String>,
}

fn publish_from_body(bus: &EventBus, raw: &str) -> Result<(u16, serde_json::Value), HttpErr> {
    let body: PublishBody =
        serde_json::from_str(raw).map_err(|e| HttpErr::new(400, format!("invalid json: {e}")))?;
    if body.title.trim().is_empty() {
        return Err(HttpErr::new(400, "title is required"));
    }
    if let Some(k) = body.kind.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if RESERVED_KINDS.contains(&k) {
            return Err(HttpErr::new(
                403,
                format!("kind '{k}' is reserved for internal producers"),
            ));
        }
        if k != "sdk" {
            return Err(HttpErr::new(
                400,
                "external events must use kind 'sdk' (or omit kind)",
            ));
        }
    }

    let event_type = body
        .event_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("sdk.notify")
        .to_string();

    let event = BusEvent {
        id: String::new(),
        event_type,
        source: EventSource::Sdk,
        kind: "sdk".into(),
        display_mode: DisplayMode::Toast,
        level: body.level.unwrap_or(EventLevel::Info),
        title: body.title,
        body: body.body.unwrap_or_default(),
        actions: body.actions.unwrap_or_default(),
        progress: body.progress,
        sticky: body.sticky,
        payload: body.payload.unwrap_or(json!({})),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 1,
        resolved_at: None,
        resolution: None,
        expires_at: body.expires_at,
        correlation_id: body.correlation_id,
        dedupe_key: body.dedupe_key,
    };

    let out = bus.publish(event).map_err(bus_err)?;
    Ok((201, serde_json::to_value(out).unwrap_or(json!({}))))
}

fn list_sdk_active(bus: &EventBus) -> Result<(u16, serde_json::Value), HttpErr> {
    let list = bus.active_events().map_err(bus_err)?;
    let sdk: Vec<_> = list.into_iter().filter(|e| is_sdk_source(&e.source)).collect();
    Ok((200, serde_json::to_value(sdk).unwrap_or(json!([]))))
}

fn get_sdk_event(bus: &EventBus, id: &str) -> Result<(u16, serde_json::Value), HttpErr> {
    let event = bus
        .get(id)
        .map_err(bus_err)?
        .ok_or_else(|| HttpErr::new(404, format!("event not found: {id}")))?;
    if !is_sdk_source(&event.source) {
        return Err(HttpErr::new(403, "forbidden"));
    }
    Ok((200, serde_json::to_value(event).unwrap_or(json!({}))))
}

fn patch_sdk_event(
    bus: &EventBus,
    id: &str,
    raw: &str,
) -> Result<(u16, serde_json::Value), HttpErr> {
    ensure_sdk_active(bus, id)?;
    let patch: EventPatch =
        serde_json::from_str(raw).map_err(|e| HttpErr::new(400, format!("invalid json: {e}")))?;
    // Keep display_mode locked to toast for sdk events.
    let mut patch = patch;
    if patch.display_mode.is_some() {
        patch.display_mode = Some(DisplayMode::Toast);
    }
    let out = bus.update(id.to_string(), patch).map_err(bus_err)?;
    Ok((200, serde_json::to_value(out).unwrap_or(json!({}))))
}

#[derive(Debug, Deserialize)]
struct ResolveBody {
    #[serde(default)]
    kind: Option<ResolutionKind>,
    #[serde(default)]
    action_id: Option<String>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
}

fn resolve_sdk_event(
    bus: &EventBus,
    id: &str,
    raw: &str,
) -> Result<(u16, serde_json::Value), HttpErr> {
    ensure_sdk_active(bus, id)?;
    let body: ResolveBody = if raw.trim().is_empty() {
        ResolveBody {
            kind: None,
            action_id: None,
            payload: None,
        }
    } else {
        serde_json::from_str(raw).map_err(|e| HttpErr::new(400, format!("invalid json: {e}")))?
    };

    let out = if let Some(action_id) = body
        .action_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        bus.resolve_action(id.to_string(), action_id.to_string(), body.payload)
            .map_err(bus_err)?
    } else {
        bus.resolve(
            id.to_string(),
            EventResolution {
                kind: body.kind.unwrap_or(ResolutionKind::Dismissed),
                action_id: None,
                payload: body.payload,
            },
        )
        .map_err(bus_err)?
    };
    Ok((200, serde_json::to_value(out).unwrap_or(json!({}))))
}

fn ensure_sdk_active(bus: &EventBus, id: &str) -> Result<(), HttpErr> {
    let event = bus
        .get(id)
        .map_err(bus_err)?
        .ok_or_else(|| HttpErr::new(404, format!("event not found: {id}")))?;
    if !is_sdk_source(&event.source) {
        return Err(HttpErr::new(403, "forbidden"));
    }
    if event.status != EventStatus::Active {
        return Err(HttpErr::new(409, format!("event is not active: {id}")));
    }
    Ok(())
}

fn json_response(status: u16, value: serde_json::Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let data = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    let mut resp = tiny_http::Response::from_data(data).with_status_code(status);
    if let Ok(h) = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
        resp.add_header(h);
    }
    if let Ok(h) = tiny_http::Header::from_bytes(&b"Connection"[..], &b"close"[..]) {
        resp.add_header(h);
    }
    resp
}

fn error_response(status: u16, message: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    json_response(status, json!({ "error": message }))
}

// ---------- Tauri commands (settings UI) ----------

#[derive(Debug, Clone, Serialize)]
pub struct EventSdkStatus {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub base_url: String,
}

#[tauri::command]
pub fn get_event_sdk_status(db: State<'_, Db>) -> Result<EventSdkStatus, String> {
    let enabled = db.get_setting(ENABLED_SETTING_KEY, "true") == "true";
    let token = {
        let guard = TOKEN.lock().map_err(|e| e.to_string())?;
        if let Some(t) = guard.as_ref().filter(|t| !t.is_empty()) {
            t.clone()
        } else {
            drop(guard);
            let t = load_or_create_token(&db);
            set_token_memory(t.clone());
            t
        }
    };
    Ok(EventSdkStatus {
        enabled,
        port: EVENT_HTTP_PORT,
        token,
        base_url: format!("http://127.0.0.1:{}", EVENT_HTTP_PORT),
    })
}

#[tauri::command]
pub fn set_event_sdk_enabled(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.set_setting(ENABLED_SETTING_KEY, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    SERVER_ENABLED.store(enabled, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn rotate_event_sdk_token(db: State<'_, Db>) -> Result<String, String> {
    let token = generate_token();
    db.set_setting(TOKEN_SETTING_KEY, &token)
        .map_err(|e| e.to_string())?;
    set_token_memory(token.clone());
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limiter_blocks_burst() {
        let mut lim = RateLimiter::new();
        for _ in 0..RATE_MAX_REQUESTS {
            assert!(lim.allow(false));
        }
        assert!(!lim.allow(false));
    }

    #[test]
    fn rate_limiter_publish_cap() {
        let mut lim = RateLimiter::new();
        for _ in 0..RATE_MAX_PUBLISH {
            assert!(lim.allow(true));
        }
        assert!(!lim.allow(true));
        // non-publish still ok until global cap
        assert!(lim.allow(false));
    }

    #[test]
    fn split_url_strips_query() {
        let (p, q) = split_url("/v1/events?status=active");
        assert_eq!(p, "/v1/events");
        assert_eq!(q, "status=active");
    }
}
