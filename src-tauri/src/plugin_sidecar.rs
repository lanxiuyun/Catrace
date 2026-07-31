use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::Manager;

use crate::plugin_commands::{publish_plugin_event, PluginPublishInput};
use crate::plugins::{PluginManager, PluginSidecarSpec};
use crate::{log_error, log_info, log_warn};

struct RunningSidecar {
    fingerprint: String,
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Clone, Default)]
pub struct PluginSidecarManager {
    running: Arc<Mutex<HashMap<String, RunningSidecar>>>,
    sync_lock: Arc<Mutex<()>>,
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
}

fn default_log_level() -> String {
    "info".into()
}

impl PluginSidecarManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn schedule_sync(&self, app: tauri::AppHandle, plugins: PluginManager) {
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = manager.sync(&app, &plugins) {
                log_warn!("plugin-sidecar", "sidecar sync failed: {e}");
            }
        });
    }

    pub fn sync(&self, app: &tauri::AppHandle, plugins: &PluginManager) -> Result<(), String> {
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
            }
        }
        for spec in desired {
            let restart = match running.get_mut(&spec.id) {
                Some(sidecar) => {
                    sidecar
                        .child
                        .try_wait()
                        .map_err(|e| format!("check plugin sidecar {} status: {e}", spec.id))?
                        .is_some()
                        || sidecar.fingerprint != spec.fingerprint
                }
                None => true,
            };
            if !restart {
                continue;
            }
            if let Some(sidecar) = running.remove(&spec.id) {
                stop_sidecar(&spec.id, sidecar);
            }
            let id = spec.id.clone();
            let spawned = spawn_sidecar(app, plugins, &spec)?;
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

    pub fn stop_all(&self) {
        let Ok(_sync_guard) = self.sync_lock.lock() else {
            return;
        };
        let Ok(mut running) = self.running.lock() else {
            return;
        };
        for (id, sidecar) in running.drain() {
            stop_sidecar(&id, sidecar);
        }
    }
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
                Ok(line) => handle_stdout_line(&stdout_app, &stdout_plugins, &stdout_id, &line),
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
    Ok(SpawnedSidecar { child, stdin })
}

fn handle_stdout_line(
    app: &tauri::AppHandle,
    plugins: &PluginManager,
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
            log_plugin_message(plugin_id, &level, &message, data.as_ref());
        }
    }
}

fn log_plugin_message(
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
