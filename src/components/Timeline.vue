<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

export interface MinuteData {
  ts: number
  active: boolean | null
}

const props = defineProps<{
  minutes: MinuteData[]
}>()

const gridRef = ref<HTMLDivElement | null>(null)
const hoveredIndex = ref<number | null>(null)
const selectedIndex = ref<number | null>(null)

const MINUTES_PER_DAY = 1440

const nowIndex = computed(() => {
  const now = Math.floor(Date.now() / 1000)
  const dayStart = props.minutes[0]?.ts ?? 0
  if (!dayStart) return null
  const idx = Math.floor((now - dayStart) / 60)
  if (idx < 0 || idx >= MINUTES_PER_DAY) return null
  return idx
})

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getColor(m: MinuteData): string {
  if (m.active === null) return '#EDE9FE'
  if (m.active) return '#7C3AED'
  return '#14B8A6'
}

function getLabel(m: MinuteData): string {
  if (m.active === null) return t('timeline.null')
  if (m.active) return t('timeline.active')
  return t('timeline.rest')
}

function isAdjacentSame(i: number): boolean {
  if (i <= 0 || i >= props.minutes.length - 1) return false
  const curr = props.minutes[i].active
  const prev = props.minutes[i - 1].active
  const next = props.minutes[i + 1].active
  return curr === prev || curr === next
}

function onGridMouseMove(e: MouseEvent) {
  const grid = gridRef.value
  if (!grid) return
  const rect = grid.getBoundingClientRect()
  const col = Math.floor((e.clientX - rect.left) / (rect.width / 60))
  const row = Math.floor((e.clientY - rect.top) / (rect.height / 24))
  const index = row * 60 + col
  hoveredIndex.value = Math.max(0, Math.min(MINUTES_PER_DAY - 1, index))
}

function onGridMouseLeave() {
  hoveredIndex.value = null
}

function onCellClick(i: number) {
  selectedIndex.value = selectedIndex.value === i ? null : i
}

function getCellStyle(m: MinuteData, i: number): Record<string, string> {
  const style: Record<string, string> = {
    backgroundColor: getColor(m),
  }
  if (m.active !== null && isAdjacentSame(i)) {
    style.borderRadius = '0.0625rem'
  }
  return style
}
</script>

<template>
  <div class="timeline">
    <!-- 分钟刻度 + 网格主体 -->
    <div class="grid-body">
      <!-- 分钟刻度（顶部） -->
      <div class="minute-ticks">
        <div
          v-for="m in [0, 15, 30, 45]"
          :key="m"
          class="minute-tick"
          :style="{ left: (m / 60 * 100) + '%' }"
        >
          {{ m }}
        </div>
      </div>

      <div class="grid-area">
        <!-- 小时标签（左侧） -->
        <div class="hour-labels">
          <div v-for="h in 24" :key="h - 1" class="hour-label">
            {{ String(h - 1).padStart(2, '0') }}
          </div>
        </div>

        <!-- 分钟格子 -->
        <div
          ref="gridRef"
          class="grid"
          @mousemove="onGridMouseMove"
          @mouseleave="onGridMouseLeave"
        >
          <div
            v-for="(m, i) in props.minutes"
            :key="i"
            class="cell"
            :class="{
              'is-now': nowIndex === i,
              'is-hovered': hoveredIndex === i,
              'is-selected': selectedIndex === i,
            }"
            :style="getCellStyle(m, i)"
            @click="onCellClick(i)"
          />
        </div>
      </div>
    </div>

    <!-- 悬停信息 -->
    <div class="hover-row">
      <transition name="fade">
        <div v-if="hoveredIndex !== null" class="hover-info">
          <span class="hover-time">{{ formatTime(props.minutes[hoveredIndex].ts) }}</span>
          <span
            class="hover-badge"
            :style="{ backgroundColor: getColor(props.minutes[hoveredIndex]) }"
          >
            {{ getLabel(props.minutes[hoveredIndex]) }}
          </span>
        </div>
        <div v-else class="hover-placeholder">{{ t('timeline.hoverHint') }}</div>
      </transition>
    </div>

    <!-- 图例 -->
    <div class="legend">
      <div class="legend-item">
        <span class="dot" style="background:#7C3AED" />
        <span>{{ t('timeline.active') }}</span>
      </div>
      <div class="legend-item">
        <span class="dot" style="background:#14B8A6" />
        <span>{{ t('timeline.rest') }}</span>
      </div>
      <div class="legend-item">
        <span class="dot" style="background:#EDE9FE" />
        <span>{{ t('timeline.null') }}</span>
      </div>
      <div class="legend-item">
        <span class="dot is-now-demo" />
        <span>{{ t('timeline.current') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  user-select: none;
}

.grid-body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.minute-ticks {
  position: relative;
  height: 0.875rem;
  margin-left: 2.125rem;
}

.minute-tick {
  position: absolute;
  top: 0;
  font-size: 0.625rem;
  color: #A78BFA;
  transform: translateX(-50%);
  font-weight: 500;
}

.grid-area {
  display: flex;
  gap: 0.375rem;
}

.hour-labels {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 1.75rem;
  padding-top: 0;
  padding-bottom: 0;
}

.hour-label {
  font-size: 0.625rem;
  color: #A78BFA;
  text-align: right;
  line-height: 1;
  height: 0.875rem;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-weight: 500;
}

.grid {
  display: grid;
  grid-template-columns: repeat(60, 1fr);
  grid-template-rows: repeat(24, 1fr);
  gap: 0.125rem;
  flex: 1;
  cursor: crosshair;
}

.cell {
  aspect-ratio: 1;
  border-radius: 0.1875rem;
  min-width: 0.25rem;
  min-height: 0.25rem;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-radius 0.1s;
  position: relative;
}

.cell:hover,
.cell.is-hovered {
  transform: scale(1.5);
  box-shadow: 0 0.125rem 0.5rem rgba(139, 92, 246, 0.3);
  z-index: 2;
  border-radius: 0.25rem;
}

.cell.is-selected {
  box-shadow: 0 0 0 0.125rem #F59E0B;
  z-index: 3;
  border-radius: 0.25rem;
}

.cell.is-now {
  box-shadow: 0 0 0 0.125rem #EF4444;
  border-radius: 0.25rem;
  z-index: 1;
  animation: pulse-ring 2s infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0.125rem rgba(239, 68, 68, 0.6);
  }
  50% {
    box-shadow: 0 0 0 0.3125rem rgba(239, 68, 68, 0);
  }
  100% {
    box-shadow: 0 0 0 0.125rem rgba(239, 68, 68, 0.6);
  }
}

.hover-row {
  margin-top: 0.75rem;
  min-height: 1.75rem;
  display: flex;
  align-items: center;
}

.hover-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: #6D28D9;
}

.hover-time {
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
  font-weight: 600;
  color: #3730A3;
}

.hover-badge {
  padding: 0.125rem 0.625rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  color: white;
  font-weight: 600;
}

.hover-placeholder {
  font-size: 0.8125rem;
  color: #C4B5FD;
}

.legend {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
  align-items: center;
  font-size: 0.75rem;
  color: #7C7CAA;
  flex-wrap: wrap;
  font-weight: 500;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 0.1875rem;
}

.dot.is-now-demo {
  box-shadow: 0 0 0 0.125rem #EF4444;
  background: transparent;
  animation: pulse-ring 2s infinite;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
