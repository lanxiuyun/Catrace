use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventSource {
    Internal,
    AgentHook,
    Sdk,
    Plugin { name: String },
}

impl Default for EventSource {
    fn default() -> Self {
        Self::Internal
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DisplayMode {
    Toast,
    Popup,
    Fullscreen,
}

impl Default for DisplayMode {
    fn default() -> Self {
        Self::Toast
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventLevel {
    Info,
    Warning,
    Error,
    Success,
}

impl Default for EventLevel {
    fn default() -> Self {
        Self::Info
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventStatus {
    Active,
    Resolved,
}

impl Default for EventStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionKind {
    Completed,
    Dismissed,
    Action,
    Expired,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventResolution {
    pub kind: ResolutionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventAction {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventProgress {
    pub current: f64,
    pub total: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusEvent {
    /// Empty on publish — bus assigns a UUID.
    #[serde(default)]
    pub id: String,
    pub event_type: String,
    #[serde(default)]
    pub source: EventSource,
    pub kind: String,
    #[serde(default)]
    pub display_mode: DisplayMode,
    #[serde(default)]
    pub level: EventLevel,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub actions: Vec<EventAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<EventProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sticky: Option<bool>,
    #[serde(default)]
    pub payload: serde_json::Value,

    // lifecycle
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub status: EventStatus,
    #[serde(default = "default_revision")]
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<EventResolution>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dedupe_key: Option<String>,
}

fn default_revision() -> u64 {
    1
}

/// Whitelisted fields for update_event.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EventPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<EventLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_mode: Option<DisplayMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<EventAction>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Option<EventProgress>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sticky: Option<Option<bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Option<i64>>,
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const MAX_TITLE_LEN: usize = 512;
const MAX_BODY_LEN: usize = 8_192;
const MAX_ACTIONS: usize = 16;
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

pub fn validate_event_shape(event: &BusEvent) -> Result<(), String> {
    if event.event_type.trim().is_empty() {
        return Err("event_type is required".into());
    }
    if event.kind.trim().is_empty() {
        return Err("kind is required".into());
    }
    if event.title.len() > MAX_TITLE_LEN {
        return Err(format!("title exceeds {} chars", MAX_TITLE_LEN));
    }
    if event.body.len() > MAX_BODY_LEN {
        return Err(format!("body exceeds {} chars", MAX_BODY_LEN));
    }
    if event.actions.len() > MAX_ACTIONS {
        return Err(format!("actions exceeds {}", MAX_ACTIONS));
    }
    let mut seen = std::collections::HashSet::new();
    for a in &event.actions {
        if a.id.trim().is_empty() {
            return Err("action.id is required".into());
        }
        if !seen.insert(a.id.clone()) {
            return Err(format!("duplicate action id: {}", a.id));
        }
    }
    if let Ok(bytes) = serde_json::to_vec(&event.payload) {
        if bytes.len() > MAX_PAYLOAD_BYTES {
            return Err(format!("payload exceeds {} bytes", MAX_PAYLOAD_BYTES));
        }
    }
    if let Some(p) = &event.progress {
        if p.total < 0.0 || p.current < 0.0 {
            return Err("progress values must be non-negative".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_source_serializes_as_tagged_object() {
        let internal = serde_json::to_value(EventSource::Internal).unwrap();
        assert_eq!(internal, serde_json::json!({"type": "internal"}));

        let plugin = serde_json::to_value(EventSource::Plugin {
            name: "github".into(),
        })
        .unwrap();
        assert_eq!(
            plugin,
            serde_json::json!({"type": "plugin", "name": "github"})
        );
    }
}
