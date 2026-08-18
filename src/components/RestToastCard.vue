<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  title: string
  body: string
  isHovered?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'snooze', minutes: number): void
  (e: 'skip'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="rest-toast">
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot" />
        <h2 class="title">{{ title }}</h2>
      </div>
      <button class="close-btn" aria-label="关闭" @click="emit('close')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <div class="progress-bar" :class="{ paused: isHovered }" />
    <p class="body-text">{{ body }}</p>
    <div class="actions">
      <button class="btn btn-secondary" @click="emit('snooze', 5)">{{ t('reminder.snooze5') }}</button>
      <button class="btn btn-secondary" @click="emit('snooze', 10)">{{ t('reminder.snooze10') }}</button>
      <button class="btn btn-primary" @click="emit('skip')">{{ t('reminder.skip') }}</button>
    </div>
  </div>
</template>

<style scoped>
.rest-toast {
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
  gap: 0.5rem;
  min-width: 0;
}

.pulse-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.3);
  }
}

.title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #2e1065;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-bar {
  width: 100%;
  height: 0.125rem;
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
  border-radius: 0.0625rem;
  margin: 0.375rem 0 0.5rem;
  animation: progress-shrink var(--toast-auto-hide-ms, 8000ms) linear forwards;
}

.progress-bar.paused {
  animation-play-state: paused;
}

@keyframes progress-shrink {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

.close-btn {
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #9c8db5;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: #f5f3ff;
  color: #7c3aed;
}

.close-btn:active {
  transform: scale(0.95);
}

.body-text {
  font-size: 0.8125rem;
  color: #6b5b8a;
  line-height: 1.5;
  margin: 0 0 0.625rem 0;
  word-break: break-word;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.actions {
  display: flex;
  gap: 0.375rem;
  margin-top: auto;
}

.btn {
  flex: 1;
  height: 1.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
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
  background: #f8f7fb;
  color: #7c3aed;
}

.btn-secondary:hover {
  background: #ede9fe;
}

.btn-primary {
  background: #7c3aed;
  color: #ffffff;
}

.btn-primary:hover {
  background: #6d28d9;
}

.btn:active {
  transform: scale(0.97);
}
</style>