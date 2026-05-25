/**
 * TimelineWindows.vue — 概览视图：block 时段单行列表 + 可展开分钟色块
 *
 * 核心职责：
 * 1. 调用 computeTimeBlocks + mergeRestBlocks，把全天 1440 分钟切分为活跃/休息 block。
 * 2. 以紧凑单行列表展示各 block 的时间范围、时长、状态。
 * 3. 点击条目展开：每 10 分钟一行的迷你色块（紫色=活跃，绿色=休息，灰色=无记录）。
 * 4. 进行中 block 特殊处理：淡紫底高亮，结束时间取实时 nowTs，展开时不显示未来分钟。
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

/**
 * 当前分钟在全天中的索引（0~1439）。
 * props.minutes[0].ts 是当天 00:00 的时间戳，
 * (now - dayStart) / 60 即为当前分钟索引。
 */
const nowIdx = computed(() => {
  if (props.minutes.length === 0) return 0
  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, Math.min(1439, Math.floor((now - props.minutes[0].ts) / 60)))
})

/**
 * 当前整分钟的时间戳（秒）。
 * 用于「进行中 block」的结束时间显示，取整分钟边界而非实时秒数，
 * 这样和时长计算（nowIdx - startIdx）保持一致。
 */
const nowTs = computed(() => {
  if (props.minutes.length === 0) return Math.floor(Date.now() / 1000)
  return props.minutes[0].ts + nowIdx.value * 60
})

/**
 * 经切分、合并后的 block 列表。
 *
 * 流程：
 * 1. computeTimeBlocks 按前瞻式窗口切分出活跃/休息 block（只到当前时间）。
 * 2. mergeRestBlocks 把相邻的「已完成休息 block」合并，避免列表碎片化。
 * 3. 转成 WindowBlock 结构供模板使用（windows 字段保留是为了兼容早期多窗口设计，
 *    目前每个 block 只含一个 WorkWindow）。
 */
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

/**
 * 将 MinuteData 数组按固定大小切分为二维数组。
 * 用于展开视图：每 10 个分钟一行迷你色块。
 */
function chunkMinutes(minutes: MinuteData[], size: number): MinuteData[][] {
  const chunks: MinuteData[][] = []
  for (let i = 0; i < minutes.length; i += size) {
    chunks.push(minutes.slice(i, i + size))
  }
  return chunks
}

/**
 * 获取展开时应显示的分钟数据。
 *
 * 已完成 block：返回全部分钟。
 * 进行中 block：截断到 nowIdx，不显示未来时间。
 *
 * 为什么需要截断：
 * 即使 computeTimeBlocks 已排除未来数据，进行中 block 的理论长度仍可能达到
 * windowMinutes（如当前只进行了 8 分钟，但 block 定义长度是 45 分钟）。
 * 截断确保展开时只展示「已发生」的分钟，避免末尾出现一大片灰色未来格子。
 */
function getVisibleMinutes(block: WindowBlock): MinuteData[] {
  const all = block.windows.flatMap(w => w.minutes)
  if (!block.isCurrent) return all
  const end = Math.min(all.length, nowIdx.value - block.startIdx + 1)
  return all.slice(0, Math.max(0, end))
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
              <!--
                +60 原因：block 在代码里是 [start, end) 左闭右开。
                endTs 是最后一条记录的时间戳（如 00:44），
                但时长 = endIdx - startIdx = 45 分钟。
                直接显示 00:44 会和「45 分钟」对不上（人类觉得 00:00→00:44 是 44 分钟）。
                所以 +60 显示不包含的结束边界（00:45），和时长一致。
                进行中 block 直接取 nowTs，不需要 +60。
              -->
              {{ formatTime(block.isCurrent ? nowTs : block.endTs + 60) }}
            </span>
            <span class="duration">
              <!-- 进行中 block：时长 = 从 block 起始到现在；已完成 block：时长 = 记录条数 -->
              {{ formatDuration(block.isCurrent ? nowIdx - block.startIdx : block.endIdx - block.startIdx) }}
            </span>
            <div class="badges">
              <!-- 进行中 block 不需要「活跃/休息」状态标签，只显示「进行中」即可 -->
              <span v-if="!block.isCurrent" class="badge" :class="getBadgeClass(block.active)">
                {{ getLabel(block.active) }}
              </span>
              <span v-if="block.isCurrent" class="current-badge">进行中</span>
            </div>
          </div>

          <transition name="expand">
            <div v-if="expandedBlock === i" class="detail">
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
                    <!--
                      同主卡片 +60 逻辑：row[last].ts 是最后一条记录的时间戳（包含），
                      +60 后显示不包含的结束边界，和「10 分钟」的时长对齐。
                    -->
                    {{ formatTime(row[0].ts) }}–{{ formatTime(row[row.length - 1].ts + 60) }}
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
