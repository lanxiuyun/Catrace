export type EventSource =
  | { type: 'internal' }
  | { type: 'agent_hook' }
  | { type: 'sdk' }
  | { type: 'plugin'; name: string }

export type DisplayMode = 'toast' | 'popup' | 'fullscreen'

export type EventLevel = 'info' | 'warning' | 'error' | 'success'

export type EventStatus = 'active' | 'resolved'

export type ResolutionKind =
  | 'completed'
  | 'dismissed'
  | 'action'
  | 'expired'
  | 'superseded'

export interface EventResolution {
  kind: ResolutionKind
  action_id?: string
  payload?: unknown
}

export interface EventAction {
  id: string
  label: string
  payload?: unknown
}

export interface EventProgress {
  current: number
  total: number
  label?: string
}

export interface BusEvent {
  id: string
  event_type: string
  source: EventSource
  kind: string
  display_mode: DisplayMode
  level: EventLevel
  title: string
  body: string
  actions: EventAction[]
  progress?: EventProgress
  sticky?: boolean
  payload: Record<string, unknown> | unknown
  created_at: number
  updated_at: number
  status: EventStatus
  revision: number
  resolved_at?: number
  resolution?: EventResolution
  expires_at?: number
  correlation_id?: string
  dedupe_key?: string
}

export interface EventPatch {
  title?: string
  body?: string
  level?: EventLevel
  display_mode?: DisplayMode
  actions?: EventAction[]
  progress?: EventProgress | null
  sticky?: boolean | null
  payload?: unknown
  expires_at?: number | null
}
