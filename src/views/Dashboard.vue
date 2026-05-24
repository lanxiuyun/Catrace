<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import {
  NCard,
  NGrid,
  NGi,
  NProgress,
  NRadioGroup,
  NRadioButton,
} from "naive-ui";
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

const totalTracked = computed(
  () => stats.value.active_minutes + stats.value.rest_minutes,
);
const activityPercent = computed(() =>
  totalTracked.value > 0
    ? Math.round((stats.value.active_minutes / totalTracked.value) * 100)
    : 0,
);

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

onMounted(async () => {
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
});
</script>

<template>
  <div class="dashboard">
    <div class="header">
      <h1 class="title">今日概览</h1>
      <span class="subtitle">{{
        new Date().toLocaleDateString("zh-CN", {
          month: "long",
          day: "numeric",
          weekday: "long",
        })
      }}</span>
    </div>

    <!-- 统计卡片 -->
    <n-grid
      :cols="4"
      :x-gap="16"
      :y-gap="16"
      class="stats-grid"
      responsive="screen"
    >
      <n-gi span="1">
        <div class="stat-card stat-active">
          <span class="stat-label">活跃</span>
          <div class="stat-value">
            {{ stats.active_minutes }}<span class="stat-unit">分钟</span>
          </div>
        </div>
      </n-gi>
      <n-gi span="1">
        <div class="stat-card stat-rest">
          <span class="stat-label">休息</span>
          <div class="stat-value">
            {{ stats.rest_minutes }}<span class="stat-unit">分钟</span>
          </div>
        </div>
      </n-gi>
      <n-gi span="1">
        <div class="stat-card stat-ratio">
          <span class="stat-label">活跃占比</span>
          <div class="stat-value">
            {{ activityPercent }}<span class="stat-unit">%</span>
          </div>
          <n-progress
            type="line"
            :percentage="activityPercent"
            :show-indicator="false"
            :height="4"
            color="#7C3AED"
            rail-color="#EDE9FE"
            class="stat-progress"
          />
        </div>
      </n-gi>
      <n-gi span="1">
        <div class="stat-card stat-blocks">
          <span class="stat-label">活跃时段</span>
          <div class="stat-value">
            {{ activeBlockCount }}<span class="stat-unit">个</span>
          </div>
        </div>
      </n-gi>
    </n-grid>

    <!-- 今日活动 -->
    <n-card class="timeline-card" :bordered="false">
      <div class="timeline-header">
        <span class="timeline-title">今日活动</span>
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
      <div v-if="records.size === 0" class="empty">
        暂无数据，程序运行一段时间后会生成。
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 32px;
  background: #faf5ff;
  min-height: 100vh;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 24px;
}

.title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #3730a3;
  letter-spacing: -0.5px;
}

.subtitle {
  font-size: 14px;
  color: #7c7caa;
  font-weight: 500;
}

.stats-grid {
  margin-bottom: 24px;
}

.stat-card {
  border-radius: 16px;
  padding: 20px 22px;
  background: #fff;
  border: 1px solid #ede9fe;
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease;
  cursor: default;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(109, 40, 217, 0.08);
}

.stat-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.5px;
}

.stat-unit {
  font-size: 14px;
  font-weight: 500;
  margin-left: 2px;
  opacity: 0.7;
}

.stat-active {
  border-top: 3px solid #7c3aed;
}
.stat-active .stat-label {
  color: #a78bfa;
}
.stat-active .stat-value {
  color: #6d28d9;
}

.stat-rest {
  border-top: 3px solid #14b8a6;
}
.stat-rest .stat-label {
  color: #5eead4;
}
.stat-rest .stat-value {
  color: #0d9488;
}

.stat-ratio {
  border-top: 3px solid #8b5cf6;
}
.stat-ratio .stat-label {
  color: #a78bfa;
}
.stat-ratio .stat-value {
  color: #6d28d9;
}

.stat-blocks {
  border-top: 3px solid #c4b5fd;
}
.stat-blocks .stat-label {
  color: #a78bfa;
}
.stat-blocks .stat-value {
  color: #7c3aed;
}

.stat-progress {
  margin-top: 12px;
}

.timeline-card {
  border-radius: 20px;
  background: #fff;
  margin-bottom: 24px;
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
  color: #3730a3;
}

.empty {
  text-align: center;
  padding: 40px;
  color: #a78bfa;
  font-size: 14px;
}
</style>
