<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  getReminderData,
  snoozeReminder,
  skipReminder,
} from '../api/tauri'

useI18n()

const title = ref('')
const body = ref('')
const boundary = ref(0)
const customMinutes = ref(15)
const showCustomInput = ref(false)

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
})

async function handleClose() {
  await getCurrentWebviewWindow().close()
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
          @click="showCustomInput = !showCustomInput"
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
  height: 100%;
  background: #ffffff;
  border-radius: 16px;
  padding: 16px 20px 14px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 1px 2px rgba(0,0,0,0.02),
    0 8px 16px rgba(0,0,0,0.04),
    0 16px 32px rgba(0,0,0,0.06),
    0 32px 64px rgba(0,0,0,0.08);
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
  margin: 0 0 16px 0;
}

/* Snooze Grid */
.snooze-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.pill {
  height: 32px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: #F8F7FB;
  color: #7C3AED;
  transition: all 0.2s ease;
}
.pill:hover {
  background: #EDE9FE;
}
.pill:active {
  transform: scale(0.96);
}

.pill-active {
  background: #7C3AED;
  color: #ffffff;
}

/* Custom Row */
.custom-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.custom-input {
  flex: 1;
  height: 36px;
  border: 1.5px solid #E8E4F0;
  border-radius: 10px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: #2E1065;
  outline: none;
  background: #FAFAFC;
  transition: all 0.2s ease;
}
.custom-input:focus {
  border-color: #7C3AED;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(124,58,237,0.08);
}
.custom-input::-webkit-outer-spin-button,
.custom-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Buttons */
.btn {
  height: 36px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-primary {
  background: #7C3AED;
  color: #ffffff;
  padding: 0 20px;
}
.btn-primary:hover {
  background: #6D28D9;
}
.btn-primary:active {
  transform: scale(0.97);
}

.btn-small {
  height: 36px;
  padding: 0 16px;
  font-size: 13px;
}

.btn-skip {
  width: 100%;
  margin-top: auto;
  background: transparent;
  color: #8B7AAB;
  border: 1.5px solid #E8E4F0;
}
.btn-skip:hover {
  background: #FAFAFC;
  border-color: #DDD6FE;
  color: #7C3AED;
}
.btn-skip:active {
  transform: scale(0.98);
}
</style>
