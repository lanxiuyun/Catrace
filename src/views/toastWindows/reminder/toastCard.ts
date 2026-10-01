/**
 * Toast 卡片数据模型与纯函数助手。
 * 从 ReminderToast.vue 抽出：kind 体系、ToastItem、payload → toastStyle / auto-hide 解析。
 * 全部无副作用（不碰 DOM / Tauri / store）。
 */
import type { BusEvent, EventAction, EventLevel, EventProgress } from '../../../types/event'

export const BUILTIN_TOAST_KINDS = [
  'rest',
  'update',
  'rest-timer',
  'sdk',
  'special',
  'notification',
] as const
export type BuiltinToastKind = (typeof BUILTIN_TOAST_KINDS)[number]
/** Builtin kinds plus external plugin kinds (string). */
export type ToastKind = BuiltinToastKind | string

export function isBuiltinKind(kind: string): kind is BuiltinToastKind {
  return (BUILTIN_TOAST_KINDS as readonly string[]).includes(kind)
}

export type ToastStyleObject = Record<string, string>
export type ToastStyleValue = 'standalone' | ToastStyleObject

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  body: string
  boundary: number
  visible: boolean
  isHovered: boolean
  remainingMs: number
  closeTimer: ReturnType<typeof setTimeout> | null
  lastStartAt: number
  totalMs: number
  leaving?: boolean
  version?: string
  updateBody?: string
  showUpdateBody?: boolean
  updateInstalling?: boolean
  downloadProgress?: number
  downloadTotal?: number
  downloadReceived?: number
  sticky?: boolean
  breakMinutes?: number
  restStartTs?: number
  restStreak?: number
  isComplete?: boolean
  endTimer?: ReturnType<typeof setTimeout> | null
  // Event Bus correlation
  eventId?: string
  dedupeKey?: string
  toastStyle?: ToastStyleValue
  // sdk generic card
  level?: EventLevel | string
  sdkActions?: EventAction[]
  sdkProgress?: EventProgress | null
  // external plugin card
  busEvent?: BusEvent
  pluginId?: string
  uiUrl?: string
  // special-day fields
  specialTag?: string
  specialIcon?: string
  specialCategory?: 'history' | 'life'
  // system notification (kind=notification)
  appName?: string
  iconUrl?: string
  notificationActions?: EventAction[]
  /** 点卡片本体可触发源通知的主操作（后端 payload.body_clickable） */
  bodyClickable?: boolean
}

/** addNotification 的入参形状（与原 ReminderToast.vue 内联签名一致，含遗留字段）。 */
export interface AddNotificationPayload {
  kind: ToastKind
  boundary?: number
  title?: string
  body?: string
  version?: string
  updateBody?: string
  event?: string
  agentState?: string
  mode?: string
  sessionId?: string
  cwd?: string
  prompt?: string
  summary?: string
  sessionTitle?: string
  requestId?: number
  toolName?: string
  toolInput?: unknown
  eventId?: string
  dedupeKey?: string
  toastStyle?: ToastStyleValue
  level?: EventLevel | string
  sticky?: boolean
  sdkActions?: EventAction[]
  sdkProgress?: EventProgress | null
  busEvent?: BusEvent
  pluginId?: string
  uiUrl?: string
  tag?: string
  icon?: string
  category?: 'history' | 'life'
  autoHideMs?: number
  appName?: string
  iconUrl?: string
  notificationActions?: EventAction[]
  bodyClickable?: boolean
}

export const AUTO_HIDE_MS = 8000
/** Clamp plugin/sdk payload auto-hide (ms). 0 only valid when sticky. */
export const MIN_AUTO_HIDE_MS = 3000
export const MAX_AUTO_HIDE_MS = 10 * 60 * 1000

export function resolveToastStyle(payload: Record<string, unknown>, isPluginEvent: boolean): ToastStyleValue | undefined {
  if (!isPluginEvent) return undefined
  const input = payload.toastStyle as ToastStyleValue | undefined
  if (input === 'standalone') return input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const style: ToastStyleObject = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') style[key] = value
  }
  return Object.keys(style).length ? style : undefined
}

export function toastCardStyle(item: ToastItem): Record<string, string> {
  const style = item.toastStyle && typeof item.toastStyle === 'object' ? item.toastStyle : {}
  return {
    ...style,
    ...(item.totalMs > 0 ? { '--toast-auto-hide-ms': `${item.totalMs}ms` } : {}),
  }
}

export function resolveAutoHideMs(event: BusEvent | undefined | null, sticky: boolean): number {
  if (sticky) return 0
  const p = (event?.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const raw =
    typeof p.auto_hide_ms === 'number'
      ? p.auto_hide_ms
      : typeof p.autoHideMs === 'number'
        ? p.autoHideMs
        : typeof p.card_duration_sec === 'number'
          ? p.card_duration_sec * 1000
          : typeof p.cardDurationSec === 'number'
            ? p.cardDurationSec * 1000
            : AUTO_HIDE_MS
  if (!Number.isFinite(raw)) return AUTO_HIDE_MS
  return Math.min(MAX_AUTO_HIDE_MS, Math.max(MIN_AUTO_HIDE_MS, Math.round(raw)))
}
