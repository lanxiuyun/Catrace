<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  title: string
  body: string
  remainingMs: number
  lastStartAt: number
  totalMs: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'snooze', minutes: number): void
  (e: 'skip'): void
}>()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 100)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

const remaining = computed(() => {
  const elapsed = now.value - props.lastStartAt
  return Math.max(0, props.remainingMs - elapsed)
})

const progress = computed(() => {
  if (!props.totalMs) return 100
  return Math.max(0, (remaining.value / props.totalMs) * 100)
})

const countdown = computed(() => Math.max(0, Math.ceil(remaining.value / 1000)))
</script>

<template>
  <div class="eye-toast">
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot" />
        <h2 class="title">{{ title }}</h2>
      </div>
      <button class="close-btn" @click="emit('close')" aria-label="关闭">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="progress-row">
      <div class="progress-track">
        <div class="progress-bar" :style="{ width: `${progress}%` }" />
      </div>
      <span class="countdown">{{ countdown }}s</span>
    </div>
    <p class="body-text">{{ body }}</p>
    <div class="actions">
      <button class="btn btn-secondary" @click="emit('snooze', 5)">
        {{ t('reminder.snooze5') }}
      </button>
      <button class="btn btn-primary" @click="emit('skip')">
        {{ t('reminder.skip') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.eye-toast {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
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
  background: #10B981;
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
  color: #065F46;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.countdown {
  font-size: 0.75rem;
  font-weight: 600;
  color: #059669;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  margin-left: 0.5rem;
  line-height: 1;
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
  background: #ECFDF5;
  color: #059669;
}

.close-btn:active {
  transform: scale(0.95);
}

.progress-row {
  display: flex;
  align-items: center;
  margin-top: 0.375rem;
}

.progress-track {
  flex: 1;
  height: 0.1875rem;
  background: #E5F2ED;
  border-radius: 0.125rem;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #059669, #34D399);
  border-radius: 0.125rem;
}

.body-text {
  font-size: 0.875rem;
  color: #047857;
  line-height: 1.6;
  margin: 0.75rem 0 0.875rem;
  word-break: break-word;
}

.body-text {
  font-size: 0.875rem;
  color: #047857;
  line-height: 1.6;
  margin: 0.75rem 0 0.875rem;
  word-break: break-word;
}

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
  background: #ECFDF5;
  color: #059669;
}
.btn-secondary:hover {
  background: #D1FAE5;
}

.btn-primary {
  background: #059669;
  color: #ffffff;
}
.btn-primary:hover {
  background: #047857;
}

.btn:active {
  transform: scale(0.97);
}
</style>
