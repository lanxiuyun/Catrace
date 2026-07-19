use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::event::{
    now_ms, validate_event_shape, BusEvent, DisplayMode, EventPatch, EventResolution, EventStatus,
    ResolutionKind,
};
use crate::reminder_toast;

static CHANNEL_CAPACITY: usize = 256;
static MAX_RESOLVED_IN_REGISTRY: usize = 200;

/// Pure in-memory event store (no AppHandle) — unit-testable.
#[derive(Default)]
pub struct EventRegistry {
    events: HashMap<String, BusEvent>,
}

impl EventRegistry {
    pub fn new() -> Self {
        Self {
            events: HashMap::new(),
        }
    }

    pub fn publish(&mut self, mut event: BusEvent) -> Result<BusEvent, String> {
        validate_event_shape(&event)?;

        let now = now_ms();
        if event.id.trim().is_empty() {
            event.id = Uuid::new_v4().to_string();
        }
        if event.created_at <= 0 {
            event.created_at = now;
        }
        event.updated_at = now;
        event.status = EventStatus::Active;
        event.revision = 1;
        event.resolved_at = None;
        event.resolution = None;

        // Replacing an existing id is allowed (explicit republish).
        self.events.insert(event.id.clone(), event.clone());
        self.prune_resolved();
        Ok(event)
    }

    pub fn update(&mut self, id: &str, patch: EventPatch) -> Result<BusEvent, String> {
        let event = self
            .events
            .get_mut(id)
            .ok_or_else(|| format!("event not found: {id}"))?;
        if event.status != EventStatus::Active {
            return Err(format!("event is not active: {id}"));
        }

        if let Some(title) = patch.title {
            event.title = title;
        }
        if let Some(body) = patch.body {
            event.body = body;
        }
        if let Some(level) = patch.level {
            event.level = level;
        }
        if let Some(display_mode) = patch.display_mode {
            event.display_mode = display_mode;
        }
        if let Some(actions) = patch.actions {
            event.actions = actions;
        }
        if let Some(progress) = patch.progress {
            event.progress = progress;
        }
        if let Some(sticky) = patch.sticky {
            event.sticky = sticky;
        }
        if let Some(payload) = patch.payload {
            event.payload = payload;
        }
        if let Some(expires_at) = patch.expires_at {
            event.expires_at = expires_at;
        }

        validate_event_shape(event)?;
        event.updated_at = now_ms();
        event.revision = event.revision.saturating_add(1);
        Ok(event.clone())
    }

    pub fn resolve(&mut self, id: &str, resolution: EventResolution) -> Result<BusEvent, String> {
        let event = self
            .events
            .get_mut(id)
            .ok_or_else(|| format!("event not found: {id}"))?;
        if event.status != EventStatus::Active {
            return Err(format!("event is not active: {id}"));
        }
        let now = now_ms();
        event.status = EventStatus::Resolved;
        event.resolved_at = Some(now);
        event.resolution = Some(resolution);
        event.updated_at = now;
        event.revision = event.revision.saturating_add(1);
        let out = event.clone();
        self.prune_resolved();
        Ok(out)
    }

    pub fn resolve_action(
        &mut self,
        id: &str,
        action_id: &str,
        payload: Option<serde_json::Value>,
    ) -> Result<BusEvent, String> {
        let exists = self
            .events
            .get(id)
            .ok_or_else(|| format!("event not found: {id}"))?
            .actions
            .iter()
            .any(|a| a.id == action_id);
        if !exists {
            return Err(format!("action not found: {action_id}"));
        }
        self.resolve(
            id,
            EventResolution {
                kind: ResolutionKind::Action,
                action_id: Some(action_id.to_string()),
                payload,
            },
        )
    }

    pub fn active_events(&self) -> Vec<BusEvent> {
        let mut list: Vec<_> = self
            .events
            .values()
            .filter(|e| e.status == EventStatus::Active)
            .cloned()
            .collect();
        list.sort_by_key(|e| e.created_at);
        list
    }

    #[allow(dead_code)]
    pub fn get(&self, id: &str) -> Option<BusEvent> {
        self.events.get(id).cloned()
    }

    fn prune_resolved(&mut self) {
        let mut resolved: Vec<_> = self
            .events
            .values()
            .filter(|e| e.status == EventStatus::Resolved)
            .cloned()
            .collect();
        if resolved.len() <= MAX_RESOLVED_IN_REGISTRY {
            return;
        }
        resolved.sort_by_key(|e| e.resolved_at.unwrap_or(e.updated_at));
        let drop_n = resolved.len() - MAX_RESOLVED_IN_REGISTRY;
        for e in resolved.into_iter().take(drop_n) {
            self.events.remove(&e.id);
        }
    }
}

pub struct EventBus {
    app_handle: AppHandle,
    registry: Arc<RwLock<EventRegistry>>,
    tx: tokio::sync::broadcast::Sender<Arc<BusEvent>>,
}

impl EventBus {
    pub fn new(app_handle: AppHandle) -> Self {
        let (tx, _) = tokio::sync::broadcast::channel(CHANNEL_CAPACITY);
        Self {
            app_handle,
            registry: Arc::new(RwLock::new(EventRegistry::new())),
            tx,
        }
    }

    fn emit_event(&self, event: BusEvent) {
        let event = Arc::new(event);
        let _ = self.app_handle.emit("catrace:event", event.as_ref().clone());
        let _ = self.tx.send(event);
    }

    pub fn publish(&self, event: BusEvent) -> Result<BusEvent, String> {
        let out = {
            let mut reg = self.registry.write().map_err(|e| e.to_string())?;
            reg.publish(event)?
        };
        // Toast 显示由前端订阅 bus；此处只保证窗口在位（不 eval 内容）。
        if matches!(out.display_mode, DisplayMode::Toast) {
            reminder_toast::ensure_toast_window_visible(&self.app_handle);
        }
        self.emit_event(out.clone());
        Ok(out)
    }

    pub fn update(&self, id: String, patch: EventPatch) -> Result<BusEvent, String> {
        let out = {
            let mut reg = self.registry.write().map_err(|e| e.to_string())?;
            reg.update(&id, patch)?
        };
        self.emit_event(out.clone());
        Ok(out)
    }

    pub fn resolve(&self, id: String, resolution: EventResolution) -> Result<BusEvent, String> {
        let out = {
            let mut reg = self.registry.write().map_err(|e| e.to_string())?;
            reg.resolve(&id, resolution)?
        };
        self.emit_event(out.clone());
        Ok(out)
    }

    pub fn resolve_action(
        &self,
        id: String,
        action_id: String,
        payload: Option<serde_json::Value>,
    ) -> Result<BusEvent, String> {
        let out = {
            let mut reg = self.registry.write().map_err(|e| e.to_string())?;
            reg.resolve_action(&id, &action_id, payload)?
        };
        self.emit_event(out.clone());
        Ok(out)
    }

    pub fn active_events(&self) -> Result<Vec<BusEvent>, String> {
        let reg = self.registry.read().map_err(|e| e.to_string())?;
        Ok(reg.active_events())
    }

    #[allow(dead_code)]
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<Arc<BusEvent>> {
        self.tx.subscribe()
    }
}

impl Clone for EventBus {
    fn clone(&self) -> Self {
        Self {
            app_handle: self.app_handle.clone(),
            registry: self.registry.clone(),
            tx: self.tx.clone(),
        }
    }
}

#[tauri::command]
pub fn publish_event(event: BusEvent, bus: State<'_, EventBus>) -> Result<BusEvent, String> {
    bus.publish(event)
}

#[tauri::command]
pub fn update_event(
    id: String,
    patch: EventPatch,
    bus: State<'_, EventBus>,
) -> Result<BusEvent, String> {
    bus.update(id, patch)
}

#[tauri::command]
pub fn resolve_event(
    id: String,
    resolution: EventResolution,
    bus: State<'_, EventBus>,
) -> Result<BusEvent, String> {
    bus.resolve(id, resolution)
}

#[tauri::command]
pub fn resolve_event_action(
    id: String,
    action_id: String,
    payload: Option<serde_json::Value>,
    bus: State<'_, EventBus>,
) -> Result<BusEvent, String> {
    bus.resolve_action(id, action_id, payload)
}

#[tauri::command]
pub fn get_active_events(bus: State<'_, EventBus>) -> Result<Vec<BusEvent>, String> {
    bus.active_events()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{EventAction, EventLevel, EventSource};

    fn sample_event() -> BusEvent {
        BusEvent {
            id: String::new(),
            event_type: "test.ping".into(),
            source: EventSource::Internal,
            kind: "test".into(),
            display_mode: Default::default(),
            level: EventLevel::Info,
            title: "Hello".into(),
            body: "World".into(),
            actions: vec![EventAction {
                id: "ok".into(),
                label: "OK".into(),
                payload: None,
            }],
            progress: None,
            sticky: None,
            payload: serde_json::json!({}),
            created_at: 0,
            updated_at: 0,
            status: EventStatus::Active,
            revision: 0,
            resolved_at: None,
            resolution: None,
            expires_at: None,
            correlation_id: None,
            dedupe_key: None,
        }
    }

    #[test]
    fn publish_assigns_id_and_revision() {
        let mut reg = EventRegistry::new();
        let e = reg.publish(sample_event()).unwrap();
        assert!(!e.id.is_empty());
        assert_eq!(e.revision, 1);
        assert_eq!(e.status, EventStatus::Active);
        assert!(e.created_at > 0);
    }

    #[test]
    fn update_bumps_revision() {
        let mut reg = EventRegistry::new();
        let e = reg.publish(sample_event()).unwrap();
        let updated = reg
            .update(
                &e.id,
                EventPatch {
                    title: Some("New".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.revision, 2);
        assert_eq!(updated.title, "New");
    }

    #[test]
    fn resolve_action_requires_known_action() {
        let mut reg = EventRegistry::new();
        let e = reg.publish(sample_event()).unwrap();
        assert!(reg.resolve_action(&e.id, "missing", None).is_err());
        let resolved = reg.resolve_action(&e.id, "ok", None).unwrap();
        assert_eq!(resolved.status, EventStatus::Resolved);
        assert_eq!(
            resolved.resolution.as_ref().unwrap().kind,
            ResolutionKind::Action
        );
    }

    #[test]
    fn cannot_update_resolved() {
        let mut reg = EventRegistry::new();
        let e = reg.publish(sample_event()).unwrap();
        reg.resolve(
            &e.id,
            EventResolution {
                kind: ResolutionKind::Dismissed,
                action_id: None,
                payload: None,
            },
        )
        .unwrap();
        assert!(reg
            .update(
                &e.id,
                EventPatch {
                    title: Some("x".into()),
                    ..Default::default()
                }
            )
            .is_err());
    }

    #[test]
    fn active_events_excludes_resolved() {
        let mut reg = EventRegistry::new();
        let a = reg.publish(sample_event()).unwrap();
        let b = reg.publish(sample_event()).unwrap();
        reg.resolve(
            &a.id,
            EventResolution {
                kind: ResolutionKind::Completed,
                action_id: None,
                payload: None,
            },
        )
        .unwrap();
        let active = reg.active_events();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, b.id);
    }
}
