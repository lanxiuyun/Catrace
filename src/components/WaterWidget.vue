<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getWaterStats, getWaterRecords, recordWater, deleteLastWater } from '../api/tauri'

const { t } = useI18n()

const count = ref(0)
const lastTs = ref<number | null>(null)
const records = ref<number[]>([])
const loading = ref(false)
const hoveredIndex = ref<number | null>(null)
const btnHovered = ref(false)
const btnRemoveHovered = ref(false)
const pulseCount = ref(false)

function fmtLast(ts: number | null): string {
  if (!ts) return t('water.lastDrank')
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return t('water.justNow')
  const minutes = Math.floor(diff / 60)
  if (minutes < 60) return t('water.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  return t('water.hoursAgo', { n: hours })
}

const lastLabel = computed(() => fmtLast(lastTs.value))

function startOfDayTs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

const dayStart = computed(() => startOfDayTs())
const nowTs = ref(Math.floor(Date.now() / 1000))

const timelineStart = computed(() => {
  if (records.value.length > 0) {
    return records.value[0]
  }
  return dayStart.value
})

const timelineEnd = computed(() => nowTs.value)

const timelineDuration = computed(() => {
  const duration = timelineEnd.value - timelineStart.value
  return Math.max(duration, 3600)
})

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getRecordPosition(ts: number): number {
  const ratio = (ts - timelineStart.value) / timelineDuration.value
  return Math.max(0, Math.min(100, ratio * 100))
}

function getNowPosition(): number {
  return getRecordPosition(nowTs.value)
}

async function load() {
  try {
    const [stats, recs] = await Promise.all([getWaterStats(), getWaterRecords()])
    count.value = stats.count
    lastTs.value = stats.last_ts
    records.value = recs.records
  } catch (e) {
    console.error('Failed to load water stats', e)
  }
}

function triggerPulse() {
  pulseCount.value = true
  setTimeout(() => {
    pulseCount.value = false
  }, 250)
}

async function addDrink() {
  loading.value = true
  try {
    await recordWater(Math.floor(Date.now() / 1000))
    await load()
    triggerPulse()
  } catch (e) {
    console.error('Failed to record water', e)
  } finally {
    loading.value = false
  }
}

async function removeDrink() {
  if (count.value === 0) return
  loading.value = true
  try {
    await deleteLastWater()
    await load()
    triggerPulse()
  } catch (e) {
    console.error('Failed to delete last water record', e)
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  load()
  timer = setInterval(load, 30000)
  nowTimer = setInterval(() => {
    nowTs.value = Math.floor(Date.now() / 1000)
  }, 30000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (nowTimer) clearInterval(nowTimer)
})
</script>

<template>
  <div class="water-widget">
    <div class="water-header">
      <div class="water-brand">
        <div class="water-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"/>
          </svg>
        </div>
        <span class="water-label">{{ t('water.todayCount') }}</span>
      </div>
      <div class="water-actions">
        <div
          class="water-btn-wrap"
          @mouseenter="btnRemoveHovered = true"
          @mouseleave="btnRemoveHovered = false"
        >
          <button
            class="water-remove"
            :disabled="loading || count === 0"
            @click="removeDrink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <transition name="btn-tooltip">
            <div v-if="btnRemoveHovered && count > 0" class="water-btn-tooltip">
              {{ t('water.remove') }}
            </div>
          </transition>
        </div>
        <div
          class="water-btn-wrap"
          @mouseenter="btnHovered = true"
          @mouseleave="btnHovered = false"
        >
          <button class="water-add" :disabled="loading" @click="addDrink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 8h1a4 4 0 0 1 0 8h-1"/>
              <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z"/>
              <path d="M6 2v3M10 2v3M14 2v3"/>
            </svg>
          </button>
          <transition name="btn-tooltip">
            <div v-if="btnHovered" class="water-btn-tooltip">
              {{ t('water.add') }}
            </div>
          </transition>
        </div>
      </div>
    </div>

    <div class="water-body">
      <span class="water-count" :class="{ 'is-pulse': pulseCount }">{{ count }}</span>
      <span class="water-unit">{{ t('water.times') }}</span>
      <span class="water-divider" />
      <span class="water-last">{{ lastLabel }}</span>
    </div>

    <div class="water-timeline">
      <div class="timeline-track">
        <div class="timeline-line" />
        <div
          class="timeline-now"
          :style="{ left: getNowPosition() + '%' }"
          :title="formatTime(nowTs)"
        />
        <div
          v-for="(ts, i) in records"
          :key="ts"
          class="timeline-drop"
          :class="{ 'is-hovered': hoveredIndex === i }"
          :style="{ left: getRecordPosition(ts) + '%', animationDelay: (i * 0.12) + 's' }"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        >
          <svg class="drop-icon" width="10" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"/>
          </svg>
          <transition name="tooltip">
            <div v-if="hoveredIndex === i" class="timeline-tooltip">
              {{ formatTime(ts) }}
            </div>
          </transition>
        </div>
      </div>
      <div v-if="records.length > 0" class="timeline-labels">
        <span>{{ formatTime(timelineStart) }}</span>
        <span>{{ t('water.now') }}</span>
      </div>
      <div v-if="records.length === 0" class="timeline-empty">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"/>
        </svg>
        <span>{{ t('water.empty') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.water-widget {
  background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
  border: 1px solid #bfdbfe;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.06);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.water-widget:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.1);
}

.water-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.water-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.water-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  color: #2563eb;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.12);
}

.water-icon svg {
  animation: float 3s ease-in-out infinite;
}

.water-label {
  font-size: 13px;
  color: #2563eb;
  font-weight: 600;
}

.water-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.water-btn-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.water-add {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 5px rgba(37, 99, 235, 0.25);
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.water-add:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  transform: translateY(-1px) scale(1.05);
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.32);
}

.water-add:active {
  transform: translateY(0) scale(0.96);
}

.water-add:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.water-remove {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid #dbeafe;
  background: #fff;
  color: #60a5fa;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.water-remove:hover {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #ef4444;
  transform: translateY(-1px);
}

.water-remove:active {
  transform: translateY(0) scale(0.96);
}

.water-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.water-btn-tooltip {
  position: absolute;
  top: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #bfdbfe;
  color: #2563eb;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.14);
  backdrop-filter: blur(4px);
  z-index: 10;
}

.water-btn-tooltip::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: #bfdbfe;
}

.water-btn-tooltip::after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: -1px;
  border: 4px solid transparent;
  border-bottom-color: rgba(255, 255, 255, 0.95);
}

.btn-tooltip-enter-active,
.btn-tooltip-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.btn-tooltip-enter-from,
.btn-tooltip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-3px);
}

.water-body {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 42px;
}

.water-count {
  font-size: 34px;
  font-weight: 700;
  color: #2563eb;
  line-height: 1;
  letter-spacing: -0.5px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.water-count.is-pulse {
  animation: countPulse 0.25s ease;
}

.water-unit {
  font-size: 13px;
  color: #60a5fa;
  font-weight: 500;
}

.water-divider {
  width: 1px;
  height: 12px;
  background: #dbeafe;
  margin: 0 2px;
}

.water-last {
  font-size: 12px;
  color: #3b82f6;
}

.water-timeline {
  margin-top: 2px;
}

.timeline-track {
  position: relative;
  height: 18px;
  display: flex;
  align-items: center;
}

.timeline-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #dbeafe 0%, #bfdbfe 50%, #dbeafe 100%);
  border-radius: 1px;
}

.timeline-now {
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 2px;
  background: repeating-linear-gradient(
    to bottom,
    #93c5fd 0,
    #93c5fd 3px,
    transparent 3px,
    transparent 5px
  );
  transform: translateX(-50%);
  z-index: 1;
}

.timeline-drop {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, -50%);
  cursor: pointer;
  animation: dropFloat 2.4s ease-in-out infinite;
}

.drop-icon {
  color: #3b82f6;
  filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.2));
  transition: color 0.15s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.timeline-drop:hover,
.timeline-drop.is-hovered {
  animation-play-state: paused;
}

.timeline-drop:hover .drop-icon,
.timeline-drop.is-hovered .drop-icon {
  color: #2563eb;
  transform: scale(1.25);
}

.timeline-tooltip {
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #bfdbfe;
  color: #2563eb;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.14);
  backdrop-filter: blur(4px);
  z-index: 10;
}

.timeline-tooltip::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #bfdbfe;
}

.timeline-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: -1px;
  border: 4px solid transparent;
  border-top-color: rgba(255, 255, 255, 0.95);
}

.tooltip-enter-active,
.tooltip-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(2px);
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 10px;
  color: #93c5fd;
}

.timeline-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 0;
  font-size: 11px;
  color: #93c5fd;
  background: rgba(219, 234, 254, 0.4);
  border-radius: 8px;
}

.timeline-empty svg {
  color: #bfdbfe;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@keyframes dropFloat {
  0%, 100% { transform: translate(-50%, -52%); }
  50% { transform: translate(-50%, -48%); }
}

@keyframes countPulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .water-widget,
  .water-icon svg,
  .water-add,
  .water-count,
  .timeline-drop,
  .drop-icon,
  .timeline-empty svg {
    animation: none !important;
    transition: none !important;
  }
}
</style>
