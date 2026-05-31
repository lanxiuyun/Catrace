<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  getReminderData,
  snoozeReminder,
  skipReminder,
} from '../api/tauri'

const { t } = useI18n()

const title = ref('')
const body = ref('')
const boundary = ref(0)
const breakMinutes = ref(5)
const bgImage = ref('')
const opacity = ref(80)
const fitMode = ref('contain')

const remainingSeconds = ref(0)
let timerId: ReturnType<typeof setInterval> | null = null

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function loadData() {
  try {
    const data = await getReminderData('reminder-fullscreen')
    if (data) {
      title.value = data.title
      body.value = data.body
      boundary.value = data.boundary
      breakMinutes.value = data.break_minutes || 5
      bgImage.value = data.fullscreen_bg ?? ''
      opacity.value = data.fullscreen_opacity ?? 80
      fitMode.value = data.fullscreen_fit_mode ?? 'contain'
      remainingSeconds.value = breakMinutes.value * 60
    }
  } catch (e) {
    console.error('[FS] loadData error:', e)
  }
}

function onHashChange() {
  loadData()
}

onMounted(async () => {
  await loadData()

  remainingSeconds.value = breakMinutes.value * 60
  timerId = setInterval(() => {
    if (remainingSeconds.value > 0) {
      remainingSeconds.value -= 1
    }
  }, 1000)

  // 窗口复用时，hash 变化会触发重新加载数据
  window.addEventListener('hashchange', onHashChange)
})

onUnmounted(() => {
  if (timerId) clearInterval(timerId)
  window.removeEventListener('hashchange', onHashChange)
})

async function handleSnooze(minutes: number) {
  try {
    await snoozeReminder(minutes)
  } catch (e) {
    console.error(e)
  }
  await getCurrentWebviewWindow().close()
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
  <div class="fullscreen-root">
    <!-- 底层：模糊放大铺满 -->
    <div
      v-if="bgImage"
      class="fullscreen-bg"
      :style="{ backgroundImage: `url(${bgImage})`, opacity: opacity / 100 }"
    />
    <!-- 上层：清晰原图，按用户选择的填充模式显示 -->
    <div
      v-if="bgImage"
      class="fullscreen-sharp"
      :style="{ backgroundImage: `url(${bgImage})`, backgroundSize: fitMode === 'fill' ? '100% 100%' : fitMode, opacity: opacity / 100 }"
    />
    <div class="content">
      <div class="pulse-ring">
        <div class="pulse-dot" />
      </div>
      <h1 class="title">{{ title }}</h1>
      <p class="subtitle">{{ body }}</p>

      <div class="countdown">
        <div class="countdown-label">{{ t('reminder.countdown') }}</div>
        <div class="countdown-time">
          {{ formatTime(remainingSeconds) }}
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-secondary" @click="handleSnooze(5)">
          {{ t('reminder.snooze5') }}
        </button>
        <button class="btn btn-secondary" @click="handleSnooze(10)">
          {{ t('reminder.snooze10') }}
        </button>
        <button class="btn btn-primary" @click="handleSkip">
          {{ t('reminder.skip') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fullscreen-root {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.fullscreen-bg {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  filter: blur(40px) saturate(1.2);
  transform: scale(1.05);
}

.fullscreen-sharp {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-position: center;
}

.content {
  position: relative;
  z-index: 1;
  text-align: center;
  color: #ffffff;
  max-width: 640px;
  padding: 40px;
}

.pulse-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
}

.pulse-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #EF4444;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); }
  50% { opacity: 0.7; transform: scale(1.2); box-shadow: 0 0 0 16px rgba(239, 68, 68, 0); }
}

.title {
  font-size: 42px;
  font-weight: 800;
  margin: 0 0 12px 0;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.subtitle {
  font-size: 18px;
  margin: 0 0 40px 0;
  opacity: 0.9;
  line-height: 1.5;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
}

.countdown {
  margin-bottom: 40px;
}

.countdown-label {
  font-size: 14px;
  opacity: 0.7;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.countdown-time {
  font-size: 80px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -2px;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.3);
  line-height: 1;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn {
  padding: 12px 28px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  backdrop-filter: blur(8px);
}
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.25);
}

.btn-primary {
  background: #7C3AED;
  color: #ffffff;
}
.btn-primary:hover {
  background: #6D28D9;
}
</style>
