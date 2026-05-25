/**
 * TimelineWindows.vue — 概览视图：block 卡片网格（一行最多 3 个）+ 可展开分钟色块
 *
 * 核心职责：
 * 1. 调用 computeTimeBlocks + mergeRestBlocks，把全天 1440 分钟切分为活跃/休息 block。
 * 2. 以卡片网格展示各 block 的状态、时间范围、时长。
 * 3. 点击卡片展开：每 10 分钟一行的迷你色块。
 * 4. 进行中 block 淡紫底高亮。
 */
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { MinuteData } from './Timeline.vue'
import { computeTimeBlocks, mergeRestBlocks } from '../utils/timeBlocks'

const props = defineProps<{
  minutes: MinuteData[]    // 全天 1440 分钟的 MinuteData
  windowMinutes?: number   // 工作窗口长度（默认 45）
  breakMinutes?: number    // 连续休息打断阈值（默认 5）
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

// 当前展开的是第几个 block（索引），null 表示全部收起
const expandedBlock = ref<number | null>(null)

const nowIdx = computed(() => {
  if (props.minutes.length === 0) return 0
  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, Math.min(1439, Math.floor((now - props.minutes[0].ts) / 60)))
})

const nowTs = computed(() => {
  if (props.minutes.length === 0) return Math.floor(Date.now() / 1000)
  return props.minutes[0].ts + nowIdx.value * 60
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
  })).reverse()
})

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function getLabel(active: boolean | null, isCurrent: boolean): string {
  if (isCurrent) return '进行中'
  if (active === null) return '无记录'
  if (active) return '活跃'
  return '休息'
}

function getColor(active: boolean | null): string {
  if (active === null) return '#d4d4d8'
  if (active) return '#7c3aed'
  return '#059669'
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

function getVisibleMinutes(block: WindowBlock): MinuteData[] {
  const all = block.windows.flatMap(w => w.minutes)
  if (!block.isCurrent) return all
  const end = Math.min(all.length, nowIdx.value - block.startIdx + 1)
  return all.slice(0, Math.max(0, end))
}
</script>

<template>
  <div class="grid">
    <div
      v-for="(block, i) in blocks"
      :key="i"
      class="card"
      :class="{ 'is-current': block.isCurrent }"
      @click="toggleBlock(i)"
    >
      <div class="card-top">
        <div
          class="dot"
          :class="{ pulse: block.isCurrent }"
          :style="{ backgroundColor: getColor(block.active) }"
        />
        <span class="badge" :class="block.isCurrent ? 'badge-current' : block.active === true ? 'badge-active' : block.active === false ? 'badge-rest' : 'badge-null'">
          {{ getLabel(block.active, block.isCurrent) }}
        </span>
      </div>

      <div class="card-time">
        {{ formatTime(block.startTs) }}
        <span class="time-sep">→</span>
        {{ formatTime(block.isCurrent ? nowTs : block.endTs + 60) }}
      </div>

      <div class="card-duration">
        {{ formatDuration(block.isCurrent ? nowIdx - block.startIdx : block.endIdx - block.startIdx) }}
      </div>

      <transition name="expand">
        <div v-if="expandedBlock === i" class="detail" @click.stop>
          <div class="minute-rows">
            <div
              v-for="(row, ri) in chunkMinutes(getVisibleMinutes(block), 10)"
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
                {{ formatTime(row[0].ts) }}–{{ formatTime(row[row.length - 1].ts + 60) }}
              </span>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.card {
  background: #fff;
  border: 1px solid #ebe6f2;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.1s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card:hover {
  box-shadow: 0 4px 12px rgba(46, 16, 101, 0.08);
  transform: translateY(-1px);
}

.card.is-current {
  background: #f5f3ff;
  border-color: #ddd6fe;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot.pulse {
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
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

.badge-current {
  background: #ede9fe;
  color: #6d28d9;
}

.card-time {
  font-family: ui-monospace, "Cascadia Code", "SF Mono", monospace;
  font-size: 13px;
  font-weight: 500;
  color: #18181b;
}

.time-sep {
  color: #d4d4d8;
  margin: 0 4px;
}

.card-duration {
  font-size: 13px;
  color: #71717a;
}

/* 展开详情 */
.detail {
  margin-top: 4px;
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

/* 展开动画 */
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
  padding-top: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 400px;
}
</style>
