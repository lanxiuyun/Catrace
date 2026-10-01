/**
 * rest-timer（休息计时）卡片子系统。
 * 从 ReminderToast.vue 抽出：bus rest-timer 事件的原地更新（updateRestTimer）、
 * 恢复活跃轮询（每 2 秒比对 activity snapshot 基线）、恢复活跃后延迟 4 秒移除。
 */
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { dismissRestTimer, getActivitySnapshot } from '../../../api/tauri'
import type { ToastItem } from './toastCard'

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

export interface RestTimerCardDeps {
  notifications: Ref<ToastItem[]>
  nextId: () => number
  t: ReturnType<typeof useI18n>['t']
  scheduleWindowResize: () => void
  removeNotification: (id: number, animate: boolean) => void
  /** 恢复活跃移除卡片时把事件上报为 resolved，同步后端清理 */
  markEventResolved: (eventId: string | undefined, actionId?: string) => void
  /** 原地更新换 event id 后，把旧 id 入册 seen 防复活 */
  markEventSeen: (eventId: string) => void
}

export function useRestTimerCard({
  notifications,
  nextId,
  t,
  scheduleWindowResize,
  removeNotification,
  markEventResolved,
  markEventSeen,
}: RestTimerCardDeps) {
  // 休息计时卡片：每 2 秒轮询活跃，活跃即隐藏
  let restPollTimer: ReturnType<typeof setInterval> | null = null
  let restPollBaseline = 0
  const REST_POLL_MS = 2000
  // 文档声明恢复活跃后延迟 4 秒移除
  const REST_TIMER_REMOVE_DELAY_MS = 4000

  function updateRestTimer(payload: RestTimerUpdatePayload) {
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
        markEventSeen(existing.eventId)
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
      const id = nextId()
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

  return { updateRestTimer, stopRestPoll }
}
