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

const title = ref('')
const body = ref('')
const boundary = ref(0)
const isHovered = ref(false)
const visible = ref(false)
const AUTO_HIDE_MS = 8000

let closeTimer: ReturnType<typeof setTimeout> | null = null
let remainingMs = AUTO_HIDE_MS
let lastStartAt = 0

onMounted(async () => {
  console.log('[ReminderToast] onMounted')
  try {
    const data = await getReminderData('reminder-toast')
    console.log('[ReminderToast] getReminderData result:', data)
    if (data) {
      title.value = data.title
      body.value = data.body
      boundary.value = data.boundary
      requestAnimationFrame(() => {
        visible.value = true
      })
      startTimer()
    }
  } catch (e) {
    console.error('[ReminderToast] getReminderData error:', e)
  }
})

onUnmounted(() => {
  stopTimer()
})

function startTimer() {
  stopTimer()
  lastStartAt = Date.now()
  closeTimer = setTimeout(() => {
    handleClose()
  }, remainingMs)
}

function stopTimer() {
  if (closeTimer) {
    const elapsed = Date.now() - lastStartAt
    remainingMs = Math.max(0, remainingMs - elapsed)
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

function handleMouseEnter() {
  isHovered.value = true
  stopTimer()
}

function handleMouseLeave() {
  isHovered.value = false
  if (remainingMs > 0) {
    startTimer()
  } else {
    handleClose()
  }
}

async function handleClose() {
  visible.value = false
  stopTimer()
  setTimeout(async () => {
    try {
      await closeReminderWindow('reminder-toast')
    } catch (e) {
      console.error('[Toast] closeReminderWindow failed:', e)
      try {
        await getCurrentWebviewWindow().close()
      } catch (e2) {
        console.error('[Toast] getCurrentWebviewWindow().close() failed:', e2)
      }
    }
  }, 250)
}

async function handleSnooze(minutes: number) {
  stopTimer()
  try {
    await snoozeReminder(minutes)
  } catch (e) {
    console.error(e)
  }
  await handleClose()
}

async function handleSkip() {
  stopTimer()
  try {
    await skipReminder(boundary.value)
  } catch (e) {
    console.error(e)
  }
  await handleClose()
}
</script>

<template>
  <div class="toast-root">
    <div
      class="toast-card"
      :class="{ visible: visible, hidden: !visible }"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <div class="pulse-dot" />
          <h2 class="title">{{ title }}</h2>
        </div>
        <button class="close-btn" @click="handleClose" aria-label="关闭">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <!-- Progress bar -->
      <div class="progress-bar" :class="{ paused: isHovered }" />

      <!-- Body -->
      <p class="body-text">{{ body }}</p>

      <!-- Actions -->
      <div class="actions">
        <button class="btn btn-secondary" @click="handleSnooze(5)">
          {{ $t('reminder.snooze5') }}
        </button>
        <button class="btn btn-secondary" @click="handleSnooze(10)">
          {{ $t('reminder.snooze10') }}
        </button>
        <button class="btn btn-primary" @click="handleSkip">
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
