<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NCard, NStatistic, NGrid, NGi, NTag, NProgress, NRadioGroup, NRadioButton } from 'naive-ui'
import { getTodayStats, getTodayRecords, getConfig } from '../api/tauri'
import Timeline from '../components/Timeline.vue'
import TimelineWindows from '../components/TimelineWindows.vue'
import type { MinuteData } from '../components/Timeline.vue'
import { computeTimeBlocks } from '../utils/timeBlocks'

const stats = ref({ active_minutes: 0, rest_minutes: 0 })
const records = ref<Map<number, boolean>>(new Map())
const config = ref({ window_minutes: 45, break_minutes: 5 })
const timelineMode = ref<'grid' | 'segments'>('segments')

function startOfDayTs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

const allMinutes = computed<MinuteData[]>(() => {
  const dayStart = startOfDayTs()
  const result: MinuteData[] = []
  for (let i = 0; i < 1440; i++) {
    const ts = dayStart + i * 60
    const active = records.value.has(ts) ? records.value.get(ts)! : null
    result.push({ ts, active })
  }
  return result
})

const totalTracked = computed(() => stats.value.active_minutes + stats.value.rest_minutes)
const activityPercent = computed(() =>
  totalTracked.value > 0 ? Math.round((stats.value.active_minutes / totalTracked.value) * 100) : 0
)

const currentStatus = computed(() => {
  const now = Math.floor(Date.now() / 1000)
  const dayStart = startOfDayTs()
  const idx = Math.floor((now - dayStart) / 60)
  const m = allMinutes.value[idx]
  if (!m || m.active === null) return { label: '未记录', type: 'default' as const }
  return m.active
    ? { label: '活跃中', type: 'success' as const }
    : { label: '休息中', type: 'info' as const }
})

const activeBlockCount = computed(() => {
  const now = Math.floor(Date.now() / 1000)
  const nowIdx = Math.max(0, Math.min(1439, Math.floor((now - startOfDayTs()) / 60)))
  const blocks = computeTimeBlocks(
    allMinutes.value,
    config.value.window_minutes,
    config.value.break_minutes,
    nowIdx
  )
  return blocks.filter(b => b.active === true).length
})


onMounted(async () => {
  try {
    const c = await getConfig()
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
    }
    stats.value = await getTodayStats()
    const raw = await getTodayRecords()
    const map = new Map<number, boolean>()
    for (const [ts, active] of raw) {
      map.set(ts, active)
    }
    records.value = map
  } catch (e) {
    console.error('获取数据失败', e)
  }
})
</script>

<template>
  <div class="dashboard">
    <div class="header">
      <div class="header-left">
        <h1 class="title">今日概览</h1>
        <span class="subtitle">{{ new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}</span>
      </div>
      <n-tag :type="currentStatus.type" size="large" round class="status-tag">
        {{ currentStatus.label }}
      </n-tag>
    </div>

    <!-- 统计卡片 -->
    <n-grid :cols="4" :x-gap="16" :y-gap="16" class="stats-grid" responsive="screen">
      <n-gi span="1">
        <n-card class="stat-card stat-primary" :bordered="false">
          <n-statistic label="活跃" :value="stats.active_minutes">
            <template #suffix>分钟</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="1">
        <n-card class="stat-card stat-secondary" :bordered="false">
          <n-statistic label="休息" :value="stats.rest_minutes">
            <template #suffix>分钟</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="1">
        <n-card class="stat-card stat-tertiary" :bordered="false">
          <n-statistic label="活跃占比" :value="activityPercent">
            <template #suffix>%</template>
          </n-statistic>
          <n-progress
            type="line"
            :percentage="activityPercent"
            :show-indicator="false"
            :height="4"
            color="#8B5CF6"
            rail-color="#E9D5FF"
            class="stat-progress"
          />
        </n-card>
      </n-gi>
      <n-gi span="1">
        <n-card class="stat-card stat-quaternary" :bordered="false">
          <n-statistic label="活跃时段" :value="activeBlockCount">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 环形图 + 时段分析 -->
    <n-grid :cols="3" :x-gap="16" :y-gap="16" class="insight-grid" responsive="screen">
      <n-gi span="2">
        <n-card class="timeline-card" :bordered="false">
          <div class="timeline-header">
            <span class="timeline-title">今日活动</span>
            <n-radio-group v-model:value="timelineMode" size="small">
              <n-radio-button value="grid">详细</n-radio-button>
              <n-radio-button value="segments">概览</n-radio-button>
            </n-radio-group>
          </div>
          <Timeline v-if="timelineMode === 'grid'" :minutes="allMinutes" />
          <TimelineWindows
            v-else
            :minutes="allMinutes"
            :window-minutes="config.window_minutes"
            :break-minutes="config.break_minutes"
          />
          <div v-if="records.size === 0" class="empty">
            暂无数据，程序运行一段时间后会生成。
          </div>
        </n-card>
      </n-gi>
      <n-gi span="1">
        <n-card class="ring-card" :bordered="false">
          <div class="ring-header">活跃 vs 休息</div>
          <div class="ring-chart">
            <svg viewBox="0 0 120 120" class="ring-svg">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#E9D5FF" stroke-width="10" />
              <circle
                cx="60" cy="60" r="50"
                fill="none"
                stroke="#8B5CF6"
                stroke-width="10"
                stroke-linecap="round"
                :stroke-dasharray="`${activityPercent * 3.14} ${314 - activityPercent * 3.14}`"
                stroke-dashoffset="78.5"
                transform="rotate(-90 60 60)"
                class="ring-progress"
              />
              <text x="60" y="55" text-anchor="middle" class="ring-percent">{{ activityPercent }}%</text>
              <text x="60" y="72" text-anchor="middle" class="ring-label">活跃</text>
            </svg>
          </div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 32px;
  background: linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%);
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #4C1D95;
  letter-spacing: -0.5px;
}

.subtitle {
  font-size: 14px;
  color: #8B5CF6;
  font-weight: 500;
}

.status-tag {
  font-weight: 600;
}

.stats-grid {
  margin-bottom: 24px;
}

.stat-card {
  border-radius: 20px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: default;
}

.stat-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.12);
}

.stat-primary {
  background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
}
.stat-primary :deep(.n-statistic__label),
.stat-primary :deep(.n-statistic__value),
.stat-primary :deep(.n-statistic__suffix) {
  color: #fff;
}

.stat-secondary {
  background: linear-gradient(135deg, #10B981 0%, #059669 100%);
}
.stat-secondary :deep(.n-statistic__label),
.stat-secondary :deep(.n-statistic__value),
.stat-secondary :deep(.n-statistic__suffix) {
  color: #fff;
}

.stat-tertiary {
  background: #fff;
}
.stat-tertiary :deep(.n-statistic__label) {
  color: #7C3AED;
  font-weight: 600;
}
.stat-tertiary :deep(.n-statistic__value) {
  color: #4C1D95;
}
.stat-tertiary :deep(.n-statistic__suffix) {
  color: #8B5CF6;
}

.stat-quaternary {
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
}
.stat-quaternary :deep(.n-statistic__label),
.stat-quaternary :deep(.n-statistic__value),
.stat-quaternary :deep(.n-statistic__suffix) {
  color: #fff;
}

.stat-progress {
  margin-top: 8px;
}

.insight-grid {
  margin-bottom: 24px;
}

.timeline-card {
  border-radius: 20px;
  background: #fff;
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline-title {
  font-size: 16px;
  font-weight: 600;
  color: #4C1D95;
}

.timeline-subtitle {
  font-size: 12px;
  color: #A78BFA;
  font-weight: 500;
}

.empty {
  text-align: center;
  padding: 40px;
  color: #A78BFA;
  font-size: 14px;
}

.blocks-card {
  border-radius: 20px;
  background: #fff;
}

.blocks-empty {
  text-align: center;
  padding: 24px 0;
  color: #C4B5FD;
  font-size: 13px;
}

.blocks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #FAF5FF;
  transition: background 0.15s ease;
}

.block-item:hover {
  background: #F3E8FF;
}

.block-bar {
  width: 4px;
  height: 32px;
  border-radius: 2px;
  background: linear-gradient(180deg, #8B5CF6, #C4B5FD);
  flex-shrink: 0;
}

.block-info {
  flex: 1;
  min-width: 0;
}

.block-time {
  font-size: 13px;
  font-weight: 600;
  color: #4C1D95;
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
}

.block-duration {
  font-size: 11px;
  color: #8B5CF6;
  margin-top: 2px;
}

.ring-card {
  border-radius: 20px;
  background: #fff;
}

.ring-header {
  font-size: 14px;
  font-weight: 600;
  color: #4C1D95;
  margin-bottom: 12px;
}

.ring-chart {
  display: flex;
  justify-content: center;
}

.ring-svg {
  width: 140px;
  height: 140px;
}

.ring-progress {
  transition: stroke-dasharray 0.6s ease;
}

.ring-percent {
  font-size: 22px;
  font-weight: 700;
  fill: #4C1D95;
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', monospace;
}

.ring-label {
  font-size: 11px;
  fill: #8B5CF6;
  font-weight: 500;
}
</style>
