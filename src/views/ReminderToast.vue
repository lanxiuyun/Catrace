<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  getReminderData,
  snoozeReminder,
  skipReminder,
  closeReminderWindow,
} from '../api/tauri'

useI18n()

interface ToastItem {
  id: number
  title: string
  body: string
  boundary: number
  visible: boolean
  isHovered: boolean
  remainingMs: number
  closeTimer: ReturnType<typeof setTimeout> | null
  lastStartAt: number
}

const notifications = ref<ToastItem[]>([])
let idCounter = 0

const AUTO_HIDE_MS = 8000
const MAX_NOTIFICATIONS = 5

onMounted(async () => {
  // 暴露全局函数给 Rust 端 eval 调用
  ;(window as any).addToastNotification = (payload: {
    boundary: number
    title: string
    body: string
  }) => {
    addNotification(payload)
  }

  // 读取初始通知
  try {
    const data = await getReminderData('reminder-toast')
    if (data) {
      addNotification({
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
})

function addNotification(payload: { boundary: number; title: string; body: string }) {
  // 限制最大数量，移除最旧的通知
  while (notifications.value.length >= MAX_NOTIFICATIONS) {
    removeNotification(notifications.value[0].id, false)
  }

  const id = ++idCounter
  const item: ToastItem = {
    id,
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

function removeNotification(id: number, animate: boolean) {
  const index = notifications.value.findIndex((n) => n.id === id)
  if (index === -1) return

  const item = notifications.value[index]
  stopTimer(item)

  if (animate) {
    item.visible = false
    setTimeout(() => {
      notifications.value = notifications.value.filter((n) => n.id !== id)
      if (notifications.value.length === 0) {
        closeWindow()
      }
    }, 250)
  } else {
    notifications.value = notifications.value.filter((n) => n.id !== id)
    if (notifications.value.length === 0) {
      closeWindow()
    }
  }
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
</script>

<template>
  <div class="toast-root">
    <div
      v-for="item in notifications"
      :key="item.id"
      class="toast-card"
      :class="{ visible: item.visible, hidden: !item.visible }"
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
      <div class="actions">
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
    </div>
  </div>
</template>

<style scoped>
.toast-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-end;
  gap: 12px;
  padding: 20px;
  box-sizing: border-box;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
  overflow: hidden;
}

.toast-card {
  width: 320px;
  min-height: 180px;
  background: #ffffff;
  border-radius: 12px;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 1px 2px rgba(0,0,0,0.02),
    0 8px 16px rgba(0,0,0,0.04),
    0 16px 32px rgba(0,0,0,0.06),
    0 32px 64px rgba(0,0,0,0.08);
  transform: translateX(120%);
  opacity: 0;
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
  flex-shrink: 0;
}

.toast-card.visible {
  transform: translateX(0);
  opacity: 1;
}

.toast-card.hidden {
  transform: translateX(120%);
  opacity: 0;
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
  animation: progress-shrink 8s linear forwards;
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

.btn:active {
  transform: scale(0.97);
}
</style>
