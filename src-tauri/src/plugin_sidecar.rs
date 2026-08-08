use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::{Emitter, Manager};

use crate::plugin_commands::{publish_plugin_event, PluginPublishInput};
use crate::plugins::{PluginManager, PluginSidecarSpec};
use crate::{log_error, log_info, log_warn};

type RpcResult = Result<serde_json::Value, String>;

struct PendingRequest {
    plugin_id: String,
    sender: mpsc::Sender<RpcResult>,
}

struct RunningSidecar {
    fingerprint: String,
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Clone, Default)]
pub struct PluginSidecarManager {
    running: Arc<Mutex<HashMap<String, RunningSidecar>>>,
    sync_lock: Arc<Mutex<()>>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    next_request_id: Arc<AtomicU64>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum SidecarOutput {
    Ready {
        #[serde(default)]
        v: Option<u32>,
    },
    Publish {
        #[serde(default)]
        v: Option<u32>,
        event: PluginPublishInput,
    },
    Log {
        #[serde(default)]
        v: Option<u32>,
        #[serde(default = "default_log_level")]
        level: String,
        message: String,
        #[serde(default)]
        data: Option<serde_json::Value>,
    },
    Response {
        #[serde(default)]
        v: Option<u32>,
        #[serde(rename = "requestId")]
        request_id: String,
        ok: bool,
        #[serde(default)]
        result: serde_json::Value,
        #[serde(default)]
        error: Option<String>,
    },
    #[serde(rename = "storage.get")]
    StorageGet {
        #[serde(default)]
        v: Option<u32>,
        #[serde(rename = "requestId")]
        request_id: String,
        key: String,
    },
    #[serde(rename = "storage.set")]
    StorageSet {
        #[serde(default)]
        v: Option<u32>,
        #[serde(rename = "requestId")]
        request_id: String,
        key: String,
        value: serde_json::Value,
    },
}

fn default_log_level() -> String {
    "info".into()
}

impl PluginSidecarManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self, plugin_id: &str) -> bool {
        self.running
            .lock()
            .map(|running| running.contains_key(plugin_id))
            .unwrap_or(false)
    }

    pub fn schedule_sync(&self, app: tauri::AppHandle, plugins: PluginManager) {
        self.schedule_sync_impl(app, plugins, false);
    }

    /// Same as `schedule_sync`, but restarts every running sidecar (not just
    /// crashed/fingerprint-changed ones). Used by the explicit reload/refresh.
    pub fn schedule_sync_force(&self, app: tauri::AppHandle, plugins: PluginManager) {
        self.schedule_sync_impl(app, plugins, true);
    }

    fn schedule_sync_impl(&self, app: tauri::AppHandle, plugins: PluginManager, force: bool) {
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = manager.sync_impl(&app, &plugins, force) {
                log_warn!("plugin-sidecar", "sidecar sync failed: {e}");
            }
        });
    }

    pub fn sync(&self, app: &tauri::AppHandle, plugins: &PluginManager) -> Result<(), String> {
        self.sync_impl(app, plugins, false)
    }

    /// Synchronous variant used by enable/disable toggle so the response can
    /// report fresh `sidecar_running`. Restarts every running sidecar.
    pub fn sync_force(&self, app: &tauri::AppHandle, plugins: &PluginManager) -> Result<(), String> {
        self.sync_impl(app, plugins, true)
    }

    fn sync_impl(
        &self,
        app: &tauri::AppHandle,
        plugins: &PluginManager,
        force: bool,
    ) -> Result<(), String> {
        let _sync_guard = self.sync_lock.lock().map_err(|e| e.to_string())?;
        let desired = plugins.sidecar_plugins()?;
        let desired_map: HashMap<_, _> = desired
            .iter()
            .map(|spec| (spec.id.clone(), spec.fingerprint.clone()))
            .collect();
        let mut running = self.running.lock().map_err(|e| e.to_string())?;
        let stopped: Vec<String> = running
            .keys()
            .filter(|id| !desired_map.contains_key(*id))
            .cloned()
            .collect();
        for id in stopped {
            if let Some(sidecar) = running.remove(&id) {
                stop_sidecar(&id, sidecar);
                self.fail_pending_for_plugin(&id, "plugin sidecar stopped");
            }
        }
        for spec in desired {
            let restart = if force {
                true
            } else {
                match running.get_mut(&spec.id) {
                    Some(sidecar) => {
                        sidecar
                            .child
                            .try_wait()
                            .map_err(|e| format!("check plugin sidecar {} status: {e}", spec.id))?
                            .is_some()
                            || sidecar.fingerprint != spec.fingerprint
                    }
                    None => true,
                }
            };
            if !restart {
                continue;
            }
            if let Some(sidecar) = running.remove(&spec.id) {
                stop_sidecar(&spec.id, sidecar);
                self.fail_pending_for_plugin(&spec.id, "plugin sidecar restarted");
            }
            let id = spec.id.clone();
            let spawned = spawn_sidecar(app, plugins, &spec, self.clone())?;
            running.insert(
                id.clone(),
                RunningSidecar {
                    fingerprint: spec.fingerprint.clone(),
                    child: spawned.child,
                    stdin: spawned.stdin,
                },
            );
            log_info!("plugin-sidecar", "started sidecar for {id}");
        }
        Ok(())
    }

    pub fn send_resolved(&self, plugin_id: &str, payload: &serde_json::Value) {
        let stdin = {
            let Ok(running) = self.running.lock() else {
                return;
            };
            let Some(sidecar) = running.get(plugin_id) else {
                return;
            };
            Arc::clone(&sidecar.stdin)
        };
        let plugin_id = plugin_id.to_string();
        let mut message = payload.clone();
        if let Some(object) = message.as_object_mut() {
            object.insert("v".into(), 1.into());
            object.insert("op".into(), "resolved".into());
        }
        let event_id = message
            .get("eventId")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        log_info!(
            "plugin-sidecar",
            "enqueue resolved stdin: plugin={plugin_id} event={event_id}"
        );
        std::thread::spawn(move || {
            let started_at = std::time::Instant::now();
            log_info!(
                "plugin-sidecar",
                "write resolved stdin start: plugin={plugin_id} event={event_id}"
            );
            match write_message(&stdin, &message) {
                Ok(()) => log_info!(
                    "plugin-sidecar",
                    "write resolved stdin done: plugin={plugin_id} event={event_id} elapsed_ms={}",
                    started_at.elapsed().as_millis()
                ),
                Err(e) => log_warn!(
                    "plugin-sidecar",
                    "send resolved to {plugin_id} failed: event={event_id} error={e}"
                ),
            }
        });
    }

    pub fn request(
        &self,
        plugins: &PluginManager,
        plugin_id: &str,
        method: String,
        params: serde_json::Value,
    ) -> RpcResult {
        plugins.ensure_enabled(plugin_id)?;
        if method.trim().is_empty() {
            return Err("sidecar method cannot be empty".into());
        }
        let stdin = {
            let running = self.running.lock().map_err(|e| e.to_string())?;
            let sidecar = running
                .get(plugin_id)
                .ok_or_else(|| format!("plugin sidecar is not running: {plugin_id}"))?;
            Arc::clone(&sidecar.stdin)
        };
        let request_id = format!(
            "{}-{}",
            plugin_id,
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().map_err(|e| e.to_string())?.insert(
            request_id.clone(),
            PendingRequest {
                plugin_id: plugin_id.to_string(),
                sender,
            },
        );
        let message = serde_json::json!({
            "v": 1,
            "op": "request",
            "requestId": request_id,
            "method": method,
            "params": params,
        });
        if let Err(error) = write_message(&stdin, &message) {
            self.pending
                .lock()
                .map_err(|e| e.to_string())?
                .remove(&request_id);
            return Err(format!("send sidecar request: {error}"));
        }
        match receiver.recv_timeout(Duration::from_secs(30)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending
                    .lock()
                    .map_err(|e| e.to_string())?
                    .remove(&request_id);
                Err(format!("sidecar request timed out: {method}"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("sidecar response channel disconnected".into())
            }
        }
    }

    fn fail_pending_for_plugin(&self, plugin_id: &str, error: &str) {
        let requests = {
            let Ok(mut pending) = self.pending.lock() else {
                return;
            };
            let request_ids: Vec<String> = pending
                .iter()
                .filter(|(_, request)| request.plugin_id == plugin_id)
                .map(|(id, _)| id.clone())
                .collect();
            request_ids
                .into_iter()
                .filter_map(|id| pending.remove(&id))
                .collect::<Vec<_>>()
        };
        for request in requests {
            let _ = request.sender.send(Err(error.to_string()));
        }
    }

    pub fn stop_all(&self) {
        let Ok(_sync_guard) = self.sync_lock.lock() else {
            return;
        };
        let Ok(mut running) = self.running.lock() else {
            return;
        };
        for (id, sidecar) in running.drain() {
            stop_sidecar(&id, sidecar);
            self.fail_pending_for_plugin(&id, "plugin sidecar stopped");
        }
    }
}

#[tauri::command]
pub async fn plugin_sidecar_request(
    window: tauri::WebviewWindow,
    plugins: tauri::State<'_, PluginManager>,
    sidecars: tauri::State<'_, PluginSidecarManager>,
    plugin_id: String,
    method: String,
    params: Option<serde_json::Value>,
) -> RpcResult {
    if window.label() != "main" {
        return Err("sidecar request is only available in the main plugin settings window".into());
    }
    let manager = sidecars.inner().clone();
    let plugins = plugins.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.request(
            &plugins,
            &plugin_id,
            method,
            params.unwrap_or(serde_json::Value::Null),
        )
    })
    .await
    .map_err(|e| format!("sidecar request task failed: {e}"))?
}

impl Drop for PluginSidecarManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.running) == 1 {
            self.stop_all();
        }
    }
}

struct SpawnedSidecar {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

fn spawn_sidecar(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
    spec: &PluginSidecarSpec,
    manager: PluginSidecarManager,
) -> Result<SpawnedSidecar, String> {
    let mut command = Command::new(&spec.command);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .envs(&spec.env)
        .env("CATRACE_PLUGIN_ID", &spec.id)
        .env("CATRACE_PROTOCOL_VERSION", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("start plugin sidecar {}: {e}", spec.id))?;
    let stdin =
        Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| {
            format!("open plugin sidecar {} stdin", spec.id)
        })?));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("open plugin sidecar {} stdout", spec.id))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("open plugin sidecar {} stderr", spec.id))?;

    let stdout_app = app.clone();
    let stdout_plugins = plugins.clone();
    let stdout_id = spec.id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    handle_stdout_line(&stdout_app, &stdout_plugins, &manager, &stdout_id, &line)
                }
                Err(e) => {
                    log_warn!("plugin-sidecar", "read stdout for {stdout_id} failed: {e}");
                    break;
                }
            }
        }
    });
    let stderr_id = spec.id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => log_warn!("plugin-sidecar", "[{stderr_id}] {line}"),
                Err(e) => {
                    log_warn!("plugin-sidecar", "read stderr for {stderr_id} failed: {e}");
                    break;
                }
            }
        }
    });

    // Push persisted plugin config so runtime state (e.g. bt-music playerPath)
    // is available immediately after spawn, not only after the settings page
    // pushes it via setConfig.
    if let Ok(Some(config)) =
        crate::plugin_config::get_plugin_config::<serde_json::Value>(app, &spec.id)
    {
        let message = serde_json::json!({ "v": 1, "op": "config", "config": config });
        if let Err(e) = write_message(&stdin, &message) {
            log_warn!("plugin-sidecar", "push config to {} failed: {e}", spec.id);
        }
    }

    Ok(SpawnedSidecar { child, stdin })
}

fn handle_stdout_line(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
    manager: &PluginSidecarManager,
    plugin_id: &str,
    line: &str,
) {
    let message = match serde_json::from_str::<SidecarOutput>(line) {
        Ok(message) => message,
        Err(e) => {
            log_warn!(
                "plugin-sidecar",
                "[{plugin_id}] invalid stdout JSONL: {e}; line={line}"
            );
            return;
        }
    };
    match message {
        SidecarOutput::Ready { v } => {
            log_info!("plugin-sidecar", "[{plugin_id}] ready (protocol={v:?})")
        }
        SidecarOutput::Publish { v, event } => {
            if v != Some(1) {
                log_warn!(
                    "plugin-sidecar",
                    "[{plugin_id}] publish rejected: unsupported protocol {v:?}"
                );
                return;
            }
            let bus = app.state::<crate::bus::EventBus>();
            if let Err(e) = publish_plugin_event(app, plugins, &bus, plugin_id, event) {
                log_warn!("plugin-sidecar", "[{plugin_id}] publish rejected: {e}");
            }
        }
        SidecarOutput::Log {
            v,
            level,
            message,
            data,
        } => {
            let _ = v;
            log_plugin_message(app, plugin_id, &level, &message, data.as_ref());
        }
        SidecarOutput::Response {
            v,
            request_id,
            ok,
            result,
            error,
        } => {
            if v != Some(1) {
                log_warn!(
                    "plugin-sidecar",
                    "[{plugin_id}] response rejected: unsupported protocol {v:?}"
                );
                return;
            }
            let pending = manager
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_id));
            let Some(pending) = pending else {
                log_warn!(
                    "plugin-sidecar",
                    "[{plugin_id}] response has unknown request id: {request_id}"
                );
                return;
            };
            if pending.plugin_id != plugin_id {
                log_warn!(
                    "plugin-sidecar",
                    "[{plugin_id}] response request owner mismatch: {request_id}"
                );
                return;
            }
            let response = if ok {
                Ok(result)
            } else {
                Err(error.unwrap_or_else(|| "sidecar request failed".into()))
            };
            let _ = pending.sender.send(response);
        }
        SidecarOutput::StorageGet {
            v,
            request_id,
            key,
        } => {
            if v != Some(1) {
                log_warn!(
                    "plugin-sidecar",
                    "[{plugin_id}] storage.get rejected: unsupported protocol {v:?}"
                );
                return;
            }
            let response = match crate::plugin_commands::validate_storage_key(&key)
                .and_then(|_| {
                    let db = app.state::<crate::db::Db>();
                    let raw = db
                        .get_plugin_storage(plugin_id, &key)
                        .map_err(|e| e.to_string())?;
                    match raw {
                        None => Ok(None),
                        Some(text) => serde_json::from_str::<serde_json::Value>(&text)
                            .map(Some)
                            .map_err(|e| format!("invalid stored JSON: {e}")),
                    }
                }) {
                Ok(value) => serde_json::json!({
                    "v": 1,
                    "op": "response",
                    "requestId": request_id,
                    "ok": true,
                    "result": value,
                }),
                Err(error) => serde_json::json!({
                    "v": 1,
                    "op": "response",
                    "requestId": request_id,
                    "ok": false,
                    "error": error,
                }),
            };
            reply_sidecar(manager, plugin_id, &response);
        }
        SidecarOutput::StorageSet {
            v,
            request_id,
            key,
            value,
        } => {
            if v != Some(1) {
                log_warn!(
                    "plugin-sidecar",
                    "[{plugin_id}] storage.set rejected: unsupported protocol {v:?}"
                );
                return;
            }
            let response = match crate::plugin_commands::validate_storage_key(&key).and_then(|_| {
                let json = serde_json::to_string(&value).map_err(|e| e.to_string())?;
                let db = app.state::<crate::db::Db>();
                db.set_plugin_storage(plugin_id, &key, &json)
                    .map_err(|e| e.to_string())?;
                crate::plugin_commands::record_storage_activity(app, plugins, plugin_id, json.len());
                Ok(())
            }) {
                Ok(()) => serde_json::json!({
                    "v": 1,
                    "op": "response",
                    "requestId": request_id,
                    "ok": true,
                    "result": true,
                }),
                Err(error) => serde_json::json!({
                    "v": 1,
                    "op": "response",
                    "requestId": request_id,
                    "ok": false,
                    "error": error,
                }),
            };
            reply_sidecar(manager, plugin_id, &response);
        }
    }
}

fn reply_sidecar(manager: &PluginSidecarManager, plugin_id: &str, response: &serde_json::Value) {
    let stdin = manager
        .running
        .lock()
        .ok()
        .and_then(|running| running.get(plugin_id).map(|sidecar| sidecar.stdin.clone()));
    let Some(stdin) = stdin else {
        log_warn!(
            "plugin-sidecar",
            "[{plugin_id}] storage response dropped: sidecar not running"
        );
        return;
    };
    if let Err(error) = write_message(&stdin, response) {
        log_warn!(
            "plugin-sidecar",
            "[{plugin_id}] storage response write failed: {error}"
        );
    }
}

fn log_plugin_message(
    app: &tauri::AppHandle,
    plugin_id: &str,
    level: &str,
    message: &str,
    data: Option<&serde_json::Value>,
) {
    let suffix = data.map(|value| format!(" {value}")).unwrap_or_default();
    match level {
        "error" => log_error!("plugin-sidecar", "[{plugin_id}] {message}{suffix}"),
        "warn" => log_warn!("plugin-sidecar", "[{plugin_id}] {message}{suffix}"),
        _ => log_info!("plugin-sidecar", "[{plugin_id}] {message}{suffix}"),
    }
    // Mirror JS plugin_api_log: forward to main DevTools via catrace:plugin-log
    let _ = app.emit_to(
        "main",
        "catrace:plugin-log",
        serde_json::json!({
            "pluginId": plugin_id,
            "level": level,
            "message": message,
            "data": data,
        }),
    );
}

fn write_message(stdin: &Arc<Mutex<ChildStdin>>, value: &serde_json::Value) -> Result<(), String> {
    let mut stdin = stdin.lock().map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut *stdin, value).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

fn stop_sidecar(id: &str, mut sidecar: RunningSidecar) {
    if sidecar.child.try_wait().ok().flatten().is_none() {
        let _ = write_message(
            &sidecar.stdin,
            &serde_json::json!({ "v": 1, "op": "shutdown" }),
        );
        for _ in 0..10 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if sidecar.child.try_wait().ok().flatten().is_some() {
                break;
            }
        }
    }
    match sidecar.child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(e) = kill_process_tree(&mut sidecar.child) {
                log_warn!("plugin-sidecar", "kill sidecar for {id} failed: {e}");
            }
        }
        Err(e) => log_warn!("plugin-sidecar", "check sidecar for {id} failed: {e}"),
    }
    let _ = sidecar.child.wait();
    log_info!("plugin-sidecar", "stopped sidecar for {id}");
}

#[cfg(windows)]
fn kill_process_tree(child: &mut Child) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let status = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("run taskkill: {e}"))?;
    if !status.success() {
        child.kill().map_err(|e| format!("kill child: {e}"))?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn kill_process_tree(child: &mut Child) -> Result<(), String> {
    child.kill().map_err(|e| format!("kill child: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{default_log_level, SidecarOutput};

    #[test]
    fn parses_publish_and_log_messages() {
        let publish = serde_json::from_str::<SidecarOutput>(
            r#"{"v":1,"op":"publish","event":{"eventType":"demo.tick","kind":"demo","title":"Hi"}}"#,
        );
        assert!(matches!(publish, Ok(SidecarOutput::Publish { .. })));
        let log = serde_json::from_str::<SidecarOutput>(
            r#"{"v":1,"op":"log","message":"started","data":{"pid":1}}"#,
        );
        assert!(matches!(log, Ok(SidecarOutput::Log { .. })));
        assert_eq!(default_log_level(), "info");
    }

    #[test]
    fn parses_storage_get_and_set_messages() {
        let get = serde_json::from_str::<SidecarOutput>(
            r#"{"v":1,"op":"storage.get","requestId":"r1","key":"cfg"}"#,
        )
        .expect("storage.get parses");
        assert!(matches!(
            get,
            SidecarOutput::StorageGet {
                request_id,
                key,
                ..
            } if request_id == "r1" && key == "cfg"
        ));
        let set = serde_json::from_str::<SidecarOutput>(
            r#"{"v":1,"op":"storage.set","requestId":"r2","key":"cfg","value":{"n":1}}"#,
        )
        .expect("storage.set parses");
        match set {
            SidecarOutput::StorageSet {
                request_id,
                key,
                value,
                ..
            } => {
                assert_eq!(request_id, "r2");
                assert_eq!(key, "cfg");
                assert_eq!(value, serde_json::json!({"n": 1}));
            }
            other => panic!("expected storage.set, got {other:?}"),
        }
    }
    #[test]
    fn send_resolved_does_not_hold_running_lock_while_writing() {
        // Regression contract: send_resolved clones the stdin handle under the running map lock,
        // then releases that lock before any potentially blocking pipe write.
        let source = include_str!("plugin_sidecar.rs");
        let body = source
            .split("pub fn send_resolved")
            .nth(1)
            .and_then(|part| part.split("pub fn stop_all").next())
            .expect("send_resolved source");
        assert!(body.contains("Arc::clone(&sidecar.stdin)"));
        assert!(body.contains("std::thread::spawn"));
    }
    #[test]
    fn parses_sidecar_echo_fixture_output() {
        let line = r#"{"v":1,"op":"publish","event":{"eventType":"sidecar-echo.tick","kind":"sidecar-echo","title":"Sidecar #1","body":"native","level":"success","sticky":true,"actions":[{"id":"echo","label":"Echo"}],"payload":{"pid":123},"dedupeKey":"sidecar-echo:tick"}}"#;
        let message = serde_json::from_str::<SidecarOutput>(line).expect("fixture output parses");
        let SidecarOutput::Publish { event, .. } = message else {
            panic!("expected publish");
        };
        assert_eq!(event.event_type, "sidecar-echo.tick");
        assert_eq!(event.kind, "sidecar-echo");
        assert_eq!(event.actions[0].id, "echo");
    }
}
