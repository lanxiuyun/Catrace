<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen } from '@tauri-apps/api/event'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  getReminderData,
  getToastDebugMode,
  snoozeReminder,
  skipReminder,
  closeReminderWindow,
  setToastContentSize,
  setWindowActiveMode,
  getActivitySnapshot,
  dismissRestTimer,
  resolveEvent,
  resolveEventAction,
  getActiveEvents,
  checkAppUpdate,
  installAppUpdate,
} from '../../api/tauri'
import type { BusEvent } from '../../types/event'
import RestToastCard from '../../components/RestToastCard.vue'
import UpdateToastCard from '../../components/UpdateToastCard.vue'
import RestTimerToastCard from '../../components/RestTimerToastCard.vue'
import SdkToastCard from '../../components/SdkToastCard.vue'
import SpecialDayToastCard from '../../components/SpecialDayToastCard.vue'
import PluginHostCard from '../../components/PluginHostCard.vue'
import { clearPluginHostCardCache } from '../../components/pluginHostCardCache'
import type { EventAction, EventLevel, EventProgress } from '../../types/event'
import { usePluginRegistry } from '../../stores/pluginRegistry'
import { loadExternalPlugins } from '../../plugins/loadExternalPlugins'

const { t } = useI18n()
const pluginRegistry = usePluginRegistry()

const BUILTIN_TOAST_KINDS = [
  'rest',
  'update',
  'rest-timer',
  'sdk',
  'special',
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
  sticky?: boolean
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
  // special-day fields
  specialTag?: string
  specialIcon?: string
  specialCategory?: 'history' | 'life'
}

function resolveAutoHideMs(event: BusEvent | undefined | null, sticky: boolean): number {
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

const notifications = ref<ToastItem[]>([])
const cardRefs = ref<Map<number, HTMLElement>>(new Map())
const showDebug = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const stackRef = ref<HTMLElement | null>(null)
const isAnimating = ref(false)
let idCounter = 0
let resizeObserver: ResizeObserver | null = null
let unlistenDebug: (() => void) | null = null
let unlistenBusEvent: (() => void) | null = null
let unlistenReloadPlugins: (() => void) | null = null
const WINDOW_LABEL = 'reminder-toast'
let toastActivated = false
/** Bus event ids already shown (or resolved) — prevent double-render with eval legacy path. */
const seenBusEventIds = new Set<string>()

// 休息计时卡片：每 2 秒轮询活跃，活跃即隐藏
let restPollTimer: ReturnType<typeof setInterval> | null = null
let restPollBaseline = 0
const REST_POLL_MS = 2000
// 文档声明恢复活跃后延迟 4 秒移除
const REST_TIMER_REMOVE_DELAY_MS = 4000

const AUTO_HIDE_MS = 8000
/** 卡片离场后移除时机：等 opacity 淡完（0.25s）即视为不可见，立即移除让剩余卡片掉落；
 *  transform 0.35s 滑出屏幕后的尾部已不可见，无需等待，避免「隐形卡占位」造成的掉卡延迟。 */
const LEAVE_ANIMATION_MS = 250
/** Clamp plugin/sdk payload auto-hide (ms). 0 only valid when sticky. */
const MIN_AUTO_HIDE_MS = 3000
const MAX_AUTO_HIDE_MS = 10 * 60 * 1000

onMounted(async () => {
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

  // Plugins page refresh → reload external card UI without app restart.
  unlistenReloadPlugins = await listen('catrace:reload-external-plugins', () => {
    void loadExternalPlugins({ force: true })
      .then(() => {
        // Registry first, then bust cache so remount resolves the new Card once.
        const reg = usePluginRegistry()
        for (const n of notifications.value) {
          if (!n.pluginId || n.leaving) continue
          const handle = reg.getPlugin(n.pluginId) || reg.getPluginForKind(n.kind)
          if (handle?.uiUrl) n.uiUrl = handle.uiUrl
        }
        clearPluginHostCardCache()
      })
      .catch((e) => {
        console.warn('[toast] reload external plugins failed', e)
      })
  })

  // Event Bus → Toast 统一渲染线（rest / timer / plugin 等 display_mode=toast 的 active 事件）
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

  // 监听布局变化，按内容高度 resize 原生小窗
  await nextTick()
  if (stackRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!isAnimating.value) {
        scheduleWindowResize()
      }
    })
    resizeObserver.observe(stackRef.value)
    for (const el of cardRefs.value.values()) {
      resizeObserver.observe(el)
    }
  }
  scheduleWindowResize()
  document.addEventListener('pointerdown', handleToastPointerDown, true)

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
  unlistenBusEvent?.()
  unlistenBusEvent = null
  unlistenReloadPlugins?.()
  unlistenReloadPlugins = null
  document.removeEventListener('pointerdown', handleToastPointerDown, true)
  stopRestPoll()
  notifications.value.forEach(stopTimer)
  resizeObserver?.disconnect()
  resizeObserver = null
})

function setCardRef(el: unknown, id: number) {
  const prev = cardRefs.value.get(id)
  if (prev && prev !== el) {
    resizeObserver?.unobserve(prev)
  }
  if (el instanceof HTMLElement) {
    cardRefs.value.set(id, el)
    resizeObserver?.observe(el)
  } else {
    cardRefs.value.delete(id)
  }
}

// ---------- 小窗尺寸上报 ----------

let resizeScheduled = false
let lastSizeKey = ''

/** 按内容实测高度钉原生小窗。stack 四边 16px 出血已计入 scrollHeight。 */
async function reportWindowSize() {
  const root = rootRef.value
  const stack = stackRef.value
  if (!root || !stack) return
  const width = Math.max(1, Math.ceil(root.scrollWidth))
  const height = Math.max(160, Math.ceil(stack.scrollHeight))
  const key = `${width}x${height}`

  // 卡片离场/进入动画期间禁止收缩窗口，避免 DOM 里卡片还没移除但窗口先变小导致截断
  if (isAnimating.value) {
    const prevH = Number.parseFloat(lastSizeKey.split('x')[1] || '0')
    if (height <= prevH) return
  }

  if (key === lastSizeKey) return
  lastSizeKey = key
  try {
    await setToastContentSize(width, height)
  } catch {
    // ignore
  }
}

function scheduleWindowResize() {
  if (resizeScheduled) return
  resizeScheduled = true
  nextTick(() => {
    requestAnimationFrame(() => {
      resizeScheduled = false
      void reportWindowSize()
    })
  })
}

async function activateToastWindow() {
  if (toastActivated) return
  toastActivated = true
  try {
    await setWindowActiveMode(WINDOW_LABEL, true)
  } catch {
    toastActivated = false
  }
}

function handleToastPointerDown() {
  void activateToastWindow()
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

  scheduleWindowResize()
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

  const pluginName =
    event.source &&
    typeof event.source === 'object' &&
    (event.source as { type?: string; name?: string }).type === 'plugin'
      ? (event.source as { name?: string }).name
      : undefined
  const tracePluginAction = pluginName === 'sidecar-echo' || event.kind === 'sidecar-echo'
  if (tracePluginAction) {
    console.info('[sidecar-action] bus event', {
      eventId: event.id,
      status: event.status,
      revision: event.revision,
      resolution: event.resolution,
      pluginName,
      kind: event.kind,
    })
  }

  if (event.status === 'resolved') {
    seenBusEventIds.add(event.id)
    // Superseded = same dedupe_key was replaced by a newer publish. Keep the visible
    // card; the following active event will upsert in place. Removing here causes
    // unmount+remount of PluginHostCard (Blob re-import) and freezes toast on rapid test.
    if (event.resolution?.kind === 'superseded') {
      if (tracePluginAction) {
        console.info('[sidecar-action] resolved keep (superseded)', {
          eventId: event.id,
          resolution: event.resolution,
        })
      }
      return
    }
    const existing = notifications.value.find((n) => n.eventId === event.id)
    // Sticky plugin cards: only end/dismiss unload. Other action ids are the plugin's.
    const actionId = event.resolution?.action_id
    const keepForActionRoundtrip =
      !!existing?.pluginId &&
      !!existing.sticky &&
      event.resolution?.kind === 'action' &&
      actionId !== 'end' &&
      actionId !== 'dismiss'
    if (tracePluginAction) {
      console.info('[sidecar-action] resolved handling', {
        eventId: event.id,
        notificationId: existing?.id,
        found: !!existing,
        keepForActionRoundtrip,
        resolution: event.resolution,
        leaving: existing?.leaving,
      })
    }
    if (existing && !keepForActionRoundtrip) {
      console.info('[sidecar-action] resolved removal', {
        eventId: event.id,
        notificationId: existing.id,
      })
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

  if (isPluginEvent && p.dismiss === true) {
    const existing =
      notifications.value.find((n) => n.eventId === event.id && !n.leaving) ||
      (dedupeKey
        ? notifications.value.find((n) => n.dedupeKey === dedupeKey && !n.leaving)
        : undefined)
    if (existing) removeNotification(existing.id, true)
    seenBusEventIds.add(event.id)
    return
  }

  // sdk / plugin: same event id OR same dedupe_key → refresh in place (never remount card).
  if (kind === 'sdk' || isPluginEvent) {
    const existing = notifications.value.find((n) => n.eventId === event.id && !n.leaving)
      || (dedupeKey
        ? notifications.value.find((n) => n.dedupeKey === dedupeKey && !n.leaving)
        : undefined)
    if (existing) {
      if (tracePluginAction) {
        console.info('[sidecar-action] upsert in place', {
          notificationId: existing.id,
          prevEventId: existing.eventId,
          nextEventId: event.id,
          dedupeKey,
          leaving: !!existing.leaving,
          t: Date.now(),
        })
      }
      if (existing.eventId && existing.eventId !== event.id) {
        seenBusEventIds.add(existing.eventId)
      }
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
      // Keep prior uiUrl if registry momentarily empty — avoids card reload thrash.
      if (pluginHandle?.uiUrl) existing.uiUrl = pluginHandle.uiUrl
      existing.visible = true
      if (!event.sticky) {
        // Hover paused the close timeout. A chat upsert must not restart it,
        // or the CSS bar stays frozen while the card still auto-dismisses.
        if (!existing.isHovered) {
          const autoHideMs = resolveAutoHideMs(event, false)
          existing.remainingMs = autoHideMs
          existing.totalMs = autoHideMs
          startTimer(existing)
        }
      } else {
        stopTimer(existing)
        existing.remainingMs = 0
        existing.totalMs = 0
      }
      seenBusEventIds.add(event.id)
      void nextTick(() => scheduleWindowResize())
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
        if (pluginHandle?.uiUrl) existing.uiUrl = pluginHandle.uiUrl
      }
      if (kind === 'special') {
        existing.sticky = true
        existing.specialTag = typeof p.tag === 'string' ? p.tag : existing.specialTag
        existing.specialIcon = typeof p.icon === 'string' ? p.icon : existing.specialIcon
        if (p.category === 'history' || p.category === 'life') {
          existing.specialCategory = p.category
        }
        stopTimer(existing)
        existing.remainingMs = 0
        existing.totalMs = 0
      }
      // sticky plugin 走独立生命周期，不在这里重置 auto-hide
      const stickyPlugin = isPluginEvent && !!event.sticky
      if (
        kind !== 'special' &&
        kind !== 'update' &&
        !(kind === 'sdk' && event.sticky) &&
        !stickyPlugin &&
        !existing.isHovered
      ) {
        const autoHideMs = resolveAutoHideMs(event, false)
        existing.remainingMs = autoHideMs
        existing.totalMs = autoHideMs
        startTimer(existing)
      }
      void scheduleWindowResize()
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
    level: event.level,
    sticky: !!event.sticky,
    sdkActions: kind === 'sdk' || isPluginEvent ? (event.actions || []) : undefined,
    sdkProgress: kind === 'sdk' || isPluginEvent ? (event.progress ?? null) : undefined,
    busEvent: isPluginEvent ? event : undefined,
    pluginId,
    uiUrl: pluginHandle?.uiUrl,
    tag: typeof p.tag === 'string' ? p.tag : undefined,
    icon: typeof p.icon === 'string' ? p.icon : undefined,
    category:
      p.category === 'history' || p.category === 'life'
        ? p.category
        : undefined,
  })
}

function markEventResolved(eventId: string | undefined, actionId?: string) {
  if (!eventId) {
    console.warn('[sidecar-action] resolve skipped: missing eventId', { actionId })
    return
  }
  const startedAt = performance.now()
  console.info('[sidecar-action] resolve invoke:start', {
    eventId,
    actionId,
    t: Date.now(),
  })
  // Do not pre-mark seen for action resolves: sticky plugin cards may stay
  // mounted and later receive a fresh active event with a new id.
  if (!actionId) {
    seenBusEventIds.add(eventId)
  }
  const request = actionId
    ? resolveEventAction(eventId, actionId)
    : resolveEvent(eventId, { kind: 'dismissed' })
  void request.then(
    (event) => {
      console.info('[sidecar-action] resolve invoke:done', {
        eventId,
        actionId,
        elapsedMs: Math.round(performance.now() - startedAt),
        status: event?.status,
        resolution: event?.resolution,
        t: Date.now(),
      })
    },
    (error) => {
      console.error('[sidecar-action] resolve invoke:error', {
        eventId,
        actionId,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
        t: Date.now(),
      })
    },
  )
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
  tag?: string
  icon?: string
  category?: 'history' | 'life'
}) {
  // 不加数量上限：卡片超出窗口高度时由滚动容器（n-scrollbar）接管
  const id = ++idCounter
  const isUpdate = payload.kind === 'update'
  const isSdkSticky = payload.kind === 'sdk' && !!payload.sticky
  const isPluginSticky = !!payload.pluginId && !!payload.sticky
  const isSpecial = payload.kind === 'special'
  const isSticky = isUpdate || isSdkSticky || isPluginSticky || isSpecial
  const autoHideMs = isSticky
    ? 0
    : resolveAutoHideMs(payload.busEvent, false)
  const item: ToastItem = {
    id,
    kind: payload.kind,
    title: payload.title || '',
    body: payload.body || '',
    boundary: payload.boundary ?? 0,
    visible: false,
    isHovered: false,
    remainingMs: isSticky ? 0 : autoHideMs,
    closeTimer: null,
    lastStartAt: 0,
    version: payload.version || '',
    updateBody: payload.updateBody || '',
    showUpdateBody: false,
    updateInstalling: false,
    downloadProgress: 0,
    downloadTotal: 0,
    downloadReceived: 0,
    sticky: isSdkSticky || isPluginSticky || isSpecial,
    totalMs: isSticky ? 0 : autoHideMs,
    eventId: payload.eventId,
    dedupeKey: payload.dedupeKey,
    level: payload.level,
    sdkActions: payload.sdkActions,
    sdkProgress: payload.sdkProgress ?? null,
    busEvent: payload.busEvent,
    pluginId: payload.pluginId,
    uiUrl: payload.uiUrl,
    specialTag: payload.tag,
    specialIcon: payload.icon,
    specialCategory: payload.category,
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

  if (!isSticky) {
    startTimer(item)
  }
  await nextTick()
  scheduleWindowResize()
  scrollStackToBottom()
}

function scrollStackToBottom() {
  const stack = stackRef.value
  if (!stack) return

  // Keep the shadow padding visible when only one card is present.
  if (notifications.value.length <= 1) {
    stack.scrollTop = 0
    return
  }
  stack.scrollTop = stack.scrollHeight
}

function startTimer(item: ToastItem) {
  if (item.isHovered && !item.sticky) return
  stopTimer(item)
  item.lastStartAt = Date.now()
  // Keep original totalMs for progress UI. Only remainingMs shrinks across hover pauses.
  if (!(item.totalMs > 0)) item.totalMs = item.remainingMs
  item.closeTimer = setTimeout(() => {
    // 自动消失路径必须把后端事件 resolve，否则刷新/水合时旧 toast 会复活
    markEventResolved(item.eventId)
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
  // 休息计时 / sticky / permission / 特殊日 卡片不依赖 hover 控制生命周期
  if (item.kind === 'rest-timer' || item.kind === 'special' || item.sticky) return
  // 只允许一张卡处于 hover 态：WebView 偶发漏 mouseleave 时，
  // 避免多张卡同时 isHovered，一次 leave 会清掉一整堆。
  for (const n of notifications.value) {
    if (n !== item && n.isHovered) {
      handleMouseLeave(n)
    }
  }
  item.isHovered = true
  stopTimer(item)
}

function handleMouseLeave(item: ToastItem) {
  if (item.kind === 'rest-timer' || item.kind === 'special' || item.sticky) return
  item.isHovered = false
  if (item.remainingMs > 0) {
    startTimer(item)
  } else if (item.kind !== 'update') {
    // hover 暂停把剩余时间拖到 0 的卡片，离开时不再立即删除：
    // 否则光标一碰（真实 mouseleave 或 Rust hover-exit 事件）整堆卡片连锁消失。
    // 改为重置完整自动隐藏时长，卡片仍在最后一次交互后按时自动消失。
    item.remainingMs = item.totalMs > 0 ? item.totalMs : AUTO_HIDE_MS
    item.totalMs = item.remainingMs
    startTimer(item)
  }
}

function removeNotification(id: number, animate: boolean) {
  const index = notifications.value.findIndex((n) => n.id === id)
  if (index === -1) return

  const item = notifications.value[index]
  // 已经在关闭动画中，避免重复触发
  if (item.leaving) return

  stopTimer(item)
  if (item.endTimer) {
    clearTimeout(item.endTimer)
    item.endTimer = null
  }
  if (item.kind === 'rest-timer') {
    stopRestPoll()
  }

  if (!animate) {
    // 不带动画：直接移除并刷新窗口
    doRemoveCard(id)
    return
  }

  // 带动画：只切 `.leaving` class 让卡片在原位淡出滑出。
  // 不做 fixed 定位 + transform 的 FLIP —— 透明全屏 WebView2 上改 DOM 定位
  // 并强制重排会把 GPU 合成器卡死（toast 窗口冻结）；剩余卡片在移除后自然补位。
  item.leaving = true
  isAnimating.value = true
  setTimeout(() => {
    doRemoveCard(id)
    isAnimating.value = false
    scheduleWindowResize()
  }, LEAVE_ANIMATION_MS)
}

/** 真正从数据里移除一张卡，刷新窗口高度，空栈时关窗。 */
function doRemoveCard(id: number) {
  const el = cardRefs.value.get(id)
  if (el) resizeObserver?.unobserve(el)
  notifications.value = notifications.value.filter((n) => n.id !== id)
  cardRefs.value.delete(id)
  scheduleWindowResize()
  if (notifications.value.length === 0) {
    closeWindow()
  }
}

async function closeWindow() {
  lastSizeKey = ''
  toastActivated = false
  try {
    await setWindowActiveMode(WINDOW_LABEL, false)
  } catch {
    // hide 路径会再套 NOACTIVATE；失败不挡关窗
  }
  try {
    await closeReminderWindow(WINDOW_LABEL)
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

function toggleUpdateDetails(item: ToastItem) {
  item.showUpdateBody = !item.showUpdateBody
  nextTick(() => scheduleWindowResize())
}

function handleSdkAction(item: ToastItem, actionId: string) {
  markEventResolved(item.eventId, actionId)
  removeNotification(item.id, true)
}

function handlePluginAction(item: ToastItem, actionId: string) {
  console.info('[sidecar-action] toast action', {
    notificationId: item.id,
    eventId: item.eventId,
    pluginId: item.pluginId,
    actionId,
    sticky: !!item.sticky,
    leaving: !!item.leaving,
    dedupeKey: item.dedupeKey,
    t: Date.now(),
  })
  // Sticky plugin action cards stay mounted (resolved action keeps card).
  // Bus owns non-action removal; never double-remove here.
  markEventResolved(item.eventId, actionId)
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

async function handleUpdateInstall(item: ToastItem, source?: string) {
  if (item.updateInstalling) return
  item.updateInstalling = true
  try {
    const update = await checkAppUpdate({ timeout: 10000, source })
    if (!update) {
      item.body = t('settings.messages.noUpdateFound')
      return
    }
    await installAppUpdate(update, source, (event) => {
      switch (event.event) {
        case 'Started':
          item.downloadTotal = event.data.contentLength || 0
          item.downloadReceived = 0
          item.downloadProgress = 0
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
          leaving: item.leaving,
          'toast-card-update': item.kind === 'update',
          'toast-card-rest-timer': item.kind === 'rest-timer',
          'toast-card-sdk': item.kind === 'sdk',
          'toast-card-special': item.kind === 'special',
          'toast-card-plugin': !!item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'),
        }"
        :style="item.totalMs > 0 ? { '--toast-auto-hide-ms': `${item.totalMs}ms` } : undefined"
        @mouseenter="handleMouseEnter(item)"
        @mouseleave="handleMouseLeave(item)"
      >
        <RestToastCard
          v-if="item.kind === 'rest'"
          :title="item.title"
          :body="item.body"
          :is-hovered="item.isHovered"
          @close="handleClose(item)"
          @snooze="(m) => handleSnooze(item, m)"
          @skip="handleSkip(item)"
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
          @install="(source) => handleUpdateInstall(item, source)"
        />

        <RestTimerToastCard
          v-else-if="item.kind === 'rest-timer'"
          :title="item.title"
          :body="item.body"
          :rest-streak="item.restStreak"
          :break-minutes="item.breakMinutes"
          @close="handleClose(item)"
        />

        <SpecialDayToastCard
          v-else-if="item.kind === 'special'"
          :title="item.title"
          :body="item.body"
          :tag="item.specialTag || ''"
          :icon="item.specialIcon || ''"
          :category="item.specialCategory || 'life'"
          @close="handleClose(item)"
        />

        <PluginHostCard
          v-else-if="item.busEvent && (item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'))"
          :event="item.busEvent"
          :is-hovered="item.isHovered"
          :remaining-ms="item.remainingMs"
          :total-ms="item.totalMs"
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

  </div>
</template>

<style scoped>
.toast-root {
  --toast-auto-hide-ms: 8000ms;
  width: 24.5rem; /* 22.5rem card + 1rem shadow bleed each side */
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 贴窗顶：HWND 底边锚在 work_area。增高若先长高后上移，多出的是透明底，卡片不进任务栏。 */
  justify-content: flex-start;
  align-items: stretch;
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
  flex: 0 1 auto;
  max-height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
  /* 窗口本身就是阴影出血区：左右各 16px，不再负 margin 拉出 root */
  padding: 1rem;
  /* 始终预留右侧滚动条 gutter：滚动条出现/消失都不引起卡片右缘位移。
     右侧视觉留白恒为 16px = padding-right 6px + scrollbar gutter 10px */
  padding-right: 0.375rem;
  scrollbar-gutter: stable;
}

/* 卡片超出窗口高度时的可见滚动条 */
.toast-stack {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.35) transparent;
}
.toast-stack::-webkit-scrollbar {
  width: 10px;
}
.toast-stack::-webkit-scrollbar-track {
  background: transparent;
}
.toast-stack::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 5px;
}
.toast-stack::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.45);
}

.toast-root.debug-bg {
  background: rgba(255, 220, 0, 0.45);
}

.toast-card {
  width: 22.5rem;
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

/* 离场动画：只切 class，依赖 .toast-card 自带的 transition 淡出滑出。
   不做 fixed 定位 / transform FLIP，避免透明全屏 WebView2 合成器冻结。 */
.toast-card.leaving {
  transform: translateX(120%);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.25s ease;
}

/* Agent / permission / sdk / update：内容自撑高度，不要被通用 min-height 卡住或裁切 */
.toast-card-agent,
.toast-card-permission,
.toast-card-sdk {
  min-height: auto;
}

/* Plugin chat cards may be user-resized taller than the generic toast cap. */
.toast-card-plugin {
  min-height: auto;
  max-height: none;
}

.toast-card-special {
  min-height: auto;
  background: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  box-shadow: none;
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
</style>
