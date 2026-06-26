<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  restStreak: number
  breakMinutes: number
}>()

const { t } = useI18n()

const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const TICK_RADIUS = 53
const TICK_CIRCUMFERENCE = 2 * Math.PI * TICK_RADIUS

const target = computed(() => Math.max(1, props.breakMinutes || 1))
const progress = computed(() => Math.min(1, Math.max(0, (props.restStreak || 0) / target.value)))
const isComplete = computed(() => progress.value >= 1)
const strokeOffset = computed(() => CIRCUMFERENCE * (1 - progress.value))

const tickCount = computed(() => Math.min(12, target.value))
const tickDasharray = computed(() => {
  const segment = TICK_CIRCUMFERENCE / tickCount.value
  return `${segment * 0.25} ${segment * 0.75}`
})
</script>

<template>
  <div
    class="rest-timer"
    :class="{ 'rest-timer--complete': isComplete }"
    role="img"
    :aria-label="t('reminder.restTimerTitle')"
  >
    <svg class="rest-timer__svg" viewBox="0 0 120 120">
      <defs>
        <linearGradient
          id="rest-progress-gradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stop-color="#22D3EE" />
          <stop offset="100%" stop-color="#059669" />
        </linearGradient>

        <filter id="rest-progress-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <!-- 背景圆 -->
      <circle
        class="rest-timer__bg"
        cx="60"
        cy="60"
        r="52"
        fill="transparent"
      />

      <!-- 分钟刻度 -->
      <circle
        class="rest-timer__ticks"
        cx="60"
        cy="60"
        :r="TICK_RADIUS"
        :stroke-dasharray="tickDasharray"
      />

      <!-- 轨道 -->
      <circle
        class="rest-timer__track"
        cx="60"
        cy="60"
        :r="RADIUS"
      />

      <!-- 进度弧 -->
      <circle
        class="rest-timer__progress"
        cx="60"
        cy="60"
        :r="RADIUS"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="strokeOffset"
      />
    </svg>

    <!-- 中心内容 -->
    <div class="rest-timer__content">
      <div class="rest-timer__number">{{ restStreak || 0 }}</div>
      <div class="rest-timer__unit">{{ t('common.minutes') }}</div>
    </div>

    <!-- 呼吸光晕 -->
    <div class="rest-timer__pulse" aria-hidden="true" />

    <!-- 灵动闪光点 -->
    <div class="rest-timer__sparkle sparkle--1" aria-hidden="true" />
    <div class="rest-timer__sparkle sparkle--2" aria-hidden="true" />
    <div class="rest-timer__sparkle sparkle--3" aria-hidden="true" />
  </div>
</template>

<style scoped>
.rest-timer {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rest-timer__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

/* 使用纯 CSS 径向渐变背景，避免 SVG 内定义重复 */
.rest-timer::before {
  content: '';
  position: absolute;
  inset: 0.25rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #F0FDF4 0%, #D1FAE5 100%);
  z-index: 0;
}

.rest-timer__ticks {
  fill: none;
  stroke: #A7F3D0;
  stroke-width: 2;
  stroke-linecap: round;
}

.rest-timer__track {
  fill: none;
  stroke: #D1FAE5;
  stroke-width: 8;
  stroke-linecap: round;
}

.rest-timer__progress {
  fill: none;
  stroke: url(#rest-progress-gradient);
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  filter: url(#rest-progress-glow);
}

.rest-timer__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.rest-timer__number {
  font-size: 1.875rem;
  font-weight: 800;
  color: #065F46;
  font-variant-numeric: tabular-nums;
  transition: transform 0.3s ease;
}

.rest-timer__unit {
  font-size: 0.625rem;
  font-weight: 600;
  color: #047857;
  margin-top: 0.125rem;
  letter-spacing: 0.02em;
}

.rest-timer__pulse {
  position: absolute;
  inset: -0.375rem;
  border-radius: 50%;
  border: 0.125rem solid rgba(5, 150, 105, 0.2);
  opacity: 0;
  animation: rest-breathe 2.8s ease-in-out infinite;
  pointer-events: none;
  z-index: 2;
}

.rest-timer__sparkle {
  position: absolute;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: radial-gradient(circle, #34D399 0%, rgba(52, 211, 153, 0) 70%);
  opacity: 0;
  pointer-events: none;
  z-index: 3;
  animation: sparkle-twinkle 2.4s ease-in-out infinite;
}

.sparkle--1 {
  top: 12%;
  right: 14%;
  animation-delay: 0s;
}

.sparkle--2 {
  bottom: 16%;
  left: 10%;
  width: 0.25rem;
  height: 0.25rem;
  animation-delay: 0.8s;
}

.sparkle--3 {
  top: 22%;
  left: 16%;
  width: 0.3rem;
  height: 0.3rem;
  animation-delay: 1.6s;
}

.rest-timer--complete .rest-timer__progress {
  stroke: #10B981;
}

.rest-timer--complete .rest-timer__pulse {
  border-color: rgba(16, 185, 129, 0.45);
  animation-duration: 1.6s;
}

.rest-timer--complete .rest-timer__number {
  animation: number-pop 0.5s ease;
}

.rest-timer--complete .rest-timer__sparkle {
  background: radial-gradient(circle, #34D399 0%, rgba(52, 211, 153, 0) 60%);
  animation-duration: 1.4s;
}

@keyframes rest-breathe {
  0%, 100% {
    transform: scale(1);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.55;
  }
}

@keyframes sparkle-twinkle {
  0%, 100% {
    transform: scale(0.4);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.9;
  }
}

@keyframes number-pop {
  0% {
    transform: scale(0.85);
  }
  60% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rest-timer__progress,
  .rest-timer__number {
    transition: none;
    animation: none;
  }

  .rest-timer__pulse,
  .rest-timer__sparkle {
    animation: none;
    opacity: 0;
  }
}
</style>
