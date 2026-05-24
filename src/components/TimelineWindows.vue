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
  if (active === null) return '#d4d4d8'
  if (active) return '#7c3aed'
  return '#059669'
}

function getBadgeClass(active: boolean | null): string {
  if (active === null) return 'badge-null'
  if (active) return 'badge-active'
  return 'badge-rest'
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
            <span class="time-range">
              {{ formatTime(block.startTs) }}
              <span class="time-sep">→</span>
              {{ formatTime(block.endTs) }}
            </span>
            <span class="duration">
              {{ formatDuration(block.endIdx - block.startIdx) }}
            </span>
            <div class="badges">
              <span class="badge" :class="getBadgeClass(block.active)">
                {{ getLabel(block.active) }}
              </span>
              <span v-if="block.isCurrent" class="current-badge">进行中</span>
            </div>
          </div>

          <transition name="expand">
            <div v-if="expandedBlock === i" class="detail">
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
}

.list {
  display: flex;
  flex-direction: column;
}

.block-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f4f4f5;
}

.block-row:last-child {
  border-bottom: none;
}

.block-row.is-current {
  background: #f5f3ff;
  margin: 0 -16px;
  padding: 10px 16px;
  border-radius: 8px;
  border-bottom: none;
}

.dot-wrapper {
  width: 8px;
  flex-shrink: 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot.pulse {
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
}

.card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  cursor: pointer;
}

.card-main {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.time-range {
  font-family: ui-monospace, "Cascadia Code", "SF Mono", monospace;
  font-size: 13px;
  font-weight: 500;
  color: #18181b;
  white-space: nowrap;
}

.time-sep {
  color: #d4d4d8;
  margin: 0 4px;
}

.duration {
  font-size: 13px;
  color: #71717a;
  white-space: nowrap;
}

.badges {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.badge {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

.badge-active {
  background: #f3e8ff;
  color: #6d28d9;
}

.badge-rest {
  background: #ecfdf5;
  color: #047857;
}

.badge-null {
  background: #f4f4f5;
  color: #71717a;
}

.current-badge {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  background: #ede9fe;
  color: #6d28d9;
  white-space: nowrap;
}

.detail {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f4f4f5;
}

.minute-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.minute-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.minute-row-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  width: 80px;
  flex-shrink: 0;
}

.m-cell {
  width: 6px;
  height: 6px;
  border-radius: 1px;
}

.m-active {
  background: #7c3aed;
}

.m-rest {
  background: #059669;
}

.m-null {
  background: #e4e4e7;
}

.minute-row-time {
  font-size: 11px;
  color: #a1a1aa;
  font-family: ui-monospace, "Cascadia Code", "SF Mono", monospace;
  white-space: nowrap;
}

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
