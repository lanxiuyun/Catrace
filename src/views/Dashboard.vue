<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NCard, NStatistic, NGrid, NGi } from 'naive-ui'
import { getTodayStats, getTodayRecords, getConfig } from '../api/tauri'
import Timeline from '../components/Timeline.vue'
import type { MinuteData } from '../components/Timeline.vue'

const stats = ref({ active_minutes: 0, rest_minutes: 0 })
const records = ref<Map<number, boolean>>(new Map())
const config = ref({ window_minutes: 45, break_minutes: 5 })

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
      <h1 class="title">今日概览</h1>
    </div>

    <n-grid :cols="2" :x-gap="16" class="stats-grid">
      <n-gi>
        <n-card class="stat-card stat-active">
          <n-statistic label="活跃" :value="stats.active_minutes">
            <template #suffix>分钟</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card class="stat-card stat-rest">
          <n-statistic label="休息" :value="stats.rest_minutes">
            <template #suffix>分钟</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card class="timeline-card">
      <div class="timeline-header">
        <span class="timeline-title">24小时时间轴</span>
        <span class="timeline-subtitle">每一分钟 · {{ allMinutes.filter(m => m.active !== null).length }} 条记录</span>
      </div>
      <Timeline :minutes="allMinutes" />
      <div v-if="records.size === 0" class="empty">
        暂无数据，程序运行一段时间后会生成。
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 32px;
  background: #f8f9fa;
  min-height: 100vh;
}

.header {
  margin-bottom: 24px;
}

.title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
}

.stats-grid {
  margin-bottom: 24px;
}

.stat-card {
  border-radius: 16px;
  transition: transform 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-active :deep(.n-statistic__label) {
  color: #10b981;
  font-weight: 600;
}

.stat-rest :deep(.n-statistic__label) {
  color: #3b82f6;
  font-weight: 600;
}

.stat-active :deep(.n-statistic__value) {
  color: #10b981;
}

.stat-rest :deep(.n-statistic__value) {
  color: #3b82f6;
}

.timeline-card {
  border-radius: 16px;
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
  color: #1a1a2e;
}

.timeline-subtitle {
  font-size: 12px;
  color: #9ca3af;
}

.empty {
  text-align: center;
  padding: 40px;
  color: #999;
  font-size: 14px;
}
</style>
