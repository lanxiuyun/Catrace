<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
const loading = ref(true)

onMounted(async () => {
  console.log('[ReminderPopup] mounted, type=', (window as any).__CATRACE_REMINDER_TYPE__)
  try {
    const data = await getReminderData('reminder-popup')
    console.log('[ReminderPopup] data=', data)
    if (data) {
      title.value = data.title
      body.value = data.body
      boundary.value = data.boundary
    }
  } catch (e) {
    console.error('[ReminderPopup] Failed to get reminder data', e)
  } finally {
    loading.value = false
  }
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
  <div class="popup-root">
    <div class="popup-card">
      <div class="popup-header">
        <div class="pulse-dot" />
        <h2 class="popup-title">{{ title }}</h2>
      </div>
      <p class="popup-body">{{ body }}</p>
      <div class="popup-actions">
        <button class="btn btn-secondary" @click="handleSnooze(3)">
          {{ t('reminder.snooze3') }}
        </button>
        <button class="btn btn-secondary" @click="handleSnooze(5)">
          {{ t('reminder.snooze5') }}
        </button>
        <button class="btn btn-primary" @click="handleSkip">
          {{ t('reminder.skip') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.popup-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
}

.popup-card {
  width: 100%;
  height: auto;
  background: #ffffff;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.10);
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
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

.popup-title {
  font-size: 16px;
  font-weight: 700;
  color: #2E1065;
  margin: 0;
}

.popup-body {
  font-size: 14px;
  color: #6B5B8A;
  line-height: 1.5;
  margin: 0 0 14px 0;
}

.popup-actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 8px 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-secondary {
  background: #F5F3FF;
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
</style>
