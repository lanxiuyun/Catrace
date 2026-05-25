<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { NCard, NRadioGroup, NRadioButton } from "naive-ui";
import { getTodayStats, getTodayRecords, getConfig } from "../api/tauri";
import Timeline from "../components/Timeline.vue";
import TimelineWindows from "../components/TimelineWindows.vue";
import type { MinuteData } from "../components/Timeline.vue";
import { computeTimeBlocks } from "../utils/timeBlocks";

const stats = ref({ active_minutes: 0, rest_minutes: 0 });
const records = ref<Map<number, boolean>>(new Map());
const config = ref({ window_minutes: 45, break_minutes: 5 });
const timelineMode = ref<"grid" | "segments">("segments");

function startOfDayTs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

const allMinutes = computed<MinuteData[]>(() => {
  const dayStart = startOfDayTs();
  const result: MinuteData[] = [];
  for (let i = 0; i < 1440; i++) {
    const ts = dayStart + i * 60;
    const active = records.value.has(ts) ? records.value.get(ts)! : null;
    result.push({ ts, active });
  }
  return result;
});

// 按 block 语义重新计算活跃/休息时间：
// 活跃 block 的全部时长算活跃；休息 block 里只有实际活跃的分钟算活跃，其余算休息
const blockStats = computed(() => {
  const dayStart = startOfDayTs();
  const now = Math.floor(Date.now() / 1000);
  const nowIdx = Math.max(
    0,
    Math.min(1439, Math.floor((now - dayStart) / 60)),
  );
  const blocks = computeTimeBlocks(
    allMinutes.value,
    config.value.window_minutes,
    config.value.break_minutes,
    nowIdx,
  );

  let activeMinutes = 0;
  let restMinutes = 0;

  for (const b of blocks) {
    if (b.active === null) continue; // 无记录前缀，不计入
    if (b.active === true) {
      // 活跃 block：全部算活跃
      activeMinutes += b.endIdx - b.startIdx;
    } else {
      // 休息 block：逐分钟判断
      for (const m of b.minutes) {
        if (m.active === true) {
          activeMinutes += 1;
        } else {
          restMinutes += 1;
        }
      }
    }
  }

  return { activeMinutes, restMinutes };
});

const activityPercent = computed(() => {
  const total = blockStats.value.activeMinutes + blockStats.value.restMinutes;
  return total > 0 ? Math.round((blockStats.value.activeMinutes / total) * 100) : 0;
});

const activeBlockCount = computed(() => {
  const now = Math.floor(Date.now() / 1000);
  const nowIdx = Math.max(
    0,
    Math.min(1439, Math.floor((now - startOfDayTs()) / 60)),
  );
  const blocks = computeTimeBlocks(
    allMinutes.value,
    config.value.window_minutes,
    config.value.break_minutes,
    nowIdx,
  );
  return blocks.filter((b) => b.active === true).length;
});

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

async function loadData() {
  try {
    const c = await getConfig();
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
    };
    stats.value = await getTodayStats();
    const raw = await getTodayRecords();
    const map = new Map<number, boolean>();
    for (const [ts, active] of raw) {
      map.set(ts, active);
    }
    records.value = map;
  } catch (e) {
    console.error("获取数据失败", e);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  loadData();
  pollTimer = setInterval(loadData, 10000);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<template>
  <div class="dashboard">
    <header class="header">
      <h1 class="title">今日统计</h1>
      <p class="subtitle">
        {{
          new Date().toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          })
        }}
      </p>
    </header>

    <section class="stats">
      <div class="stat stat-active">
        <div class="stat-head">
          <span class="dot dot-active" />
          <span class="stat-label">活跃</span>
        </div>
        <p class="stat-value">
          {{ fmtDuration(blockStats.activeMinutes) }}
        </p>
      </div>
      <div class="stat stat-rest">
        <div class="stat-head">
          <span class="dot dot-rest" />
          <span class="stat-label">休息</span>
        </div>
        <p class="stat-value">
          {{ fmtDuration(blockStats.restMinutes) }}
        </p>
      </div>
      <div class="stat stat-ratio">
        <div class="stat-head">
          <span class="dot dot-ratio" />
          <span class="stat-label">活跃占比</span>
        </div>
        <p class="stat-value">
          {{ activityPercent }}<span class="stat-unit">%</span>
        </p>
      </div>
      <div class="stat stat-blocks">
        <div class="stat-head">
          <span class="dot dot-muted" />
          <span class="stat-label">活跃时段</span>
        </div>
        <p class="stat-value">
          {{ activeBlockCount }}<span class="stat-unit">个</span>
        </p>
      </div>
    </section>

    <n-card class="panel" :bordered="false">
      <div class="panel-header">
        <h2 class="panel-title">今日活动</h2>
        <n-radio-group v-model:value="timelineMode" size="small">
          <n-radio-button value="segments">概览</n-radio-button>
          <n-radio-button value="grid">详细</n-radio-button>
        </n-radio-group>
      </div>
      <Timeline v-if="timelineMode === 'grid'" :minutes="allMinutes" />
      <TimelineWindows
        v-else
        :minutes="allMinutes"
        :window-minutes="config.window_minutes"
        :break-minutes="config.break_minutes"
      />
      <p v-if="records.size === 0" class="empty">
        暂无数据，程序运行一段时间后会生成。
      </p>
    </n-card>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 28px 32px;
}

.header {
  margin-bottom: 22px;
}

.title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #2e1065;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8b7aab;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

@media (max-width: 960px) {
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .stats {
    grid-template-columns: 1fr;
  }
}

.stat {
  background: #fff;
  border: 1px solid #ebe6f2;
  border-radius: 12px;
  padding: 9px 10px;
  box-shadow: 0 1px 3px rgba(46, 16, 101, 0.04);
}

.stat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-active {
  background: #7c3aed;
}
.dot-rest {
  background: #059669;
}
.dot-ratio {
  background: #a78bfa;
}
.dot-muted {
  background: #c4b5fd;
}

.stat-label {
  font-size: 13px;
  color: #8b7aab;
  font-weight: 500;
}

.stat-value {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.stat-unit {
  font-size: 14px;
  font-weight: 500;
  margin-left: 3px;
  opacity: 0.55;
}

.stat-active .stat-value {
  color: #6d28d9;
}
.stat-rest .stat-value {
  color: #047857;
}
.stat-ratio .stat-value,
.stat-blocks .stat-value {
  color: #4c1d95;
}

.panel {
  border-radius: 12px !important;
  border: 1px solid #ebe6f2 !important;
  box-shadow: 0 1px 3px rgba(46, 16, 101, 0.04) !important;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  gap: 12px;
}

.panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #2e1065;
}

.empty {
  margin: 32px 0 0;
  text-align: center;
  font-size: 13px;
  color: #a1a1aa;
}
</style>
