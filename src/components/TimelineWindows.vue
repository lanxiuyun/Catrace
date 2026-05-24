<script setup lang="ts">
import { ref, computed } from 'vue'
import type { MinuteData } from './Timeline.vue'
import { computeTimeBlocks, mergeRestBlocks } from '../utils/timeBlocks'

const props = defineProps<{
  minutes: MinuteData[]
  windowMinutes?: number
  breakMinutes?: number
}>()

interface WorkWindow {
  startIdx: number
  endIdx: number
  startTs: number
  endTs: number
  active: boolean | null
  isCurrent: boolean
  minutes: MinuteData[]
}

interface WindowBlock {
  windows: WorkWindow[]
  active: boolean | null
  isCurrent: boolean
  startIdx: number
  endIdx: number
  startTs: number
  endTs: number
}

const expandedBlock = ref<number | null>(null)

const nowIdx = computed(() => {
  if (props.minutes.length === 0) return 0
  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, Math.min(1439, Math.floor((now - props.minutes[0].ts) / 60)))
})

const blocks = computed<WindowBlock[]>(() => {
  const raw = computeTimeBlocks(
    props.minutes,
    props.windowMinutes ?? 45,
    props.breakMinutes ?? 5,
    nowIdx.value
  )
  const merged = mergeRestBlocks(raw)

  return merged.map(b => ({
    windows: [b as WorkWindow],
    active: b.active,
    isCurrent: b.isCurrent,
    startIdx: b.startIdx,
    endIdx: b.endIdx,
    startTs: b.startTs,
    endTs: b.endTs,
  }))
})

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
}

function getLabel(active: boolean | null): string {
  if (active === null) return '无记录'
  if (active) return '活跃'
  return '休息'
}

function getColor(active: boolean | null): string {
  if (active === null) return '#EDE9FE'
  if (active) return '#8B5CF6'
  return '#10B981'
}

function getTextColor(active: boolean | null): string {
  if (active === null) return '#8B5CF6'
  return '#fff'
}

function toggleBlock(i: number) {
  expandedBlock.value = expandedBlock.value === i ? null : i
}

function chunkMinutes(minutes: MinuteData[], size: number): MinuteData[][] {
  const chunks: MinuteData[][] = []
  for (let i = 0; i < minutes.length; i += size) {
    chunks.push(minutes.slice(i, i + size))
  }
  return chunks
}
</script>

<template>
  <div class="windows">
    <div class="timeline-line" />
    <div class="list">
      <div
        v-for="(block, i) in blocks"
        :key="i"
        class="block-row"
        :class="{ 'is-current': block.isCurrent }"
      >
        <div class="dot-wrapper">
          <div
            class="dot"
            :class="{ pulse: block.isCurrent }"
            :style="{ backgroundColor: getColor(block.active) }"
          />
        </div>

        <div class="card" @click="toggleBlock(i)">
          <div class="card-main">
            <div class="card-header">
              <span class="time-range">
                {{ formatTime(block.startTs) }}
                <span class="time-sep">→</span>
                {{ formatTime(block.endTs) }}
              </span>
              <div class="badges">
                <span
                  class="badge"
                  :style="{ backgroundColor: getColor(block.active), color: getTextColor(block.active) }"
                >
                  {{ getLabel(block.active) }}
                </span>
                <span v-if="block.isCurrent" class="current-badge">进行中</span>
              </div>
            </div>
            <div class="card-body">
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :style="{ width: '100%', backgroundColor: getColor(block.active) }"
                />
              </div>
              <span class="duration">
                {{ formatDuration(block.endIdx - block.startIdx) }}
                <span v-if="block.windows.length > 1" class="window-count">
                  · {{ block.windows.length }} 个窗口
                </span>
              </span>
            </div>
          </div>

          <!-- 展开详情 -->
          <transition name="expand">
            <div v-if="expandedBlock === i" class="detail">
              <div class="detail-sep" />

              <!-- 每分钟色块 -->
              <div class="minute-rows">
                <div
                  v-for="(row, ri) in chunkMinutes(block.windows.flatMap(w => w.minutes), 10)"
                  :key="ri"
                  class="minute-row"
                >
                  <div class="minute-row-grid">
                    <div
                      v-for="(m, mi) in row"
                      :key="mi"
                      class="m-cell"
                      :class="{
                        'm-active': m.active === true,
                        'm-rest': m.active === false,
                        'm-null': m.active === null,
                      }"
                      :title="formatTime(m.ts)"
                    />
                  </div>
                  <span class="minute-row-time">
                    {{ formatTime(row[0].ts) }}–{{ formatTime(row[row.length - 1].ts) }}
                  </span>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.windows {
  position: relative;
  padding-left: 8px;
}

.timeline-line {
  position: absolute;
  left: 15px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: linear-gradient(180deg, #C4B5FD 0%, #8B5CF6 50%, #C4B5FD 100%);
  border-radius: 1px;
  opacity: 0.4;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  position: relative;
}

.block-row.is-current .card {
  border-color: #F59E0B;
  box-shadow: 0 0 0 1px #F59E0B, 0 4px 16px rgba(245, 158, 11, 0.1);
}

.dot-wrapper {
  width: 16px;
  display: flex;
  justify-content: center;
  padding-top: 12px;
  flex-shrink: 0;
  z-index: 1;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(139, 92, 246, 0.25);
}

.dot.pulse {
  animation: dot-pulse 2s infinite;
}

@keyframes dot-pulse {
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); }
  70% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}

.card {
  flex: 1;
  background: #fff;
  border: 1px solid #F3E8FF;
  border-radius: 16px;
  padding: 12px 16px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
  cursor: pointer;
}

.card:hover {
  transform: translateX(4px);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.1);
}

.card-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.time-range {
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #4C1D95;
}

.time-sep {
  color: #C4B5FD;
  margin: 0 4px;
}

.badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 12px;
  border-radius: 20px;
  white-space: nowrap;
}

.current-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  background: #FEF3C7;
  color: #D97706;
  white-space: nowrap;
}

.card-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bar-track {
  flex: 1;
  height: 8px;
  background: #F3E8FF;
  border-radius: 4px;
  overflow: hidden;
  min-width: 40px;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  opacity: 0.85;
}

.duration {
  font-size: 13px;
  color: #8B5CF6;
  font-weight: 500;
  white-space: nowrap;
}

.window-count {
  color: #A78BFA;
  font-size: 11px;
}

/* 展开详情 */
.detail {
  margin-top: 10px;
}

.detail-sep {
  height: 1px;
  background: #F3E8FF;
  margin-bottom: 10px;
}

.sub-windows {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.sub-window {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #6D28D9;
  background: #FAF5FF;
  padding: 3px 8px;
  border-radius: 8px;
}

.sub-time {
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
}

.sub-badge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.minute-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.minute-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.minute-row-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 1px;
  width: 70px;
  flex-shrink: 0;
}

.m-cell {
  width: 6px;
  height: 6px;
  border-radius: 1px;
}

.m-active {
  background: #8B5CF6;
}

.m-rest {
  background: #10B981;
}

.m-null {
  background: #EDE9FE;
}

.minute-row-time {
  font-size: 10px;
  color: #A78BFA;
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
  white-space: nowrap;
}

/* 过渡 */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 400px;
}
</style>
