<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import {
  getReminderData,
  snoozeReminder,
  skipReminder,
  closeReminderWindow,
  recordWater,
  snoozeWaterReminder,
  skipWaterReminder,
} from '../api/tauri'

useI18n()

type ToastKind = 'rest' | 'water'

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
  leaving?: boolean
}

const notifications = ref<ToastItem[]>([])
const cardRefs = ref<Map<number, HTMLElement>>(new Map())
const showDebug = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const stackRef = ref<HTMLElement | null>(null)
const isAnimating = ref(false)
let idCounter = 0
let resizeObserver: ResizeObserver | null = null

const AUTO_HIDE_MS = 8000
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
  showDebug.value = (window as any).__CATRACE_TOAST_DEBUG__ === true

  // 暴露全局函数给 Rust 端 eval 调用
  ;(window as any).addToastNotification = (payload: {
    kind?: ToastKind
    boundary: number
    title: string
    body: string
  }) => {
    addNotification({ kind: payload.kind || 'rest', ...payload })
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
    const pos = await win.innerPosition()
    const size = await win.innerSize()
    const sf = await win.scaleFactor()

    // 先量内容栈实际高度，再加 root 内边距得到窗口总高
    const stackHeight = stackRef.value?.getBoundingClientRect().height ?? calcWindowHeight(count)
    const maxWindowHeight = window.screen.availHeight || window.innerHeight
    const newHeightLogical = Math.min(maxWindowHeight, stackHeight + PADDING * 2)
    const workAreaBottomLogical = pos.y / sf + size.height / sf
    const newYLogical = workAreaBottomLogical - newHeightLogical

    debugInfo.value = {
      ...debugInfo.value,
      count,
      calcHeight: newHeightLogical,
      beforeSize: { width: size.width, height: size.height },
      beforePos: { x: pos.x, y: pos.y },
      sf,
      error: '',
    }

    await win.setSize(new LogicalSize(WINDOW_WIDTH, newHeightLogical))
    await win.setPosition(new LogicalPosition(pos.x / sf, newYLogical))

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

async function addNotification(payload: { kind: ToastKind; boundary: number; title: string; body: string }) {
  // 限制最大数量，移除最旧的通知（不带动画，避免和进入动画打架）
  while (notifications.value.length >= MAX_NOTIFICATIONS) {
    removeNotification(notifications.value[0].id, false)
  }

  const id = ++idCounter
  const item: ToastItem = {
    id,
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    boundary: payload.boundary,
    visible: false,
    isHovered: false,
    remainingMs: AUTO_HIDE_MS,
    closeTimer: null,
    lastStartAt: 0,
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

  startTimer(item)
  await adjustWindowSize()
}

function startTimer(item: ToastItem) {
  stopTimer(item)
  item.lastStartAt = Date.now()
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
  item.isHovered = true
  stopTimer(item)
}

function handleMouseLeave(item: ToastItem) {
  item.isHovered = false
  if (item.remainingMs > 0) {
    startTimer(item)
  } else {
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
</script>

<template>
  <div ref="rootRef" class="toast-root" :class="{ 'debug-bg': showDebug }">
    <div ref="stackRef" class="toast-stack">
      <div
        v-for="item in notifications"
        :key="item.id"
        :ref="(el) => setCardRef(el, item.id)"
        class="toast-card"
        :class="{ visible: item.visible, 'toast-card-water': item.kind === 'water' }"
        @mouseenter="handleMouseEnter(item)"
        @mouseleave="handleMouseLeave(item)"
      >
        <!-- Header -->
        <div class="header">
          <div class="header-left">
            <div class="pulse-dot" />
            <h2 class="title">{{ item.title }}</h2>
          </div>
          <button class="close-btn" @click="removeNotification(item.id, true)" aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- Progress bar -->
        <div class="progress-bar" :class="{ paused: item.isHovered }" />

        <!-- Body -->
        <p class="body-text">{{ item.body }}</p>

        <!-- Actions -->
        <div v-if="item.kind === 'rest'" class="actions">
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
        <div v-else class="actions">
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
  padding: 20px;
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
  gap: 12px;
  width: 100%;
}

.toast-root.debug-bg {
  background: rgba(255, 0, 0, 0.5);
}

.toast-card {
  width: 320px;
  min-height: 180px;
  max-height: 600px;
  background: #ffffff;
  border-radius: 12px;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
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

.debug-panel {
  position: fixed;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: #0f0;
  font-family: monospace;
  font-size: 11px;
  padding: 8px;
  border-radius: 4px;
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
  margin-bottom: 6px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.pulse-dot {
  width: 10px;
  height: 10px;
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
  font-size: 16px;
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
  height: 3px;
  background: linear-gradient(90deg, #7C3AED, #A78BFA);
  border-radius: 2px;
  margin: 10px 0 12px;
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
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #9C8DB5;
  cursor: pointer;
  border-radius: 8px;
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
  font-size: 14px;
  color: #6B5B8A;
  line-height: 1.6;
  margin: 0 0 14px 0;
  word-break: break-word;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* Actions */
.actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.btn {
  flex: 1;
  height: 36px;
  border-radius: 10px;
  font-size: 13px;
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
