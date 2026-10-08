/**
 * Event Bus → Toast 渲染线。
 * 从 ReminderToast.vue 抽出：订阅 `catrace:event`、晚到窗口的 active 水合（getActiveEvents）、
 * seenBusEventIds 去重、同 id / 同 dedupe_key 原地刷新（不 remount 卡片）、
 * resolved 收卡（superseded 保留、sticky action 往返保留）、rest-timer 分流、
 * 其余事件走 addNotification 兜底建卡，以及 markEventResolved 上报。
 */
import { listen } from '@tauri-apps/api/event'
import { nextTick } from 'vue'
import type { Ref } from 'vue'
import { getActiveEvents, resolveEvent, resolveEventAction } from '../../../api/tauri'
import type { BusEvent } from '../../../types/event'
import { usePluginRegistry } from '../../../stores/pluginRegistry'
import {
  isBuiltinKind,
  resolveAutoHideMs,
  resolveToastStyle,
  type AddNotificationPayload,
  type ToastItem,
  type ToastKind,
} from './toastCard'
import type { RestTimerUpdatePayload } from './useRestTimerCard'

export interface ToastBusEventsDeps {
  notifications: Ref<ToastItem[]>
  /** rest-timer 事件交由休息计时卡片子系统原地更新 */
  updateRestTimer: (payload: RestTimerUpdatePayload) => void
  startTimer: (item: ToastItem) => void
  stopTimer: (item: ToastItem) => void
  addNotification: (payload: AddNotificationPayload) => void | Promise<void>
  removeNotification: (id: number, animate: boolean) => void
  scheduleWindowResize: () => void
}

export function useToastBusEvents({
  notifications,
  updateRestTimer,
  startTimer,
  stopTimer,
  addNotification,
  removeNotification,
  scheduleWindowResize,
}: ToastBusEventsDeps) {
  const pluginRegistry = usePluginRegistry()

  function isPluginKind(kind: string): boolean {
    if (isBuiltinKind(kind)) return false
    return !!pluginRegistry.getPluginForKind(kind)
  }

  /** Bus event ids already shown (or resolved) — prevent double-render with eval legacy path. */
  const seenBusEventIds = new Set<string>()

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
    const toastStyle = resolveToastStyle(p, isPluginEvent)

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
        existing.toastStyle = toastStyle
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
        existing.toastStyle = toastStyle
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
      toastStyle,
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
      autoHideMs: kind === 'notification' ? resolveAutoHideMs(event, false) : undefined,
      appName:
        kind === 'notification' && typeof p.app_name === 'string' ? p.app_name : undefined,
      iconUrl:
        kind === 'notification' && typeof p.icon_data_url === 'string'
          ? p.icon_data_url
          : undefined,
      notificationActions: kind === 'notification' ? (event.actions || []) : undefined,
      bodyClickable: kind === 'notification' && p.body_clickable === true,
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

  /** 事件 id 入册 seen（供 rest-timer 子系统原地换 id 时登记旧 id） */
  function markEventSeen(eventId: string) {
    seenBusEventIds.add(eventId)
  }

  /** 订阅 bus 事件线，返回 unlisten；必须先订阅再水合，避免漏事件 */
  async function subscribe() {
    return listen<BusEvent>('catrace:event', (ev) => {
      handleBusEvent(ev.payload)
    })
  }

  /** 晚到的 Toast 窗：拉一次 active events 补水合 */
  async function hydrateActiveEvents() {
    try {
      const active = await getActiveEvents()
      for (const e of active) handleBusEvent(e)
    } catch {
      // ignore
    }
  }

  return { subscribe, hydrateActiveEvents, markEventResolved, markEventSeen }
}
