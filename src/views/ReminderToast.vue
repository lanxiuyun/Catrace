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
} from '../api/tauri'
import RestTimerBall from '../components/RestTimerBall.vue'
import EyeToastCard from '../components/EyeToastCard.vue'

const { t } = useI18n()

type ToastKind = 'rest' | 'water' | 'eye' | 'update' | 'rest-timer'

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
  // rest timer fields
  breakMinutes?: number
  restStartTs?: number
  restStreak?: number
  isComplete?: boolean
  endTimer?: ReturnType<typeof setTimeout> | null
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
let unlistenRestTimer: (() => void) | null = null

// 休息计时卡片：每 2 秒轮询活跃，活跃即隐藏
let restPollTimer: ReturnType<typeof setInterval> | null = null
let restPollBaseline = 0
const REST_POLL_MS = 2000
// 文档声明恢复活跃后延迟 4 秒移除
const REST_TIMER_REMOVE_DELAY_MS = 4000

const AUTO_HIDE_MS = 8000
const EYE_AUTO_HIDE_MS = 25000
const MAX_NOTIFICATIONS = 5
const CARD_HEIGHT = 180
const CARD_GAP = 12
const PADDING = 20
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

  // 监听休息计时事件
  unlistenRestTimer = await listen<{
    break_minutes: number
    rest_start_ts: number
    rest_streak: number
    remaining_minutes: number
    is_complete: boolean
  }>('catrace-rest-timer', (event) => {
    updateRestTimer(event.payload)
  })

  // 暴露全局函数给 Rust 端 eval 调用
  ;(window as any).addToastNotification = (payload: {
    kind?: ToastKind
    boundary?: number
    title?: string
    body?: string
    version?: string
    updateBody?: string
  }) => {
    addNotification({
      kind: payload.kind || 'rest',
      boundary: payload.boundary ?? 0,
      title: payload.title || '',
      body: payload.body || '',
      version: payload.version,
      updateBody: payload.updateBody,
    })
  }

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
  delete (window as any).addToastNotification
  unlistenDebug?.()
  unlistenDebug = null
  unlistenRestTimer?.()
  unlistenRestTimer = null
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

async function adjustWindowSize() {
  if (isAnimating.value) return

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

    // 量内容栈总高度（含被 max-height 隐藏的溢出部分），再加 root 内边距得到窗口总高
    const stackHeight = stackRef.value?.scrollHeight ?? calcWindowHeight(count)
    // 窗口高度不超过工作区高度，避免超出屏幕
    const newHeightLogical = Math.min(workAreaHeight, stackHeight + PADDING * 2)
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
  } catch (e: any) {
    debugInfo.value.error = String(e?.message ?? e)
  }
}

function updateRestTimer(payload: {
  break_minutes: number
  rest_start_ts: number
  rest_streak: number
  remaining_minutes: number
  is_complete: boolean
}) {
  // 取消已有的延迟关闭定时器（如果用户在延迟期间恢复休息）
  const existing = notifications.value.find((n) => n.kind === 'rest-timer')
  if (existing?.endTimer) {
    clearTimeout(existing.endTimer)
    existing.endTimer = null
  }

  const title = payload.is_complete
    ? t('reminder.restTimerDone')
    : t('reminder.restTimerTitle')
  const body = payload.is_complete
    ? t('reminder.restTimerDoneBody', { n: payload.rest_streak })
    : t('reminder.restTimerBody', {
        n: payload.rest_streak,
        m: payload.remaining_minutes,
      })

  if (existing) {
    existing.title = title
    existing.body = body
    existing.restStreak = payload.rest_streak
    existing.breakMinutes = payload.break_minutes
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
    if (item) {
      removeNotification(item.id, true)
    }
  }, REST_TIMER_REMOVE_DELAY_MS)
}

async function addNotification(payload: {
  kind: ToastKind
  boundary?: number
  title?: string
  body?: string
  version?: string
  updateBody?: string
}) {
  // 限制最大数量，移除最旧的通知（不带动画，避免和进入动画打架）
  while (notifications.value.length >= MAX_NOTIFICATIONS) {
    removeNotification(notifications.value[0].id, false)
  }

  const id = ++idCounter
  const isUpdate = payload.kind === 'update'
  const autoHideMs = payload.kind === 'eye' ? EYE_AUTO_HIDE_MS : AUTO_HIDE_MS
  const item: ToastItem = {
    id,
    kind: payload.kind,
    title: payload.title || '',
    body: payload.body || '',
    boundary: payload.boundary ?? 0,
    visible: false,
    isHovered: false,
    remainingMs: isUpdate ? 0 : autoHideMs,
    closeTimer: null,
    lastStartAt: 0,
    version: payload.version || '',
    updateBody: payload.updateBody || '',
    showUpdateBody: false,
    updateInstalling: false,
    downloadProgress: 0,
    downloadTotal: 0,
    downloadReceived: 0,
    totalMs: autoHideMs,
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

  if (!isUpdate) {
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
  // 护眼提醒 hover 不暂停倒计时；休息计时卡片不依赖 hover 控制生命周期
  if (item.kind === 'eye' || item.kind === 'rest-timer') return
  item.isHovered = true
  stopTimer(item)
}

function handleMouseLeave(item: ToastItem) {
  if (item.kind === 'eye' || item.kind === 'rest-timer') return
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
  removeNotification(item.id, true)
}

async function handleSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipReminder(item.boundary)
  } catch {
    // ignore
  }
  removeNotification(item.id, true)
}

async function handleDrinkWater(item: ToastItem) {
  stopTimer(item)
  try {
    await recordWater(Math.floor(Date.now() / 1000))
  } catch {
    // ignore
  }
  removeNotification(item.id, true)
}

async function handleWaterSnooze(item: ToastItem, minutes: number) {
  stopTimer(item)
  try {
    await snoozeWaterReminder(minutes)
  } catch {
    // ignore
  }
  removeNotification(item.id, true)
}

async function handleWaterSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipWaterReminder()
  } catch {
    // ignore
  }
  removeNotification(item.id, true)
}

async function handleEyeSnooze(item: ToastItem, minutes: number) {
  stopTimer(item)
  try {
    await snoozeEyeReminder(minutes)
  } catch {
    // ignore
  }
  removeNotification(item.id, true)
}

async function handleEyeSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipEyeReminder()
  } catch {
    // ignore
  }
  removeNotification(item.id, true)
}

function toggleUpdateDetails(item: ToastItem) {
  item.showUpdateBody = !item.showUpdateBody
  nextTick(() => adjustWindowSize())
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
  removeNotification(item.id, true)
}

async function handleUpdateInstall(item: ToastItem) {
  if (item.updateInstalling) return
  item.updateInstalling = true
  try {
    const update = await check({
      headers: { 'X-AccessKey': '9SzxzOb3pQgkOB-LU-QU1Q' },
    })
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

        <!-- Header -->
        <div v-if="item.kind !== 'eye'" class="header">
          <div class="header-left">
            <div class="pulse-dot" />
            <h2 v-if="item.kind === 'update'" class="title">
              {{ $t('settings.update.newVersion', { version: item.version }) }}
            </h2>
            <h2 v-else class="title">{{ item.title }}</h2>
          </div>
          <button
            v-if="!(item.kind === 'update' && item.updateInstalling)"
            class="close-btn"
            @click="handleClose(item)"
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- Progress bar (auto-hide timer, not shown for update / rest-timer cards) -->
        <div
          v-if="item.kind !== 'eye' && item.kind !== 'update' && item.kind !== 'rest-timer'"
          class="progress-bar"
          :class="{ paused: item.isHovered }"
        />

        <!-- Rest timer liquid ball -->
        <div v-if="item.kind === 'rest-timer'" class="rest-timer-visual">
          <div class="liquid-ball">
            <RestTimerBall
              :rest-streak="item.restStreak || 0"
              :break-minutes="item.breakMinutes || 1"
            />
          </div>
        </div>

        <!-- Body -->
        <p v-if="item.kind !== 'update' && item.kind !== 'eye'" class="body-text">{{ item.body }}</p>

        <!-- Update changelog -->
        <div
          v-if="item.kind === 'update' && item.showUpdateBody && item.updateBody"
          class="update-body"
        >
          {{ item.updateBody }}
        </div>

        <!-- Update download progress -->
        <div v-if="item.kind === 'update' && item.updateInstalling" class="update-progress">
          <div class="update-progress-track">
            <div
              class="update-progress-fill"
              :style="{ width: `${item.downloadProgress}%` }"
            />
          </div>
          <div class="update-progress-text">{{ item.downloadProgress }}%</div>
        </div>

        <!-- Actions -->
        <div v-if="item.kind === 'update'" class="actions">
          <button class="btn btn-secondary" @click="toggleUpdateDetails(item)">
            {{ item.showUpdateBody ? $t('settings.update.hideDetails') : $t('settings.update.viewDetails') }}
          </button>
          <button
            class="btn btn-primary"
            :disabled="item.updateInstalling"
            @click="handleUpdateInstall(item)"
          >
            {{ item.updateInstalling ? $t('settings.update.downloading') : $t('settings.update.updateNow') }}
          </button>
        </div>
        <div v-else-if="item.kind === 'rest'" class="actions">
          <button class="btn btn-secondary" @click="handleSnooze(item, 5)">
            {{ $t('reminder.snooze5') }}
          </button>
          <button class="btn btn-secondary" @click="handleSnooze(item, 10)">
            {{ $t('reminder.snooze10') }}
          </button>
          <button class="btn btn-primary" @click="handleSkip(item)">
            {{ $t('reminder.skip') }}
          </button>
        </div>
        <div v-else-if="item.kind === 'rest-timer'" class="actions"></div>
        <div v-else-if="item.kind === 'water'" class="actions">
          <button class="btn btn-water" @click="handleDrinkWater(item)">
            {{ $t('water.drank') }}
          </button>
          <button class="btn btn-secondary" @click="handleWaterSnooze(item, 5)">
            {{ $t('reminder.snooze5') }}
          </button>
          <button class="btn btn-primary" @click="handleWaterSkip(item)">
            {{ $t('water.skip') }}
          </button>
        </div>
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
  padding: 1.25rem;
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
  gap: 0.75rem;
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

.toast-stack::-webkit-scrollbar {
  display: none;
}

.toast-root.debug-bg {
  background: rgba(255, 220, 0, 0.45);
}

.toast-card {
  width: 20rem;
  min-height: 11.25rem;
  max-height: 37.5rem;
  background: #ffffff;
  border-radius: 0.75rem;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0.25rem 1rem rgba(0, 0, 0, 0.08);
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

/* Water reminder theming — unified with WaterWidget / Dashboard */
.toast-card-water .pulse-dot {
  background: #3B82F6;
}

.toast-card-water .progress-bar {
  background: linear-gradient(90deg, #2563EB, #60A5FA);
}

.toast-card-water .title {
  color: #1E40AF;
}

.toast-card-water .close-btn:hover {
  background: #EFF6FF;
  color: #2563EB;
}

.toast-card-water .body-text {
  color: #3B82F6;
}

.toast-card-water .btn-secondary {
  background: #EFF6FF;
  color: #2563EB;
}
.toast-card-water .btn-secondary:hover {
  background: #DBEAFE;
}

.toast-card-water .btn-primary {
  background: #2563EB;
}
.toast-card-water .btn-primary:hover {
  background: #1D4ED8;
}

/* Eye reminder: keep wrapper sizing minimal */
.toast-card-eye {
  min-height: auto;
}

/* Rest timer theming — calm wellness style */
.toast-card-rest-timer .pulse-dot {
  background: #059669;
}

.toast-card-rest-timer .title {
  color: #065F46;
}

.toast-card-rest-timer .close-btn:hover {
  background: #ECFDF5;
  color: #059669;
}

.toast-card-rest-timer .body-text {
  text-align: center;
  color: #047857;
  margin-bottom: 0.5rem;
}

.rest-timer-visual {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0.625rem 0 0.875rem;
}

.liquid-ball {
  width: 7rem;
  height: 7rem;
  border-radius: 50%;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  animation: rest-ball-float 4s ease-in-out infinite;
  box-shadow: 0 0.25rem 0.75rem rgba(5, 150, 105, 0.22);
}

@keyframes rest-ball-float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-0.375rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .liquid-ball {
    animation: none;
  }
}

/* Update reminder theming — matches reference image orange accent */
.toast-card-update .pulse-dot {
  background: #F59E0B;
}

.toast-card-update .title {
  color: #92400E;
}

.toast-card-update .close-btn:hover {
  background: #FFFBEB;
  color: #D97706;
}

.toast-card-update .body-text {
  color: #B45309;
}

.toast-card-update {
  min-height: auto;
}

.toast-card-update .btn-secondary {
  background: #FFFBEB;
  color: #D97706;
  border: 0.0625rem solid #FCD34D;
}
.toast-card-update .btn-secondary:hover {
  background: #FEF3C7;
}

.toast-card-update .btn-primary {
  background: #F59E0B;
}
.toast-card-update .btn-primary:hover {
  background: #D97706;
}

.toast-card-update .btn-primary:disabled {
  background: #FCD34D;
  cursor: not-allowed;
}

.update-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 12rem;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: #78350F;
  background: #FFFBEB;
  border-radius: 0.5rem;
  padding: 0.625rem 0.75rem;
  margin: 0 0 0.875rem 0;
}

.update-progress {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 0.875rem;
}

.update-progress-track {
  flex: 1;
  height: 0.375rem;
  background: #F3F4F6;
  border-radius: 0.25rem;
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #F59E0B, #FBBF24);
  border-radius: 0.25rem;
  transition: width 0.2s ease;
}

.update-progress-text {
  font-size: 0.75rem;
  color: #92400E;
  font-variant-numeric: tabular-nums;
  min-width: 2.5em;
  text-align: right;
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

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.375rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.pulse-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background: #EF4444;
  animation: pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

.title {
  font-size: 1rem;
  font-weight: 700;
  color: #2E1065;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Progress bar */
.progress-bar {
  width: 100%;
  height: 0.1875rem;
  background: linear-gradient(90deg, #7C3AED, #A78BFA);
  border-radius: 0.125rem;
  margin: 0.625rem 0 0.75rem;
  animation: progress-shrink var(--toast-auto-hide-ms) linear forwards;
}

.progress-bar.paused {
  animation-play-state: paused;
}

@keyframes progress-shrink {
  from { width: 100%; }
  to { width: 0%; }
}

.close-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #9C8DB5;
  cursor: pointer;
  border-radius: 0.5rem;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.close-btn:hover {
  background: #F5F3FF;
  color: #7C3AED;
}
.close-btn:active {
  transform: scale(0.95);
}

/* Body */
.body-text {
  font-size: 0.875rem;
  color: #6B5B8A;
  line-height: 1.6;
  margin: 0 0 0.875rem 0;
  word-break: break-word;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* Actions */
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}

.btn {
  flex: 1;
  height: 2.25rem;
  border-radius: 0.625rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.btn-secondary {
  background: #F8F7FB;
  color: #7C3AED;
}
.btn-secondary:hover {
  background: #EDE9FE;
}

.btn-primary {
  background: #7C3AED;
  color: #ffffff;
}
.btn-primary:hover {
  background: #6D28D9;
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-water {
  background: #3B82F6;
  color: #ffffff;
}
.btn-water:hover {
  background: #2563EB;
}

.btn:active {
  transform: scale(0.97);
}
</style>
