//! Desktop behavior signal collection (foreground / keys / mouse displacement).
//!
//! Minute bucket key: floor(unix_secs / 60) * 60  (same convention as records.timestamp).
//! Coordinates and key sequences never leave this module except via controlled DB fields.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use active_win_pos_rs::get_active_window;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::{Deserialize, Serialize};

use crate::db::{self, SignalMinuteRecord};
use crate::ActivityState;

const COLLECTOR_VERSION: i32 = 1;
const MOUSE_GAP_RESET_SECS: f64 = 5.0;
/// device_query::DeviceEvents polls GetAsyncKeyState every 100us on Windows
/// (~10k/s, and also starts a useless mouse poller). Drive key edges ourselves.
const KEY_POLL_INTERVAL: Duration = Duration::from_millis(50);
const UNKNOWN_APP: &str = "unknown";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeySequenceItem {
    /// Milliseconds offset from the minute bucket start.
    pub t_ms: u32,
    pub key: String,
}

#[derive(Debug, Clone)]
struct MinuteBucket {
    /// Bucket start: floor(unix/60)*60
    minute_ts: i64,
    foreground_counts: HashMap<String, u32>,
    foreground_sample_count: u32,
    latest_foreground: Option<String>,
    key_count: u32,
    key_sequence: Vec<KeySequenceItem>,
    key_sequence_enabled: bool,
    mouse_distance_px: f64,
    mouse_sample_count: u32,
    /// 60 slots; None = missed sample
    mouse_seconds: [Option<f64>; 60],
}

impl MinuteBucket {
    fn new(minute_ts: i64, key_sequence_enabled: bool) -> Self {
        Self {
            minute_ts,
            foreground_counts: HashMap::new(),
            foreground_sample_count: 0,
            latest_foreground: None,
            key_count: 0,
            key_sequence: Vec::new(),
            key_sequence_enabled,
            mouse_distance_px: 0.0,
            mouse_sample_count: 0,
            mouse_seconds: [None; 60],
        }
    }

    fn into_record(self) -> SignalMinuteRecord {
        let dominant = dominant_process(
            &self.foreground_counts,
            self.latest_foreground.as_deref(),
        );
        let foreground_counts_json = serde_json::to_string(&self.foreground_counts).ok();
        let key_sequence_json = if self.key_sequence_enabled && !self.key_sequence.is_empty() {
            serde_json::to_string(&self.key_sequence).ok()
        } else {
            None
        };
        let mouse_seconds_json = {
            let arr: Vec<serde_json::Value> = self
                .mouse_seconds
                .iter()
                .map(|s| match s {
                    Some(v) => serde_json::json!(v),
                    None => serde_json::Value::Null,
                })
                .collect();
            serde_json::to_string(&arr).ok()
        };

        // records.timestamp is the settle minute (end of the measured window).
        // Bucket key is the window start → persist as start+60 to join with records.
        SignalMinuteRecord {
            timestamp: self.minute_ts + 60,
            dominant_process_name: dominant,
            foreground_sample_count: self.foreground_sample_count as i64,
            foreground_counts_json,
            key_count: self.key_count as i64,
            key_sequence_json,
            key_sequence_enabled: self.key_sequence_enabled,
            mouse_distance_px: self.mouse_distance_px,
            mouse_sample_count: self.mouse_sample_count as i64,
            mouse_seconds_json,
            collector_version: COLLECTOR_VERSION,
        }
    }
}

fn dominant_process(counts: &HashMap<String, u32>, latest: Option<&str>) -> String {
    let mut pairs: Vec<(String, u32)> = counts
        .iter()
        .filter(|(n, _)| n.as_str() != UNKNOWN_APP)
        .map(|(n, c)| (n.clone(), *c))
        .collect();
    if pairs.is_empty() {
        return latest.unwrap_or(UNKNOWN_APP).to_string();
    }
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let top_c = pairs[0].1;
    if let Some(l) = latest {
        if counts.get(l).copied() == Some(top_c) {
            return l.to_string();
        }
    }
    pairs[0].0.clone()
}

fn minute_bucket_ts(unix_secs: i64) -> i64 {
    unix_secs / 60 * 60
}

fn now_unix() -> i64 {
    chrono::Local::now().timestamp()
}

fn normalize_process_name(path: &std::path::Path, app_name: &str) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .filter(|s| s != UNKNOWN_APP)
        .or_else(|| {
            let t = app_name.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        })
        .unwrap_or_else(|| UNKNOWN_APP.to_string())
}

fn keycode_name(key: &Keycode) -> String {
    format!("{:?}", key)
}

pub struct SignalCore {
    current: Mutex<MinuteBucket>,
    /// Completed buckets waiting for settle drain.
    pending: Mutex<Vec<MinuteBucket>>,
    key_sequence_enabled: AtomicBool,
    /// retention hours stored as atomic for purge command convenience
    retention_hours: AtomicU64,
    foreground_started: AtomicBool,
}

impl SignalCore {
    pub fn new() -> Self {
        let ts = minute_bucket_ts(now_unix());
        Self {
            current: Mutex::new(MinuteBucket::new(ts, false)),
            pending: Mutex::new(Vec::new()),
            key_sequence_enabled: AtomicBool::new(false),
            retention_hours: AtomicU64::new(24),
            foreground_started: AtomicBool::new(false),
        }
    }

    pub fn set_key_sequence_enabled(&self, enabled: bool) {
        self.key_sequence_enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            if let Ok(mut cur) = self.current.lock() {
                cur.key_sequence.clear();
                cur.key_sequence_enabled = false;
            }
        }
    }

    pub fn key_sequence_enabled(&self) -> bool {
        self.key_sequence_enabled.load(Ordering::SeqCst)
    }

    pub fn set_retention_hours(&self, hours: u64) {
        self.retention_hours
            .store(hours.max(1), Ordering::SeqCst);
    }

    pub fn retention_hours(&self) -> u64 {
        self.retention_hours.load(Ordering::SeqCst)
    }

    fn rotate_if_needed(&self, now_secs: i64) {
        let ts = minute_bucket_ts(now_secs);
        let seq = self.key_sequence_enabled();
        let mut cur = self.current.lock().unwrap();
        if cur.minute_ts == ts {
            if seq && !cur.key_sequence_enabled {
                cur.key_sequence_enabled = true;
            }
            return;
        }
        // Move old bucket to pending if it has any data or we crossed a minute
        let old = std::mem::replace(&mut *cur, MinuteBucket::new(ts, seq));
        drop(cur);
        if old.foreground_sample_count > 0
            || old.key_count > 0
            || old.mouse_sample_count > 0
            || old.minute_ts > 0
        {
            self.pending.lock().unwrap().push(old);
        }
    }

    fn with_current<R>(&self, now_secs: i64, f: impl FnOnce(&mut MinuteBucket) -> R) -> R {
        self.rotate_if_needed(now_secs);
        let mut cur = self.current.lock().unwrap();
        f(&mut cur)
    }

    pub fn record_foreground(&self, name: String) {
        let now = now_unix();
        self.with_current(now, |b| {
            *b.foreground_counts.entry(name.clone()).or_insert(0) += 1;
            b.foreground_sample_count += 1;
            b.latest_foreground = Some(name);
        });
    }

    pub fn record_key(&self, key: &Keycode) {
        let now = now_unix();
        let seq_on = self.key_sequence_enabled();
        self.with_current(now, |b| {
            b.key_count += 1;
            if seq_on {
                b.key_sequence_enabled = true;
                let offset_ms = ((now - b.minute_ts).max(0) as u32).saturating_mul(1000);
                // Cap sequence length per minute to avoid memory blow-up
                if b.key_sequence.len() < 10_000 {
                    b.key_sequence.push(KeySequenceItem {
                        t_ms: offset_ms,
                        key: keycode_name(key),
                    });
                }
            }
        });
    }

    pub fn record_mouse_distance(&self, distance: f64, second_in_minute: usize) {
        let now = now_unix();
        self.with_current(now, |b| {
            let d = if distance.is_finite() && distance >= 0.0 {
                distance
            } else {
                0.0
            };
            b.mouse_distance_px += d;
            b.mouse_sample_count += 1;
            if second_in_minute < 60 {
                b.mouse_seconds[second_in_minute] = Some(d);
            }
        });
    }

    /// Drain completed minute buckets (not the in-progress minute).
    pub fn drain_completed(&self, before_ts: i64) -> Vec<SignalMinuteRecord> {
        // Rotate so anything older than current minute is pending
        self.rotate_if_needed(now_unix());
        let mut pending = self.pending.lock().unwrap();
        let mut kept = Vec::new();
        let mut out = Vec::new();
        for b in pending.drain(..) {
            if b.minute_ts < before_ts {
                out.push(b.into_record());
            } else {
                kept.push(b);
            }
        }
        *pending = kept;
        out.sort_by_key(|r| r.timestamp);
        out
    }

    /// Snapshot stats for debug (no key sequence contents).
    pub fn debug_snapshot(&self) -> serde_json::Value {
        let cur = self.current.lock().unwrap();
        serde_json::json!({
            "minute_ts": cur.minute_ts,
            "foreground_sample_count": cur.foreground_sample_count,
            "key_count": cur.key_count,
            "key_sequence_len": cur.key_sequence.len(),
            "key_sequence_enabled": self.key_sequence_enabled(),
            "mouse_distance_px": cur.mouse_distance_px,
            "mouse_sample_count": cur.mouse_sample_count,
            "retention_hours": self.retention_hours(),
            "pending_buckets": self.pending.lock().unwrap().len(),
        })
    }
}

pub fn start_foreground_sampling(signal: Arc<SignalCore>) {
    if signal.foreground_started.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let name = match get_active_window() {
            Ok(win) => normalize_process_name(Path::new(&win.process_path), &win.app_name),
            Err(_) => UNKNOWN_APP.to_string(),
        };
        signal.record_foreground(name);
    });
}

/// Keyboard + mouse sampling. Preserves legacy ActivityState.count semantics:
/// - keys: 2s debounce
/// - mouse: at most one count per 2s window if any movement
pub fn start_input_sampling(
    activity: Arc<Mutex<ActivityState>>,
    signal: Arc<SignalCore>,
    started: Arc<AtomicBool>,
) {
    if started.swap(true, Ordering::SeqCst) {
        return;
    }

    // Keyboard: edge-detect via get_keys at KEY_POLL_INTERVAL.
    // Do NOT use DeviceEvents: its Windows backend busy-polls at 100us.
    {
        let activity = activity.clone();
        let signal = signal.clone();
        thread::spawn(move || {
            let device_state = DeviceState::new();
            let mut prev_keys: Vec<Keycode> = Vec::new();
            loop {
                thread::sleep(KEY_POLL_INTERVAL);
                let keys = device_state.get_keys();
                for key in &keys {
                    if !prev_keys.contains(key) {
                        signal.record_key(key);
                        let mut s = activity.lock().unwrap();
                        if s.key_debounce
                            .is_none_or(|t| t.elapsed() > Duration::from_secs(2))
                        {
                            s.count += 1;
                            s.key_debounce = Some(Instant::now());
                        }
                    }
                }
                prev_keys = keys;
            }
        });
    }

    // Mouse 1Hz displacement + legacy 2s movement gate
    {
        let activity = activity.clone();
        let signal = signal.clone();
        thread::spawn(move || {
            let device_state = DeviceState::new();
            let mut prev: Option<(i32, i32)> = None;
            let mut last_sample_at = Instant::now();
            let mut legacy_window_start = Instant::now();
            let mut moved_in_legacy_window = false;

            loop {
                thread::sleep(Duration::from_secs(1));
                let mouse = device_state.get_mouse();
                let (x, y) = mouse.coords;
                let now_instant = Instant::now();
                let gap = now_instant.duration_since(last_sample_at).as_secs_f64();
                last_sample_at = now_instant;

                let distance = if gap > MOUSE_GAP_RESET_SECS {
                    prev = Some((x, y));
                    0.0
                } else if let Some((px, py)) = prev {
                    let dx = (x - px) as f64;
                    let dy = (y - py) as f64;
                    let d = (dx * dx + dy * dy).sqrt();
                    prev = Some((x, y));
                    if d > 0.0 {
                        moved_in_legacy_window = true;
                    }
                    d
                } else {
                    prev = Some((x, y));
                    0.0
                };

                let second = (now_unix() % 60) as usize;
                signal.record_mouse_distance(distance, second);

                // Legacy 2s gate
                if legacy_window_start.elapsed() >= Duration::from_secs(2) {
                    if moved_in_legacy_window {
                        let mut s = activity.lock().unwrap();
                        s.count += 1;
                        s.last_cursor = (x, y);
                    } else {
                        let mut s = activity.lock().unwrap();
                        s.last_cursor = (x, y);
                    }
                    moved_in_legacy_window = false;
                    legacy_window_start = Instant::now();
                }
            }
        });
    }

    eprintln!("[accessibility] input sampling started");
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn set_signal_key_sequence_enabled(
    enabled: bool,
    signal: tauri::State<'_, Arc<SignalCore>>,
) -> Result<(), String> {
    signal.set_key_sequence_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub fn set_signal_key_sequence_retention_hours(
    hours: u64,
    signal: tauri::State<'_, Arc<SignalCore>>,
) -> Result<(), String> {
    signal.set_retention_hours(hours);
    Ok(())
}

#[tauri::command]
pub fn get_signal_runtime_config(
    signal: tauri::State<'_, Arc<SignalCore>>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "key_sequence_enabled": signal.key_sequence_enabled(),
        "retention_hours": signal.retention_hours(),
        "snapshot": signal.debug_snapshot(),
    }))
}

#[tauri::command]
pub fn purge_key_sequences(db: tauri::State<'_, db::Db>) -> Result<u64, String> {
    db.purge_all_key_sequences().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_signal_minutes(
    limit: Option<i64>,
    db: tauri::State<'_, db::Db>,
) -> Result<Vec<SignalMinuteRecord>, String> {
    db.get_recent_signal_minutes(limit.unwrap_or(30))
        .map_err(|e| e.to_string())
}

/// Persist drained signal minutes. Returns dominant process for `settle_timestamp` if present.
pub fn persist_drained(
    db: &db::Db,
    signal: &SignalCore,
    settle_timestamp: i64,
) -> Option<String> {
    // settle_timestamp is the records row ts (= current minute floor at settle).
    // Completed buckets have minute_ts < settle_timestamp (window start).
    let records = signal.drain_completed(settle_timestamp);
    let mut dominant_for_settle = None;
    for rec in records {
        if rec.timestamp == settle_timestamp {
            dominant_for_settle = Some(rec.dominant_process_name.clone());
        }
        if let Err(e) = db.upsert_signal_minute(&rec) {
            crate::log_error!("signal", "upsert_signal_minute failed: {}", e);
        }
    }
    let hours = signal.retention_hours();
    if let Err(e) = db.purge_key_sequences_older_than(hours) {
        crate::log_error!("signal", "purge_key_sequences failed: {}", e);
    }
    dominant_for_settle
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minute_bucket_floor() {
        assert_eq!(minute_bucket_ts(100), 60);
        assert_eq!(minute_bucket_ts(120), 120);
        assert_eq!(minute_bucket_ts(0), 0);
    }

    #[test]
    fn dominant_ignores_unknown_when_known_exists() {
        let mut m = HashMap::new();
        m.insert("unknown".into(), 50);
        m.insert("Code.exe".into(), 10);
        assert_eq!(dominant_process(&m, Some("Code.exe")), "Code.exe");
    }

    #[test]
    fn dominant_prefers_latest_on_tie() {
        let mut m = HashMap::new();
        m.insert("a.exe".into(), 5);
        m.insert("b.exe".into(), 5);
        assert_eq!(dominant_process(&m, Some("b.exe")), "b.exe");
    }

    #[test]
    fn rotate_and_drain() {
        let core = SignalCore::new();
        // Force a bucket at t=0
        {
            let mut cur = core.current.lock().unwrap();
            *cur = MinuteBucket::new(0, false);
            cur.key_count = 3;
        }
        // Simulate time jump by directly rotating via with_current on later ts
        // record into a later minute by manipulating now is hard; call rotate via drain path:
        {
            let mut cur = core.current.lock().unwrap();
            let old = std::mem::replace(&mut *cur, MinuteBucket::new(60, false));
            core.pending.lock().unwrap().push(old);
        }
        let drained = core.drain_completed(60);
        assert_eq!(drained.len(), 1);
        // persisted ts = bucket start + 60
        assert_eq!(drained[0].timestamp, 60);
        assert_eq!(drained[0].key_count, 3);
    }
}
