<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import { listen } from '@tauri-apps/api/event'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  getReminderData,
  getToastDebugMode,
  snoozeReminder,
  skipReminder,
  closeReminderWindow,
  recordWater,
  snoozeWaterReminder,
  skipWaterReminder,
  snoozeEyeReminder,
  skipEyeReminder,
  getActivitySnapshot,
  dismissRestTimer,
  getAgentSoundDataUrl,
  getAgentSoundSettings,
  logFrontend,
  resolvePermission,
  resolveEvent,
  resolveEventAction,
  getActiveEvents,
} from '../api/tauri'
import type { BusEvent } from '../types/event'
import EyeToastCard from '../components/EyeToastCard.vue'
import AgentToastCard, { type AgentEntry } from '../components/AgentToastCard.vue'
import PermissionToastCard, { type PermissionItem } from '../components/PermissionToastCard.vue'
import RestToastCard from '../components/RestToastCard.vue'
import WaterToastCard from '../components/WaterToastCard.vue'
import UpdateToastCard from '../components/UpdateToastCard.vue'
import RestTimerToastCard from '../components/RestTimerToastCard.vue'
import SdkToastCard from '../components/SdkToastCard.vue'
import PluginHostCard from '../components/PluginHostCard.vue'
import type { EventAction, EventLevel, EventProgress } from '../types/event'
import { usePluginRegistry } from '../stores/pluginRegistry'
import { loadExternalPlugins } from '../plugins/loadExternalPlugins'

const { t } = useI18n()
const pluginRegistry = usePluginRegistry()

const BUILTIN_TOAST_KINDS = [
  'rest',
  'water',
  'eye',
  'update',
  'rest-timer',
  'agent',
  'permission',
  'sdk',
] as const
type BuiltinToastKind = (typeof BUILTIN_TOAST_KINDS)[number]
/** Builtin kinds plus external plugin kinds (string). */
type ToastKind = BuiltinToastKind | string

function isBuiltinKind(kind: string): kind is BuiltinToastKind {
  return (BUILTIN_TOAST_KINDS as readonly string[]).includes(kind)
}

function isPluginKind(kind: string): boolean {
  if (isBuiltinKind(kind)) return false
  return !!pluginRegistry.getPluginForKind(kind)
}

interface ToastItem {
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
  // agent fields
  event?: string
  agentState?: string
  sticky?: boolean
  agentEntries?: AgentEntry[]
  // permission (P6) fields
  permission?: PermissionItem
  // rest timer fields
  breakMinutes?: number
  restStartTs?: number
  restStreak?: number
  isComplete?: boolean
  endTimer?: ReturnType<typeof setTimeout> | null
  // Event Bus correlation
  eventId?: string
  dedupeKey?: string
  // sdk generic card
  level?: EventLevel | string
  sdkActions?: EventAction[]
  sdkProgress?: EventProgress | null
  // external plugin card
  busEvent?: BusEvent
  pluginId?: string
  uiUrl?: string
}

const notifications = ref<ToastItem[]>([])
const cardRefs = ref<Map<number, HTMLElement>>(new Map())
const showDebug = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const stackRef = ref<HTMLElement | null>(null)
const isAnimating = ref(false)
let idCounter = 0
let resizeObserver: ResizeObserver | null = null
let unlistenDebug: (() => void) | null = null
let unlistenAgentSound: (() => void) | null = null
let unlistenBusEvent: (() => void) | null = null
let unlistenDismissAgent: (() => void) | null = null
/** Bus event ids already shown (or resolved) — prevent double-render with eval legacy path. */
const seenBusEventIds = new Set<string>()

// Agent 通知提示音：首次加载时缓存 data URL 与音量
let agentSoundDataUrl: string | null | undefined = undefined
let agentSoundVolume = 1.0

async function loadAgentSound() {
  // 重置缓存并重新读取，用于设置变更后刷新
  agentSoundDataUrl = undefined
  try {
    const settings = await getAgentSoundSettings()
    agentSoundVolume = settings.volume
    if (settings.mode === 'muted') {
      agentSoundDataUrl = null
    } else {
      agentSoundDataUrl = await getAgentSoundDataUrl()
    }
  } catch {
    agentSoundDataUrl = null
  }
}

function playAgentSound() {
  if (!agentSoundDataUrl) return
  try {
    const audio = new Audio(agentSoundDataUrl)
    audio.volume = agentSoundVolume
    audio.play().catch(() => {})
  } catch {
    // ignore
  }
}

// 休息计时卡片：每 2 秒轮询活跃，活跃即隐藏
let restPollTimer: ReturnType<typeof setInterval> | null = null
let restPollBaseline = 0
const REST_POLL_MS = 2000
// 文档声明恢复活跃后延迟 4 秒移除
const REST_TIMER_REMOVE_DELAY_MS = 4000

const AUTO_HIDE_MS = 8000
const EYE_AUTO_HIDE_MS = 25000
const MAX_NOTIFICATIONS = 5
const CARD_HEIGHT = 128
const CARD_GAP = 8
const PADDING = 16
const WINDOW_WIDTH = 360

// 临时调试信息
const debugInfo = ref({
  count: 0,
  calcHeight: 0,
  beforeSize: { width: 0, height: 0 },
  beforePos: { x: 0, y: 0 },
  sf: 1,
  afterSize: { width: 0, height: 0 },
  afterPos: { x: 0, y: 0 },
  error: '',
})

onMounted(async () => {
  loadAgentSound()
  // Card map must be ready before bus events (incl. plugin test from main window).
  try {
    await loadExternalPlugins()
  } catch (e) {
    console.warn('[toast] loadExternalPlugins failed', e)
  }

  // 读取初始调试模式状态
  try {
    showDebug.value = await getToastDebugMode()
  } catch {
    // ignore
  }

  // 监听 Tauri 事件，实时同步调试模式状态
  unlistenDebug = await listen<boolean>('catrace-toast-debug-changed', (event) => {
    showDebug.value = event.payload
  })

  // 监听提示音设置变更，重新加载 data URL
  unlistenAgentSound = await listen('catrace-agent-sound-changed', () => {
    loadAgentSound()
  })

  // Event Bus → Toast 统一渲染线（rest/water/eye 等 display_mode=toast 的 active 事件）
  unlistenBusEvent = await listen<BusEvent>('catrace:event', (ev) => {
    handleBusEvent(ev.payload)
  })
  // 晚到的 Toast 窗：拉一次 active events 补水合
  try {
    const active = await getActiveEvents()
    for (const e of active) handleBusEvent(e)
  } catch {
    // ignore
  }

  // Agent 会话销项：Rust emit，不再 eval window.dismissAgentSession
  unlistenDismissAgent = await listen<string>('catrace:dismiss-agent-session', (ev) => {
    dismissAgentSession(ev.payload)
  })

  // 监听内容高度变化，自动调整窗口尺寸
  await nextTick()
  if (stackRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!isAnimating.value) {
        adjustWindowSize()
      }
    })
    resizeObserver.observe(stackRef.value)
  }

  // 读取初始通知
  try {
    const data = await getReminderData('reminder-toast')
    if (data) {
      addNotification({
        kind: (data.kind as ToastKind) || 'rest',
        boundary: data.boundary,
        title: data.title,
        body: data.body,
      })
    }
  } catch {
    // ignore
  }
})

onUnmounted(() => {
  unlistenDebug?.()
  unlistenDebug = null
  unlistenAgentSound?.()
  unlistenAgentSound = null
  unlistenBusEvent?.()
  unlistenBusEvent = null
  unlistenDismissAgent?.()
  unlistenDismissAgent = null
  stopRestPoll()
  notifications.value.forEach(stopTimer)
  resizeObserver?.disconnect()
  resizeObserver = null
})

function setCardRef(el: unknown, id: number) {
  if (el instanceof HTMLElement) {
    cardRefs.value.set(id, el)
  }
}

function calcWindowHeight(count: number): number {
  if (count <= 0) return 0
  return PADDING * 2 + count * CARD_HEIGHT + (count - 1) * CARD_GAP
}

let adjustInFlight: Promise<void> | null = null
let adjustQueued = false

async function adjustWindowSize() {
  if (adjustInFlight) {
    adjustQueued = true
    return adjustInFlight
  }
  adjustInFlight = runAdjustWindowSize().finally(() => {
    adjustInFlight = null
    if (adjustQueued) {
      adjustQueued = false
      void adjustWindowSize()
    }
  })
  return adjustInFlight
}

async function runAdjustWindowSize() {
  if (isAnimating.value) {
    // 动画中不要丢请求，结束后再量一次
    adjustQueued = true
    return
  }

  const count = notifications.value.length
  if (count === 0) return

  // 等 DOM 渲染完成
  await nextTick()

  try {
    const win = getCurrentWebviewWindow()
    const monitor = await currentMonitor()
    const sf = monitor?.scaleFactor ?? 1
    const workArea = monitor?.workArea

    const workAreaX = workArea ? workArea.position.x / sf : 0
    const workAreaY = workArea ? workArea.position.y / sf : 0
    const workAreaWidth = workArea ? workArea.size.width / sf : (window.screen.availWidth || window.innerWidth)
    const workAreaHeight = workArea ? workArea.size.height / sf : (window.screen.availHeight || window.innerHeight)

    // 量内容栈总高度（含被 max-height 隐藏的溢出部分），再加 root 内边距得到窗口总高。
    // scrollHeight 包含 stack 自身为阴影留出的 1rem*2 padding，需减去。
    // 优先按每张卡 scrollHeight 累加：stack 被窗口卡住时，单靠 stack.scrollHeight
    // 偶发偏小（尤其 agent 聚合卡刚展开），导致底部按钮被裁。
    let contentHeight = 0
    let measuredCards = 0
    for (const n of notifications.value) {
      const el = cardRefs.value.get(n.id)
      if (el) {
        contentHeight += el.scrollHeight
        measuredCards += 1
      }
    }
    if (measuredCards > 0) {
      contentHeight += Math.max(0, measuredCards - 1) * CARD_GAP
    } else {
      const rawStackHeight = stackRef.value?.scrollHeight
      contentHeight = rawStackHeight != null ? rawStackHeight - 32 : calcWindowHeight(count)
    }
    // 窗口高度不超过工作区高度，避免超出屏幕
    const newHeightLogical = Math.min(workAreaHeight, contentHeight + PADDING * 2)
    // 贴右下角：x = 工作区右边缘 - 窗口宽度，y = 工作区下边缘 - 窗口高度
    const newXLogical = workAreaX + workAreaWidth - WINDOW_WIDTH
    const newYLogical = workAreaY + workAreaHeight - newHeightLogical

    debugInfo.value = {
      ...debugInfo.value,
      count,
      calcHeight: newHeightLogical,
      beforeSize: { width: 0, height: 0 },
      beforePos: { x: 0, y: 0 },
      sf,
      error: '',
    }

    await win.setSize(new LogicalSize(WINDOW_WIDTH, newHeightLogical))
    await win.setPosition(new LogicalPosition(newXLogical, newYLogical))

    const afterSize = await win.innerSize()
    const afterPos = await win.innerPosition()
    debugInfo.value = {
      ...debugInfo.value,
      afterSize: { width: afterSize.width, height: afterSize.height },
      afterPos: { x: afterPos.x, y: afterPos.y },
    }
    logFrontend('info', `[toast-fe] adjustWindowSize count=${count} contentH=${contentHeight.toFixed(0)} calcH=${newHeightLogical.toFixed(0)} pos=(${newXLogical.toFixed(0)},${newYLogical.toFixed(0)}) afterSize=${afterSize.width}x${afterSize.height} afterPos=(${afterPos.x},${afterPos.y}) sf=${sf}`).catch(() => {})
  } catch (e: any) {
    debugInfo.value.error = String(e?.message ?? e)
    logFrontend('error', `[toast-fe] adjustWindowSize 异常: ${String(e?.message ?? e)}`).catch(() => {})
  }
}

function updateRestTimer(payload: {
  break_minutes: number
  rest_start_ts: number
  rest_streak: number
  remaining_minutes: number
  is_complete: boolean
  title?: string
  body?: string
  eventId?: string
  dedupeKey?: string
}) {
  // 取消已有的延迟关闭定时器（如果用户在延迟期间恢复休息）
  const existing = notifications.value.find((n) => n.kind === 'rest-timer')
  if (existing?.endTimer) {
    clearTimeout(existing.endTimer)
    existing.endTimer = null
  }

  const title =
    payload.title ||
    (payload.is_complete ? t('reminder.restTimerDone') : t('reminder.restTimerTitle'))
  const body =
    payload.body ||
    (payload.is_complete
      ? t('reminder.restTimerDoneBody', { n: payload.rest_streak })
      : t('reminder.restTimerBody', {
          n: payload.rest_streak,
          m: payload.remaining_minutes,
        }))

  if (existing) {
    if (existing.eventId && payload.eventId && existing.eventId !== payload.eventId) {
      seenBusEventIds.add(existing.eventId)
    }
    existing.eventId = payload.eventId ?? existing.eventId
    existing.dedupeKey = payload.dedupeKey ?? existing.dedupeKey
    existing.title = title
    existing.body = body
    existing.restStreak = payload.rest_streak
    existing.breakMinutes = payload.break_minutes
    existing.restStartTs = payload.rest_start_ts
    existing.isComplete = payload.is_complete
    existing.visible = true
  } else {
    const id = ++idCounter
    const item: ToastItem = {
      id,
      kind: 'rest-timer',
      title,
      body,
      boundary: 0,
      visible: false,
      isHovered: false,
      remainingMs: 0,
      closeTimer: null,
      lastStartAt: 0,
      breakMinutes: payload.break_minutes,
      restStartTs: payload.rest_start_ts,
      restStreak: payload.rest_streak,
      isComplete: payload.is_complete,
      totalMs: 0,
      eventId: payload.eventId,
      dedupeKey: payload.dedupeKey ?? 'reminder.rest.timer',
    }
    notifications.value.push(item)
    requestAnimationFrame(() => {
      const found = notifications.value.find((n) => n.id === id)
      if (found) {
        found.visible = true
      }
    })
  }

  // 用户仍在休息：重启每 2 秒活跃轮询，并刷新基线
  startRestPoll()

  adjustWindowSize()
}

/** 启动休息计时卡片的活跃轮询：先取一次快照作基线，之后每 2 秒比对 */
async function startRestPoll() {
  stopRestPoll()
  try {
    const snap = await getActivitySnapshot()
    // 使用当前 count 与媒体/全屏状态建立基线。
    // 注意：count 会在后端每分钟结算时被清零，因此 polling 只把「清零后 count
    // 重新增长」或「媒体变为活跃」或「全屏结束」视为恢复活跃。
    restPollBaseline = snap.count
  } catch {
    restPollBaseline = 0
  }
  restPollTimer = setInterval(pollActivity, REST_POLL_MS)
}

function stopRestPoll() {
  if (restPollTimer) {
    clearInterval(restPollTimer)
    restPollTimer = null
  }
}

async function pollActivity() {
  // 卡片已不在则停轮询
  if (!notifications.value.some((n) => n.kind === 'rest-timer')) {
    stopRestPoll()
    return
  }
  let snap
  try {
    snap = await getActivitySnapshot()
  } catch {
    return
  }

  // 全屏提醒期间：后端把该分钟视为休息，前端也不应把键鼠/媒体活动判断为恢复活跃
  if (snap.fullscreen_active) {
    restPollBaseline = snap.count
    return
  }

  // count 跨分钟会被后端清零；count 减少时只更新基线，不判活跃
  const keyMouseActive = snap.count > restPollBaseline
  restPollBaseline = snap.count
  if (keyMouseActive || snap.media_active) {
    stopRestPoll()
    scheduleRemoveRestTimer()
  }
}

function scheduleRemoveRestTimer() {
  const existing = notifications.value.find((n) => n.kind === 'rest-timer')
  if (!existing) return

  if (existing.endTimer) {
    clearTimeout(existing.endTimer)
  }

  existing.endTimer = setTimeout(() => {
    const item = notifications.value.find((n) => n.kind === 'rest-timer')
    if (!item) return
    // 恢复活跃：清后端 break_timer_active + bus，避免 active 事件水合后重新冒出
    void dismissRestTimer().catch(() => {})
    markEventResolved(item.eventId)
    removeNotification(item.id, true)
  }, REST_TIMER_REMOVE_DELAY_MS)
}

function handleBusEvent(event: BusEvent) {
  if (!event?.id) return
  if (event.display_mode && event.display_mode !== 'toast') return

  if (event.status === 'resolved') {
    seenBusEventIds.add(event.id)
    const existing = notifications.value.find((n) => n.eventId === event.id)
    if (existing) {
      removeNotification(existing.id, true)
    }
    return
  }

  if (event.status && event.status !== 'active') return

  const kind = event.kind as ToastKind
  const sourceIsPlugin =
    !!event.source &&
    typeof event.source === 'object' &&
    (event.source as { type?: string }).type === 'plugin'
  const pluginHit =
    isPluginKind(kind) || isPluginKind(event.event_type) || sourceIsPlugin
  if (!isBuiltinKind(kind) && !pluginHit) {
    return
  }

  const p = (event.payload ?? {}) as Record<string, unknown>
  const boundary = typeof p.boundary === 'number' ? p.boundary : 0
  const dedupeKey = event.dedupe_key || undefined
  const pluginHandle =
    pluginRegistry.getPluginForKind(kind) || pluginRegistry.getPluginForKind(event.event_type)
  const isPluginEvent = !!pluginHandle?.external || sourceIsPlugin
  const pluginId =
    pluginHandle?.manifest.name ||
    (sourceIsPlugin && typeof (event.source as { name?: string }).name === 'string'
      ? (event.source as { name: string }).name
      : undefined)

  // sdk / plugin / rest-timer: same event id may be updated (revision++); refresh in place.
  if (kind === 'sdk' || isPluginEvent) {
    const existing = notifications.value.find((n) => n.eventId === event.id && !n.leaving)
      || (dedupeKey
        ? notifications.value.find((n) => n.dedupeKey === dedupeKey && !n.leaving)
        : undefined)
    if (existing) {
      existing.eventId = event.id
      existing.kind = kind
      existing.title = event.title || ''
      existing.body = event.body || ''
      existing.level = event.level
      existing.sdkActions = event.actions || []
      existing.sdkProgress = event.progress ?? null
      existing.sticky = !!event.sticky
      existing.dedupeKey = dedupeKey
      existing.busEvent = event
      existing.pluginId = pluginId
      existing.uiUrl = pluginHandle?.uiUrl
      existing.visible = true
      if (!event.sticky) {
        existing.remainingMs = AUTO_HIDE_MS
        existing.totalMs = AUTO_HIDE_MS
        startTimer(existing)
      } else {
        stopTimer(existing)
        existing.remainingMs = 0
      }
      seenBusEventIds.add(event.id)
      void adjustWindowSize()
      return
    }
  }

  // rest-timer: upsert in place by kind/dedupe; do not gate on seenBusEventIds
  // because backend update() keeps the same event id with rising revision.
  if (kind === 'rest-timer') {
    updateRestTimer({
      break_minutes: typeof p.break_minutes === 'number' ? p.break_minutes : 0,
      rest_start_ts: typeof p.rest_start_ts === 'number' ? p.rest_start_ts : 0,
      rest_streak: typeof p.rest_streak === 'number' ? p.rest_streak : 0,
      remaining_minutes: typeof p.remaining_minutes === 'number' ? p.remaining_minutes : 0,
      is_complete: Boolean(p.is_complete),
      title: event.title || undefined,
      body: event.body || undefined,
      eventId: event.id,
      dedupeKey: dedupeKey ?? 'reminder.rest.timer',
    })
    return
  }

  if (seenBusEventIds.has(event.id)) return
  seenBusEventIds.add(event.id)

  logFrontend('info', `[toast-fe] bus event kind=${kind} id=${event.id}`).catch(() => {})

  // 同 dedupe_key：原地刷新已有卡（不 remove+add），连点只重置内容/计时，不抖窗口
  if (dedupeKey) {
    const existing = notifications.value.find(
      (n) => n.dedupeKey === dedupeKey && !n.leaving,
    )
    if (existing) {
      if (existing.eventId && existing.eventId !== event.id) {
        seenBusEventIds.add(existing.eventId)
      }
      existing.eventId = event.id
      existing.kind = kind
      existing.title = event.title || ''
      existing.body = event.body || ''
      existing.boundary = boundary
      existing.visible = true
      if (kind === 'sdk' || isPluginEvent) {
        existing.level = event.level
        existing.sdkActions = event.actions || []
        existing.sdkProgress = event.progress ?? null
        existing.sticky = !!event.sticky
        existing.busEvent = event
        existing.pluginId = pluginId
        existing.uiUrl = pluginHandle?.uiUrl
      }
      // permission / sticky agent 走独立生命周期，不在这里重置 auto-hide
      const stickyPlugin = isPluginEvent && !!event.sticky
      if (
        kind !== 'permission' &&
        !(kind === 'agent' && (event.sticky || p.mode === 'sticky')) &&
        kind !== 'update' &&
        !(kind === 'sdk' && event.sticky) &&
        !stickyPlugin
      ) {
        const autoHideMs = kind === 'eye' ? EYE_AUTO_HIDE_MS : AUTO_HIDE_MS
        existing.remainingMs = autoHideMs
        existing.totalMs = autoHideMs
        startTimer(existing)
      }
      void adjustWindowSize()
      return
    }
  }

  addNotification({
    kind,
    boundary,
    title: event.title || '',
    body: event.body || '',
    eventId: event.id,
    dedupeKey,
    version: typeof p.version === 'string' ? p.version : undefined,
    updateBody: typeof p.updateBody === 'string' ? p.updateBody : undefined,
    event: typeof p.event === 'string' ? p.event : undefined,
    agentState: typeof p.agentState === 'string' ? p.agentState : undefined,
    mode:
      typeof p.mode === 'string'
        ? p.mode
        : event.sticky
          ? 'sticky'
          : undefined,
    sessionId: typeof p.sessionId === 'string' ? p.sessionId : undefined,
    cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
    prompt: typeof p.prompt === 'string' ? p.prompt : undefined,
    summary: typeof p.summary === 'string' ? p.summary : undefined,
    sessionTitle: typeof p.sessionTitle === 'string' ? p.sessionTitle : undefined,
    requestId: typeof p.requestId === 'number' ? p.requestId : undefined,
    toolName: typeof p.toolName === 'string' ? p.toolName : undefined,
    toolInput: p.toolInput,
    level: event.level,
    sticky: !!event.sticky,
    sdkActions: kind === 'sdk' || isPluginEvent ? (event.actions || []) : undefined,
    sdkProgress: kind === 'sdk' || isPluginEvent ? (event.progress ?? null) : undefined,
    busEvent: isPluginEvent ? event : undefined,
    pluginId,
    uiUrl: pluginHandle?.uiUrl,
  })
}

function markEventResolved(eventId: string | undefined, actionId?: string) {
  if (!eventId) return
  seenBusEventIds.add(eventId)
  const p = actionId
    ? resolveEventAction(eventId, actionId).catch(() => null)
    : resolveEvent(eventId, { kind: 'dismissed' }).catch(() => null)
  void p
}

async function addNotification(payload: {
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
  level?: EventLevel | string
  sticky?: boolean
  sdkActions?: EventAction[]
  sdkProgress?: EventProgress | null
  busEvent?: BusEvent
  pluginId?: string
  uiUrl?: string
}) {
  // 权限审批卡（P6）：常驻直到用户决策，不参与自动隐藏与 sticky 合并
  if (payload.kind === 'permission') {
    logFrontend('info', `[toast-fe] permission 分支进入 requestId=${payload.requestId ?? '-'} notifications=${notifications.value.length}`).catch(() => {})
    playAgentSound()
    while (notifications.value.length >= MAX_NOTIFICATIONS) {
      removeNotification(notifications.value[0].id, false)
    }
    const id = ++idCounter
    const item: ToastItem = {
      id,
      kind: 'permission',
      title: '',
      body: '',
      boundary: 0,
      visible: false,
      isHovered: false,
      remainingMs: 0,
      closeTimer: null,
      lastStartAt: 0,
      permission: {
        requestId: payload.requestId ?? 0,
        toolName: payload.toolName || '',
        toolInput: payload.toolInput,
        sessionId: payload.sessionId,
        cwd: payload.cwd,
      },
      totalMs: 0,
    }
    notifications.value.push(item)
    requestAnimationFrame(() => {
      const found = notifications.value.find((n) => n.id === id)
      if (found) found.visible = true
      logFrontend('info', `[toast-fe] permission 卡已 push id=${id} requestId=${item.permission?.requestId ?? '-'} visible=${found?.visible}`).catch(() => {})
    })
    await adjustWindowSize()
    scrollStackToBottom()
    return
  }

  // sticky 型 agent 通知合并进同一张卡片：同 session 的新事件刷新条目，
  // 不同 session 追加为新条目，避免多 agent 同时等待时糊屏。
  if (payload.kind === 'agent' && payload.mode === 'sticky') {
    playAgentSound()
    const existing = notifications.value.find((n) => n.kind === 'agent' && n.sticky)
    if (existing) {
      const entry: AgentEntry = {
        event: payload.event || '',
        sessionId: payload.sessionId,
        cwd: payload.cwd,
        prompt: payload.prompt,
        summary: payload.summary,
        sessionTitle: payload.sessionTitle,
      }
      const idx = existing.agentEntries?.findIndex(
        (e) => e.sessionId && e.sessionId === entry.sessionId
      ) ?? -1
      if (idx >= 0 && existing.agentEntries) {
        existing.agentEntries[idx] = entry
      } else {
        existing.agentEntries = [...(existing.agentEntries ?? []), entry]
      }
      // 合并后内容变高；stack 已是固定窗口高时只内部滚动，ResizeObserver 看不到
      // client 尺寸变化，必须主动重算窗口高度，否则卡片底部（前往/全部已读）被裁切。
      await nextTick()
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await adjustWindowSize()
      scrollStackToBottom()
      return
    }
  } else if (payload.kind === 'agent') {
    playAgentSound()
  }

  // 限制最大数量，移除最旧的通知（不带动画，避免和进入动画打架）
  while (notifications.value.length >= MAX_NOTIFICATIONS) {
    removeNotification(notifications.value[0].id, false)
  }

  const id = ++idCounter
  const isUpdate = payload.kind === 'update'
  const isAgentSticky = payload.kind === 'agent' && payload.mode === 'sticky'
  const isSdkSticky = payload.kind === 'sdk' && !!payload.sticky
  const isPluginSticky = !!payload.pluginId && !!payload.sticky
  const autoHideMs = payload.kind === 'eye' ? EYE_AUTO_HIDE_MS : AUTO_HIDE_MS
  const isAgent = payload.kind === 'agent'
  const item: ToastItem = {
    id,
    kind: payload.kind,
    title: payload.title || '',
    body: payload.body || '',
    boundary: payload.boundary ?? 0,
    visible: false,
    isHovered: false,
    remainingMs: isUpdate || isAgentSticky || isSdkSticky || isPluginSticky ? 0 : autoHideMs,
    closeTimer: null,
    lastStartAt: 0,
    version: payload.version || '',
    updateBody: payload.updateBody || '',
    showUpdateBody: false,
    updateInstalling: false,
    downloadProgress: 0,
    downloadTotal: 0,
    downloadReceived: 0,
    event: payload.event,
    agentState: payload.agentState,
    sticky: isAgentSticky || isSdkSticky || isPluginSticky,
    agentEntries: isAgent
      ? [{
          event: payload.event || '',
          sessionId: payload.sessionId,
          cwd: payload.cwd,
          prompt: payload.prompt,
          summary: payload.summary,
          sessionTitle: payload.sessionTitle,
        }]
      : undefined,
    totalMs: autoHideMs,
    eventId: payload.eventId,
    dedupeKey: payload.dedupeKey,
    level: payload.level,
    sdkActions: payload.sdkActions,
    sdkProgress: payload.sdkProgress ?? null,
    busEvent: payload.busEvent,
    pluginId: payload.pluginId,
    uiUrl: payload.uiUrl,
  }

  // 新通知加到底部（数组末尾）
  notifications.value.push(item)

  // 触发动画
  requestAnimationFrame(() => {
    const found = notifications.value.find((n) => n.id === id)
    if (found) {
      found.visible = true
    }
  })

  if (!isUpdate && !isAgentSticky && !isSdkSticky && !isPluginSticky) {
    startTimer(item)
  }
  await adjustWindowSize()
  scrollStackToBottom()
}

function scrollStackToBottom() {
  if (stackRef.value) {
    stackRef.value.scrollTop = stackRef.value.scrollHeight
  }
}

function startTimer(item: ToastItem) {
  stopTimer(item)
  item.lastStartAt = Date.now()
  item.totalMs = item.remainingMs
  item.closeTimer = setTimeout(() => {
    removeNotification(item.id, true)
  }, item.remainingMs)
}

function stopTimer(item: ToastItem) {
  if (item.closeTimer) {
    const elapsed = Date.now() - item.lastStartAt
    item.remainingMs = Math.max(0, item.remainingMs - elapsed)
    clearTimeout(item.closeTimer)
    item.closeTimer = null
  }
}

function handleMouseEnter(item: ToastItem) {
  // 护眼提醒 hover 不暂停倒计时；休息计时/sticky/permission 卡片不依赖 hover 控制生命周期
  if (item.kind === 'eye' || item.kind === 'rest-timer' || item.kind === 'permission' || item.sticky) return
  item.isHovered = true
  stopTimer(item)
}

function handleMouseLeave(item: ToastItem) {
  if (item.kind === 'eye' || item.kind === 'rest-timer' || item.kind === 'permission' || item.sticky) return
  item.isHovered = false
  if (item.remainingMs > 0) {
    startTimer(item)
  } else if (item.kind !== 'update') {
    removeNotification(item.id, true)
  }
}

function captureRects(excludeLeaving = false): Map<number, DOMRect> {
  const map = new Map<number, DOMRect>()
  for (const n of notifications.value) {
    if (excludeLeaving && n.leaving) continue
    const el = cardRefs.value.get(n.id)
    if (el) {
      map.set(n.id, el.getBoundingClientRect())
    }
  }
  return map
}

function removeNotification(id: number, animate: boolean) {
  const index = notifications.value.findIndex((n) => n.id === id)
  if (index === -1) return

  const item = notifications.value[index]
  // 已经在关闭动画中，避免重复触发
  if (item.leaving) return

  // 审批卡被栈顶挤掉 / 关窗 / session 销项时，必须 timeout 挂起请求，
  // 否则 Claude 的 PermissionRequest http hook 一直等，agent 线程卡死。
  // 已决策/已超时的卡 resolve 会返回 false，无害。
  if (item.kind === 'permission' && item.permission?.requestId) {
    resolvePermission(item.permission.requestId, 'timeout').catch(() => {})
  }

  stopTimer(item)
  if (item.endTimer) {
    clearTimeout(item.endTimer)
    item.endTimer = null
  }
  if (item.kind === 'rest-timer') {
    stopRestPoll()
  }

  // 不带动画：直接移除并刷新窗口
  if (!animate) {
    notifications.value = notifications.value.filter((n) => n.id !== id)
    cardRefs.value.delete(id)
    adjustWindowSize()
    if (notifications.value.length === 0) {
      closeWindow()
    }
    return
  }

  // 带动画：先记录老位置，做 FLIP，让剩余卡片掉下来
  const oldRects = captureRects(false)
  item.leaving = true
  isAnimating.value = true

  nextTick(() => {
    const leavingEl = cardRefs.value.get(id)
    const oldRect = oldRects.get(id)

    // 把要关闭的卡片固定在老位置，脱离文档流，腾出空间让上面的卡片掉下来
    if (leavingEl && oldRect) {
      leavingEl.style.position = 'fixed'
      leavingEl.style.top = `${oldRect.top}px`
      leavingEl.style.left = `${oldRect.left}px`
      leavingEl.style.width = `${oldRect.width}px`
      leavingEl.style.height = `${oldRect.height}px`
      leavingEl.style.margin = '0'
      leavingEl.style.zIndex = '10'
      leavingEl.style.pointerEvents = 'none'
    }

    // 现在剩余卡片已经重新排布，记录新位置
    const newRects = captureRects(true)

    // 给剩余卡片加上反向偏移，让它们看起来还在老位置
    for (const n of notifications.value) {
      if (n.leaving) continue
      const el = cardRefs.value.get(n.id)
      const oldPos = oldRects.get(n.id)
      const newPos = newRects.get(n.id)
      if (!el || !oldPos || !newPos) continue

      const dy = oldPos.top - newPos.top
      if (Math.abs(dy) > 0.5) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${dy}px)`
      }
    }

    // 强制重排，让上面的 transform 先生效
    stackRef.value?.offsetHeight

    // 然后释放 transform，卡片就会从老位置平滑掉落到新位置
    for (const n of notifications.value) {
      if (n.leaving) continue
      const el = cardRefs.value.get(n.id)
      if (!el) continue
      el.style.transition = ''
      el.style.transform = ''
    }

    // 被关闭的卡片向右滑出并淡出
    if (leavingEl) {
      leavingEl.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease'
      leavingEl.style.transform = 'translateX(120%)'
      leavingEl.style.opacity = '0'
    }

    // 动画结束后真正从数据里移除，并调整窗口大小
    setTimeout(() => {
      notifications.value = notifications.value.filter((n) => n.id !== id)
      cardRefs.value.delete(id)
      isAnimating.value = false
      adjustWindowSize()
      if (notifications.value.length === 0) {
        closeWindow()
      }
    }, 350)
  })
}

async function closeWindow() {
  try {
    await closeReminderWindow('reminder-toast')
  } catch {
    try {
      await getCurrentWebviewWindow().close()
    } catch {
      // ignore
    }
  }
}

async function handleSnooze(item: ToastItem, minutes: number) {
  stopTimer(item)
  try {
    await snoozeReminder(minutes)
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'snooze')
  removeNotification(item.id, true)
}

async function handleSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipReminder(item.boundary)
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'skip')
  removeNotification(item.id, true)
}

async function handleDrinkWater(item: ToastItem) {
  stopTimer(item)
  try {
    await recordWater(Math.floor(Date.now() / 1000))
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'drunk')
  removeNotification(item.id, true)
}

async function handleWaterSnooze(item: ToastItem, minutes: number) {
  stopTimer(item)
  try {
    await snoozeWaterReminder(minutes)
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'snooze_5')
  removeNotification(item.id, true)
}

async function handleWaterSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipWaterReminder()
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'skip')
  removeNotification(item.id, true)
}

async function handleEyeSnooze(item: ToastItem, minutes: number) {
  stopTimer(item)
  try {
    await snoozeEyeReminder(minutes)
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'snooze_5')
  removeNotification(item.id, true)
}

async function handleEyeSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipEyeReminder()
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'skip')
  removeNotification(item.id, true)
}

function toggleUpdateDetails(item: ToastItem) {
  item.showUpdateBody = !item.showUpdateBody
  nextTick(() => adjustWindowSize())
}

/**
 * 从 sticky agent 待办卡 + 审批卡里销掉指定 session。
 * - 多会话聚合：只移除该条目；条目清空则整卡关闭
 * - 单条 / auto 卡：session 匹配则整卡关闭
 * - permission 卡：session 匹配则整卡关闭（后端已/将把挂起审批 timeout 掉）
 * 来源：UserPromptSubmit 自动销项、同 session 新审批顶替旧卡、或用户在聚合列表点「前往」后
 */
function dismissAgentSession(sessionId: string) {
  if (!sessionId || sessionId === 'unknown') return
  // 审批卡：按 session 整卡关。不在这里 resolve——后端 UserPromptSubmit / 顶替路径已 timeout。
  const permCards = notifications.value.filter(
    (n) => n.kind === 'permission' && n.permission?.sessionId === sessionId,
  )
  for (const item of permCards) {
    removeNotification(item.id, true)
  }

  const targets = notifications.value.filter((n) => n.kind === 'agent' && n.agentEntries?.length)
  for (const item of targets) {
    const entries = item.agentEntries
    if (!entries) continue
    const next = entries.filter((e) => e.sessionId !== sessionId)
    if (next.length === entries.length) continue
    if (next.length === 0) {
      removeNotification(item.id, true)
    } else {
      item.agentEntries = next
      nextTick(() => adjustWindowSize())
    }
  }
}

function handleSdkAction(item: ToastItem, actionId: string) {
  markEventResolved(item.eventId, actionId)
  removeNotification(item.id, true)
}

function handlePluginAction(item: ToastItem, actionId: string) {
  markEventResolved(item.eventId, actionId)
  removeNotification(item.id, true)
}

async function handleClose(item: ToastItem) {
  // 休息计时卡片关闭时同步通知后端清理 break_timer_active，避免卡片反复出现
  if (item.kind === 'rest-timer') {
    try {
      await dismissRestTimer()
    } catch {
      // ignore
    }
  }
  markEventResolved(item.eventId)
  removeNotification(item.id, true)
}

async function handleUpdateInstall(item: ToastItem) {
  if (item.updateInstalling) return
  item.updateInstalling = true
  try {
    const update = await check({ timeout: 10000 })
    if (!update) {
      item.body = t('settings.messages.noUpdateFound')
      return
    }
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          item.downloadTotal = event.data.contentLength || 0
          break
        case 'Progress':
          item.downloadReceived = (item.downloadReceived || 0) + event.data.chunkLength
          if ((item.downloadTotal || 0) > 0) {
            item.downloadProgress = Math.round(
              ((item.downloadReceived || 0) / (item.downloadTotal || 1)) * 100
            )
          }
          break
        case 'Finished':
          item.downloadProgress = 100
          break
      }
    })
    await relaunch()
  } catch (e) {
    console.error(e)
    item.body = t('settings.messages.updateFailed')
  } finally {
    item.updateInstalling = false
  }
}
</script>

<template>
  <div ref="rootRef" class="toast-root" :class="{ 'debug-bg': showDebug }">
    <div ref="stackRef" class="toast-stack">
      <div
        v-for="item in notifications"
        :key="item.id"
        :ref="(el) => setCardRef(el, item.id)"
        class="toast-card"
        :class="{
          visible: item.visible,
          'toast-card-water': item.kind === 'water',
          'toast-card-eye': item.kind === 'eye',
          'toast-card-update': item.kind === 'update',
          'toast-card-rest-timer': item.kind === 'rest-timer',
          'toast-card-agent': item.kind === 'agent',
          'toast-card-permission': item.kind === 'permission',
          'toast-card-sdk': item.kind === 'sdk',
          'toast-card-plugin': !!item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'),
        }"
        @mouseenter="handleMouseEnter(item)"
        @mouseleave="handleMouseLeave(item)"
      >
        <EyeToastCard
          v-if="item.kind === 'eye'"
          :title="item.title"
          :body="item.body"
          :remaining-ms="item.remainingMs"
          :last-start-at="item.lastStartAt"
          :total-ms="item.totalMs"
          @close="handleClose(item)"
          @snooze="(m) => handleEyeSnooze(item, m)"
          @skip="handleEyeSkip(item)"
        />

        <AgentToastCard
          v-else-if="item.kind === 'agent' && item.agentEntries"
          :entries="item.agentEntries"
          :sticky="!!item.sticky"
          :remaining-ms="item.remainingMs"
          :last-start-at="item.lastStartAt"
          :total-ms="item.totalMs"
          @close="handleClose(item)"
          @dismiss-all="handleClose(item)"
          @dismiss-entry="(sid) => dismissAgentSession(sid)"
          @layout="() => nextTick(() => adjustWindowSize())"
        />

        <PermissionToastCard
          v-else-if="item.kind === 'permission' && item.permission"
          :item="item.permission"
          @close="handleClose(item)"
        />

        <RestToastCard
          v-else-if="item.kind === 'rest'"
          :title="item.title"
          :body="item.body"
          :is-hovered="item.isHovered"
          @close="handleClose(item)"
          @snooze="(m) => handleSnooze(item, m)"
          @skip="handleSkip(item)"
        />

        <WaterToastCard
          v-else-if="item.kind === 'water'"
          :title="item.title"
          :body="item.body"
          :is-hovered="item.isHovered"
          @close="handleClose(item)"
          @drank="handleDrinkWater(item)"
          @snooze="(m) => handleWaterSnooze(item, m)"
          @skip="handleWaterSkip(item)"
        />

        <UpdateToastCard
          v-else-if="item.kind === 'update'"
          :version="item.version"
          :update-body="item.updateBody"
          :show-update-body="item.showUpdateBody"
          :update-installing="item.updateInstalling"
          :download-progress="item.downloadProgress"
          @close="handleClose(item)"
          @toggle-details="toggleUpdateDetails(item)"
          @install="handleUpdateInstall(item)"
        />

        <RestTimerToastCard
          v-else-if="item.kind === 'rest-timer'"
          :title="item.title"
          :body="item.body"
          :rest-streak="item.restStreak"
          :break-minutes="item.breakMinutes"
          @close="handleClose(item)"
        />

        <PluginHostCard
          v-else-if="item.busEvent && (item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'))"
          :event="item.busEvent"
          :is-hovered="item.isHovered"
          :ui-url="item.uiUrl"
          :plugin-id="item.pluginId"
          @close="handleClose(item)"
          @action="(aid) => handlePluginAction(item, aid)"
        />

        <SdkToastCard
          v-else-if="item.kind === 'sdk'"
          :title="item.title"
          :body="item.body"
          :level="item.level"
          :is-hovered="item.isHovered"
          :sticky="!!item.sticky"
          :progress="item.sdkProgress"
          :actions="item.sdkActions"
          @close="handleClose(item)"
          @action="(aid) => handleSdkAction(item, aid)"
        />

        <!-- Plugin event without custom UI: fall back to SdkToastCard -->
        <SdkToastCard
          v-else-if="!isBuiltinKind(item.kind)"
          :title="item.title"
          :body="item.body"
          :level="item.level"
          :is-hovered="item.isHovered"
          :sticky="!!item.sticky"
          :progress="item.sdkProgress"
          :actions="item.sdkActions"
          @close="handleClose(item)"
          @action="(aid) => handleSdkAction(item, aid)"
        />
      </div>
    </div>

    <!-- 调试面板 -->
    <div v-if="showDebug" class="debug-panel">
      <div>count: {{ debugInfo.count }}</div>
      <div>calcH: {{ debugInfo.calcHeight }}</div>
      <div>beforeSize: {{ debugInfo.beforeSize.width }}x{{ debugInfo.beforeSize.height }}</div>
      <div>beforePos: {{ debugInfo.beforePos.x }},{{ debugInfo.beforePos.y }}</div>
      <div>sf: {{ debugInfo.sf }}</div>
      <div>afterSize: {{ debugInfo.afterSize.width }}x{{ debugInfo.afterSize.height }}</div>
      <div>afterPos: {{ debugInfo.afterPos.x }},{{ debugInfo.afterPos.y }}</div>
      <div v-if="debugInfo.error" class="debug-error">err: {{ debugInfo.error }}</div>
    </div>
  </div>
</template>

<style scoped>
.toast-root {
  --toast-auto-hide-ms: 8000ms;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-end;
  padding: 1rem;
  box-sizing: border-box;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
  overflow: hidden;
}

.toast-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  /* overflow 会把卡片阴影裁掉；四边各借 16px padding 放阴影，
     负 margin 拉回，保证卡片宽度/窗口高度不变 */
  margin: -1rem;
  padding: 1rem;
}

.toast-stack::-webkit-scrollbar {
  display: none;
}

.toast-root.debug-bg {
  background: rgba(255, 220, 0, 0.45);
}

.toast-card {
  width: 100%;
  max-height: 37.5rem;
  background: #ffffff;
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
  transform: translateX(120%) scale(0.96);
  opacity: 0;
  transition:
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.3s ease;
  flex-shrink: 0;
  will-change: transform, opacity;
}

.toast-card.visible {
  transform: translateX(0) scale(1);
  opacity: 1;
}

/* Eye reminder: keep wrapper sizing minimal */
.toast-card-eye {
  min-height: auto;
}

/* Agent / permission / eye / update：内容自撑高度，不要被通用 min-height 卡住或裁切 */
.toast-card-agent,
.toast-card-permission,
.toast-card-sdk {
  min-height: auto;
}

/* Agent notification theming — dynamic per event */
.toast-card-agent .pulse-dot {
  background: var(--accent);
}

.toast-card-agent .progress-bar {
  background: linear-gradient(90deg, var(--accent), var(--light-bg));
}

.toast-card-agent .title {
  color: var(--title);
}

.toast-card-agent .close-btn:hover {
  background: var(--light-bg);
  color: var(--accent);
}

.toast-card-agent .body-text {
  color: var(--body);
}

/* Permission approval card (P6) — amber, always visible until decision */
.toast-card-permission {
  border: 0.0625rem solid #fde68a;
  box-shadow:
    0 0.5rem 1.5rem rgba(245, 158, 11, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
}

.debug-panel {
  position: fixed;
  top: 0.5rem;
  left: 0.5rem;
  background: rgba(0, 0, 0, 0.7);
  color: #0f0;
  font-family: monospace;
  font-size: 0.6875rem;
  padding: 0.5rem;
  border-radius: 0.25rem;
  z-index: 9999;
  pointer-events: none;
  line-height: 1.4;
}

.debug-error {
  color: #f44;
}
</style>
