<script setup lang="ts">
import RestTimerBall from './RestTimerBall.vue'

defineProps<{
  title: string
  body: string
  restStreak?: number
  breakMinutes?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <div class="rest-timer-toast">
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
    <div class="rest-timer-visual">
      <div class="liquid-ball">
        <RestTimerBall :rest-streak="restStreak || 0" :break-minutes="breakMinutes || 1" />
      </div>
    </div>
    <p class="body-text">{{ body }}</p>
  </div>
</template>

<style scoped>
.rest-timer-toast {
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
  background: #059669;
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
  color: #065f46;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  background: #ecfdf5;
  color: #059669;
}

.close-btn:active {
  transform: scale(0.95);
}

.rest-timer-visual {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0.375rem 0 0.5rem;
}

.liquid-ball {
  width: 5.25rem;
  height: 5.25rem;
  border-radius: 50%;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  animation: rest-ball-float 4s ease-in-out infinite;
  box-shadow: 0 0.25rem 0.75rem rgba(5, 150, 105, 0.22);
}

@keyframes rest-ball-float {
  0%,
  100% {
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

.body-text {
  font-size: 0.8125rem;
  color: #047857;
  line-height: 1.5;
  margin: 0 0 0.5rem 0;
  word-break: break-word;
  text-align: center;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>