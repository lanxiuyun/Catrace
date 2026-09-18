<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import {
  getReminderData,
  snoozeReminder,
  skipReminder,
  setWindowActiveMode,
  closeReminderWindow,
} from '../../api/tauri'

useI18n()

const title = ref('')
const body = ref('')
const boundary = ref(0)
const customMinutes = ref(15)
const showCustomInput = ref(false)
const cardRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

const POPUP_WIDTH = 440
const POPUP_MIN_HEIGHT = 300
const WINDOW_LABEL = 'reminder-popup'

onMounted(async () => {
  try {
    const data = await getReminderData('reminder-popup')
    if (data) {
      title.value = data.title
      body.value = data.body
      boundary.value = data.boundary
    }
  } catch (e) {
    console.error(e)
  }

  await nextTick()
  if (cardRef.value) {
    resizeObserver = new ResizeObserver(() => {
      adjustWindowSize()
    })
    resizeObserver.observe(cardRef.value)
  }

})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch([title, body, showCustomInput], () => {
  adjustWindowSize()
})

async function adjustWindowSize() {
  await nextTick()
  if (!cardRef.value) return

  try {
    const win = getCurrentWebviewWindow()
    const pos = await win.outerPosition()
    const size = await win.outerSize()
    const sf = await win.scaleFactor()

    const cardHeight = cardRef.value.getBoundingClientRect().height
    const newHeight = Math.min(600, Math.max(POPUP_MIN_HEIGHT, Math.round(cardHeight)))

    // 保持窗口中心点不变，避免长高后重心下移
    const centerX = pos.x / sf + size.width / sf / 2
    const centerY = pos.y / sf + size.height / sf / 2
    const newX = centerX - POPUP_WIDTH / 2
    const newY = centerY - newHeight / 2

    await win.setSize(new LogicalSize(POPUP_WIDTH, newHeight))
    await win.setPosition(new LogicalPosition(newX, newY))
  } catch (e) {
    console.error(e)
  }
}

async function handleClose() {
  await closeReminderWindow(WINDOW_LABEL)
}

async function handleSnooze(minutes: number) {
  try {
    await snoozeReminder(minutes)
  } catch (e) {
    console.error(e)
  }
  await getCurrentWebviewWindow().close()
}

async function handleCustomSnooze() {
  const minutes = Math.max(1, Math.round(customMinutes.value))
  await handleSnooze(minutes)
}

async function toggleCustomInput() {
  showCustomInput.value = !showCustomInput.value
  try {
    await setWindowActiveMode(WINDOW_LABEL, showCustomInput.value)
  } catch (e) {
    console.error(e)
  }
}

async function handleSkip() {
  try {
    await skipReminder(boundary.value)
  } catch (e) {
    console.error(e)
  }
  await getCurrentWebviewWindow().close()
}
</script>

<template>
  <div class="popup-root">
    <div ref="cardRef" class="popup-card">
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

      <!-- Body -->
      <p class="body-text">{{ body }}</p>

      <!-- Snooze Options -->
      <div class="snooze-grid">
        <button class="pill" @click="handleSnooze(5)">5 分钟</button>
        <button class="pill" @click="handleSnooze(10)">10 分钟</button>
        <button class="pill" @click="handleSnooze(15)">15 分钟</button>
        <button class="pill" @click="handleSnooze(30)">30 分钟</button>
        <button
          class="pill"
          :class="{ 'pill-active': showCustomInput }"
          @click="toggleCustomInput"
        >
          自定义
        </button>
      </div>

      <!-- Custom Input -->
      <div v-if="showCustomInput" class="custom-row">
        <input
          v-model.number="customMinutes"
          type="number"
          min="1"
          max="120"
          class="custom-input"
          placeholder="分钟"
          @keyup.enter="handleCustomSnooze"
        />
        <button class="btn btn-primary btn-small" @click="handleCustomSnooze">确定</button>
      </div>

      <!-- Skip -->
      <button class="btn btn-skip" @click="handleSkip">跳过本次</button>
    </div>
  </div>
</template>

<style scoped>
.popup-root {
  width: 100vw;
  height: 100vh;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
}

.popup-card {
  width: 100%;
  min-height: 100vh;
  max-height: 37.5rem;
  background: var(--ct-surface);
  border-radius: 1rem;
  padding: 1rem 1.25rem 0.875rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 0.0625rem 0.125rem rgba(0,0,0,0.02),
    0 0.5rem 1rem rgba(0,0,0,0.04),
    0 1rem 2rem rgba(0,0,0,0.06),
    0 2rem 4rem rgba(0,0,0,0.08);
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
}

.pulse-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background: var(--ct-error);
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
  color: var(--ct-text);
  margin: 0;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--ct-text-subtle);
  cursor: pointer;
  border-radius: 0.5rem;
  padding: 0;
  transition: all 0.2s ease;
}
.close-btn:hover {
  background: var(--ct-accent-softer);
  color: var(--ct-accent);
}
.close-btn:active {
  transform: scale(0.95);
}

/* Body */
.body-text {
  font-size: 0.875rem;
  color: var(--ct-text-muted);
  line-height: 1.6;
  margin: 0 0 1rem 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* Snooze Grid */
.snooze-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.pill {
  height: 2rem;
  border-radius: 0.625rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: var(--ct-surface-2);
  color: var(--ct-accent);
  transition: all 0.2s ease;
}
.pill:hover {
  background: var(--ct-accent-soft);
}
.pill:active {
  transform: scale(0.96);
}

.pill-active {
  background: var(--ct-accent);
  color: var(--ct-on-accent);
}

/* Custom Row */
.custom-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(0.25rem); }
  to { opacity: 1; transform: translateY(0); }
}

.custom-input {
  flex: 1;
  height: 2.25rem;
  border: 0.0938rem solid var(--ct-accent-soft);
  border-radius: 0.625rem;
  padding: 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ct-text);
  outline: none;
  background: var(--ct-bg);
  transition: all 0.2s ease;
}
.custom-input:focus {
  border-color: var(--ct-accent);
  background: var(--ct-surface);
  box-shadow: 0 0 0 0.1875rem rgba(124,58,237,0.08);
}
.custom-input::-webkit-outer-spin-button,
.custom-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Buttons */
.btn {
  height: 2.25rem;
  border-radius: 0.625rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-primary {
  background: var(--ct-accent);
  color: var(--ct-on-accent);
  padding: 0 1.25rem;
}
.btn-primary:hover {
  background: var(--ct-accent-hover);
}
.btn-primary:active {
  transform: scale(0.97);
}

.btn-small {
  height: 2.25rem;
  padding: 0 1rem;
  font-size: 0.8125rem;
}

.btn-skip {
  width: 100%;
  margin-top: auto;
  background: transparent;
  color: var(--ct-text-muted);
  border: 0.0938rem solid var(--ct-accent-soft);
}
.btn-skip:hover {
  background: var(--ct-bg);
  border-color: var(--ct-accent-soft);
  color: var(--ct-accent);
}
.btn-skip:active {
  transform: scale(0.98);
}
</style>
