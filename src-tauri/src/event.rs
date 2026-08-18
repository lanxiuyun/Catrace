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

pub fn validate_event_shape(event: &BusEvent) -> Result<(), String> {
    if event.event_type.trim().is_empty() {
        return Err("event_type is required".into());
    }
    if event.kind.trim().is_empty() {
        return Err("kind is required".into());
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
    fn event_shape_does_not_reject_large_content() {
        let event = BusEvent {
            id: String::new(),
            event_type: "plugin.large".into(),
            source: EventSource::Plugin {
                name: "large-plugin".into(),
            },
            kind: "plugin".into(),
            display_mode: DisplayMode::Toast,
            level: EventLevel::Info,
            title: "t".repeat(1024),
            body: "b".repeat(16 * 1024),
            actions: (0..32)
                .map(|index| EventAction {
                    id: format!("action-{index}"),
                    label: format!("Action {index}"),
                    payload: None,
                })
                .collect(),
            progress: None,
            sticky: None,
            payload: serde_json::json!("p".repeat(128 * 1024)),
            created_at: 0,
            updated_at: 0,
            status: EventStatus::Active,
            revision: 1,
            resolved_at: None,
            resolution: None,
            expires_at: None,
            correlation_id: None,
            dedupe_key: None,
        };
        assert!(validate_event_shape(&event).is_ok());
    }

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
