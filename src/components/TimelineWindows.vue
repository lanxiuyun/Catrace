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
import { useI18n } from 'vue-i18n'
import type { MinuteData } from './Timeline.vue'
import { computeTimeBlocks, mergeRestBlocks } from '../utils/timeBlocks'

const { t } = useI18n()

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

// 当前展开的 block 索引集合（整行一起展开/收起）
const expandedSet = ref(new Set<number>())

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
  if (isCurrent) return t('timelineWindows.inProgress')
  if (active === null) return t('timeline.null')
  if (active) return t('timeline.active')
  return t('timeline.rest')
}

function getColor(active: boolean | null): string {
  if (active === null) return '#d4d4d8'
  if (active) return '#7c3aed'
  return '#059669'
}

// 读取 CSS Grid 实际列数（与 auto-fill 布局保持一致）
function getCols(): number {
  const grid = document.querySelector('.grid') as HTMLElement | null
  if (!grid) return 3
  const style = window.getComputedStyle(grid)
  return style.gridTemplateColumns.split(' ').length
}

// 计算索引 i 所在的 CSS Grid 行包含的所有 block 索引
function getRowIndices(i: number): number[] {
  const cols = getCols()
  const row = Math.floor(i / cols)
  const start = row * cols
  const end = Math.min(start + cols, blocks.value.length)
  return Array.from({ length: end - start }, (_, j) => start + j)
}

// 点击卡片时整行同步展开/收起：若该行已有展开卡片则全部收起，否则全部展开
function toggleBlock(i: number) {
  const rowIndices = getRowIndices(i)
  const isAnyExpanded = rowIndices.some(idx => expandedSet.value.has(idx))
  const next = new Set(expandedSet.value)
  rowIndices.forEach(idx => {
    if (isAnyExpanded) {
      next.delete(idx)
    } else {
      next.add(idx)
    }
  })
  expandedSet.value = next
}

function chunkMinutes(minutes: MinuteData[], size: number): MinuteData[][] {
  const chunks: MinuteData[][] = []
  for (let i = 0; i < minutes.length; i += size) {
    chunks.push(minutes.slice(i, i + size))
  }
  return chunks
}

interface Segment {
  active: boolean | null
  count: number
}

function segmentRow(row: MinuteData[]): Segment[] {
  if (row.length === 0) return []
  const segs: Segment[] = []
  let cur: Segment = { active: row[0].active, count: 1 }
  for (let i = 1; i < row.length; i++) {
    if (row[i].active === cur.active) {
      cur.count++
    } else {
      segs.push(cur)
      cur = { active: row[i].active, count: 1 }
    }
  }
  segs.push(cur)
  return segs
}

interface DisplayItem {
  type: 'segment' | 'cells'
  active: boolean | null
  count: number
  startTs: number
  minutes: MinuteData[]
}

function buildDisplayItems(row: MinuteData[]): DisplayItem[] {
  const segs = segmentRow(row)
  const items: DisplayItem[] = []
  let offset = 0
  for (const seg of segs) {
    if (seg.count >= 5) {
      items.push({
        type: 'segment',
        active: seg.active,
        count: seg.count,
        startTs: row[0].ts + offset * 60,
        minutes: [],
      })
    } else {
      items.push({
        type: 'cells',
        active: seg.active,
        count: seg.count,
        startTs: row[0].ts + offset * 60,
        minutes: row.slice(offset, offset + seg.count),
      })
    }
    offset += seg.count
  }
  return items
}

/** 合并连续同状态的 10 分钟行 */
function mergeChunkRows(chunks: MinuteData[][]): MinuteData[][] {
  if (chunks.length === 0) return []
  const merged: MinuteData[][] = []
  let cur = chunks[0]

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    const curSegs = segmentRow(cur)
    const nextSegs = segmentRow(next)
    if (curSegs.length === 1 && nextSegs.length === 1 && curSegs[0].active === nextSegs[0].active) {
      cur = cur.concat(next)
    } else {
      merged.push(cur)
      cur = next
    }
  }
  merged.push(cur)
  return merged
}

function getVisibleMinutes(block: WindowBlock): MinuteData[] {
  const all = block.windows.flatMap(w => w.minutes)
  if (!block.isCurrent) return all
  const end = Math.min(all.length, nowIdx.value - block.startIdx + 1)
  return all.slice(0, Math.max(0, end))
}

interface ChunkRow {
  minutes: MinuteData[]
  isLast: boolean
}

function getChunkRows(block: WindowBlock): ChunkRow[] {
  const rows = mergeChunkRows(chunkMinutes(getVisibleMinutes(block), 10))
  return rows.map((minutes, i) => ({
    minutes,
    isLast: i === rows.length - 1,
  }))
}

function countActiveInBlock(block: WindowBlock): number {
  const mins = block.windows.flatMap(w => w.minutes)
  return mins.filter(m => m.active === true).length
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

      <div class="card-meta">
        <span class="card-duration">
          {{ formatDuration(block.isCurrent ? nowIdx - block.startIdx : block.endIdx - block.startIdx) }}
        </span>
        <span
          v-if="block.active === false && countActiveInBlock(block) > 0"
          class="card-nested-active"
        >
          {{ t('timelineWindows.activeShort') }} {{ formatDuration(countActiveInBlock(block)) }}
        </span>
      </div>

      <transition name="expand">
        <div v-if="expandedSet.has(i)" class="detail" @click.stop>
          <div class="minute-rows">
            <div
              v-for="(row, ri) in getChunkRows(block)"
              :key="ri"
              class="minute-row"
            >
              <div class="minute-row-bar">
                <template v-for="(item, ii) in buildDisplayItems(row.minutes)" :key="ii">
                  <div
                    v-if="item.type === 'segment'"
                    class="m-seg"
                    :class="{
                      'm-seg-active': item.active === true,
                      'm-seg-rest': item.active === false,
                      'm-seg-null': item.active === null,
                    }"
                    :style="{ flex: item.count }"
                  >
                    <span class="seg-tip">{{ formatTime(item.startTs) }}–{{ formatTime(item.startTs + item.count * 60) }} · {{ formatDuration(item.count) }}</span>
                  </div>
                  <div
                    v-else
                    class="m-cells"
                    :style="{ flex: item.count }"
                  >
                    <div
                      v-for="(m, mi) in item.minutes"
                      :key="mi"
                      class="m-cell"
                      :class="{
                        'm-cell-active': m.active === true,
                        'm-cell-rest': m.active === false,
                        'm-cell-null': m.active === null,
                      }"
                    >
                      <span class="seg-tip">{{ formatTime(m.ts) }} · {{ getLabel(m.active, false) }}</span>
                    </div>
                  </div>
                </template>
                <div
                  v-if="row.isLast && row.minutes.length < 10"
                  class="m-placeholder"
                  :style="{ flex: 10 - row.minutes.length }"
                />
              </div>
              <span class="minute-row-time">
                {{ formatTime(row.minutes[0].ts) }}–{{ formatTime(row.minutes[row.minutes.length - 1].ts + 60) }}
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
  grid-template-columns: repeat(auto-fit, minmax(15.625rem, 1fr));
  gap: 0.75rem;
}

.card {
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.75rem;
  padding: 1rem;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.1s ease;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.card:hover {
  box-shadow: 0 0.25rem 0.75rem rgba(46, 16, 101, 0.08);
  transform: translateY(0.0625rem);
}

.card.is-current {
  border-color: #a78bfa;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}

.dot.pulse {
  position: relative;
  animation: dotBreathe 2s ease-in-out infinite;
}

.dot.pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: dotRipple 2s ease-out infinite;
}

@keyframes dotBreathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.25); }
}

@keyframes dotRipple {
  0% {
    transform: scale(1);
    opacity: 0.4;
  }
  100% {
    transform: scale(3.5);
    opacity: 0;
  }
}

.badge {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
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
  font-size: 0.8125rem;
  font-weight: 500;
  color: #18181b;
}

.time-sep {
  color: #d4d4d8;
  margin: 0 0.25rem;
}

.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-duration {
  font-size: 0.8125rem;
  color: #71717a;
}

.card-nested-active {
  font-size: 0.6875rem;
  color: #a1a1aa;
}

/* 展开详情 */
.detail {
  margin-top: 0.25rem;
  padding-top: 0.625rem;
  border-top: 0.0625rem solid #ebe6f2;
}

.minute-rows {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.minute-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.minute-row-bar {
  display: flex;
  height: 0.5rem;
  flex: 1;
  min-width: 0;
  gap: 0.0625rem;
  border-radius: 0.125rem;
  overflow: visible;
}

.m-seg {
  height: 100%;
  min-width: 0.0625rem;
  position: relative;
  cursor: pointer;
  transition: filter 0.12s ease, transform 0.12s ease, opacity 0.12s ease;
}

.m-seg:hover {
  filter: brightness(1.15);
  transform: translateY(0.125rem);
  z-index: 2;
}

.m-cells {
  display: flex;
  gap: 0.0625rem;
  height: 100%;
  min-width: 0;
}

.m-cell {
  flex: 1;
  min-width: 0.0625rem;
  height: 100%;
  border-radius: 0.0625rem;
  position: relative;
  cursor: pointer;
  transition: filter 0.12s ease, transform 0.12s ease;
}

.m-cell:hover {
  filter: brightness(1.15);
  transform: translateY(0.125rem);
  z-index: 2;
}

.m-cell-active {
  background: #7c3aed;
}

.m-cell-rest {
  background: #059669;
}

.m-cell-null {
  background: #e4e4e7;
}

.seg-tip {
  position: absolute;
  bottom: calc(100% + 0.375rem);
  left: 50%;
  transform: translateX(-50%);
  padding: 0.1875rem 0.625rem;
  background: rgba(24, 24, 27, 0.95);
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: 0.375rem;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, transform 0.12s ease;
  line-height: 1.4;
  box-shadow: 0 0.25rem 0.875rem rgba(0, 0, 0, 0.3);
  border: 0.0625rem solid rgba(255, 255, 255, 0.08);
}

.m-seg:hover .seg-tip,
.m-cell:hover .seg-tip {
  opacity: 1;
}

.m-seg-active {
  background: #7c3aed;
}

.m-seg-rest {
  background: #059669;
}

.m-seg-null {
  background: #e4e4e7;
}

.m-placeholder {
  height: 100%;
  border-radius: 0.0625rem;
  min-width: 0.0625rem;
}

.minute-row-time {
  font-size: 0.6875rem;
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
  max-height: 25rem;
}
</style>
