import { dismissRestTimer, getActivitySnapshot } from '../../../api/tauri'
import type { ToastItem } from './toastCard'
import { createFrameQueue, type ToastItems, type Translate } from './toastState'

export interface RestTimerUpdatePayload {
  break_minutes: number
  rest_start_ts: number
  rest_streak: number
  remaining_minutes: number
  is_complete: boolean
  title?: string
  body?: string
  eventId?: string
  dedupeKey?: string
}

export function createRestTimerCard({ items, nextId, t, scheduleWindowResize, removeNotification,
  markEventResolved, markEventSeen }: {
  items: ToastItems
  nextId: () => number
  t: Translate
  scheduleWindowResize: () => void
  removeNotification: (id: number, animate: boolean) => void
  markEventResolved: (eventId: string | undefined, actionId?: string) => void
  markEventSeen: (eventId: string) => void
}) {
  const frames = createFrameQueue()
  let interval: ReturnType<typeof setInterval> | null = null
  let baseline = 0
  let generation = 0
  let disposed = false
  let polling = false

  function stopRestPoll() {
    ++generation
    if (interval) clearInterval(interval)
    interval = null
  }

  function scheduleRemoveRestTimer() {
    const existing = items.current.find((item) => item.kind === 'rest-timer' && !item.leaving)
    if (!existing) return
    if (existing.endTimer) clearTimeout(existing.endTimer)
    existing.endTimer = setTimeout(() => {
      existing.endTimer = null
      if (disposed || !items.current.includes(existing) || existing.leaving) return
      void dismissRestTimer().catch(() => {})
      markEventResolved(existing.eventId)
      removeNotification(existing.id, true)
    }, 4000)
  }

  async function pollActivity(token: number) {
    if (polling || disposed || token !== generation) return
    if (!items.current.some((item) => item.kind === 'rest-timer' && !item.leaving)) {
      stopRestPoll()
      return
    }
    polling = true
    try {
      const snapshot = await getActivitySnapshot()
      if (disposed || token !== generation) return
      // Fullscreen reminder time is rest even when keyboard/media activity is present.
      if (snapshot.fullscreen_active) { baseline = snapshot.count; return }
      // Backend resets count at the minute boundary; only an increase means activity.
      const keyMouseActive = snapshot.count > baseline
      baseline = snapshot.count
      if (keyMouseActive || snapshot.media_active) {
        stopRestPoll()
        scheduleRemoveRestTimer()
      }
    } catch { /* Keep polling when a snapshot temporarily fails. */ }
    finally { polling = false }
  }

  async function startRestPoll() {
    stopRestPoll()
    const token = generation
    try {
      const snapshot = await getActivitySnapshot()
      if (disposed || token !== generation) return
      baseline = snapshot.count
    } catch {
      if (disposed || token !== generation) return
      baseline = 0
    }
    interval = setInterval(() => { void pollActivity(token) }, 2000)
  }

  function updateRestTimer(payload: RestTimerUpdatePayload) {
    if (disposed) return
    const existing = items.current.find((item) => item.kind === 'rest-timer' && !item.leaving)
    if (existing?.endTimer) { clearTimeout(existing.endTimer); existing.endTimer = null }
    const title = payload.title || t(payload.is_complete ? 'reminder.restTimerDone' : 'reminder.restTimerTitle')
    const body = payload.body || (payload.is_complete
      ? t('reminder.restTimerDoneBody', { n: payload.rest_streak })
      : t('reminder.restTimerBody', { n: payload.rest_streak, m: payload.remaining_minutes }))

    if (existing) {
      if (existing.eventId && payload.eventId && existing.eventId !== payload.eventId) markEventSeen(existing.eventId)
      Object.assign(existing, {
        eventId: payload.eventId ?? existing.eventId,
        dedupeKey: payload.dedupeKey ?? existing.dedupeKey,
        title, body, restStreak: payload.rest_streak, breakMinutes: payload.break_minutes,
        restStartTs: payload.rest_start_ts, isComplete: payload.is_complete, visible: true,
      })
      items.changed()
    } else {
      const item: ToastItem = {
        id: nextId(), kind: 'rest-timer', title, body, boundary: 0,
        visible: false, isHovered: false, remainingMs: 0, closeTimer: null,
        lastStartAt: 0, totalMs: 0, breakMinutes: payload.break_minutes,
        restStartTs: payload.rest_start_ts, restStreak: payload.rest_streak,
        isComplete: payload.is_complete, eventId: payload.eventId,
        dedupeKey: payload.dedupeKey ?? 'reminder.rest.timer',
      }
      items.current = [...items.current, item]
      frames.request(() => {
        if (items.current.includes(item) && !item.leaving) { item.visible = true; items.changed() }
      })
    }
    void startRestPoll()
    scheduleWindowResize()
  }

  return {
    updateRestTimer,
    stopRestPoll,
    dispose() {
      disposed = true
      stopRestPoll()
      frames.dispose()
      for (const item of items.current) {
        if (item.kind === 'rest-timer' && item.endTimer) { clearTimeout(item.endTimer); item.endTimer = null }
      }
    },
  }
}
