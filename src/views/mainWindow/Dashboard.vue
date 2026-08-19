<script setup lang="ts">
import { ref, onActivated, onDeactivated, computed } from "vue";
import { useI18n } from 'vue-i18n'
import { NCard, NRadioGroup, NRadioButton, NSwitch } from "naive-ui";
import { getTodayStats, getTodayRecords, getConfig, getHideStats, setHideStats } from "../../api/tauri";
import Timeline from "../../components/Timeline.vue";
import TimelineWindows from "../../components/TimelineWindows.vue";
import PageScroll from '../../components/PageScroll.vue'
import type { MinuteData } from "../../components/Timeline.vue";
import { computeTimeBlocks } from "../../utils/timeBlocks";

const { t, locale } = useI18n()

const stats = ref({ active_minutes: 0, rest_minutes: 0 });
const records = ref<Map<number, boolean>>(new Map());
const config = ref({ window_minutes: 45, break_minutes: 5 });
const timelineMode = ref<"grid" | "segments">("segments");
const hideStats = ref(false);

// —— 顶部致谢小彩蛋 ——
const eggVisible = ref(false)
let eggTimer: ReturnType<typeof setTimeout> | null = null
const EGG_HOVER_DELAY = 500 // hover 后到开始淡入前的等待时长
const EGG_FADE_OUT_DELAY = 500 // 鼠标移出后到开始淡出之间的停留时长（淡入/淡出渐变均由 CSS transition 控制，0.9s）

function showEgg() {
  if (eggTimer) clearTimeout(eggTimer)
  // 悬停满 500ms 后才淡入
  eggTimer = setTimeout(() => {
    eggVisible.value = true
    eggTimer = null
  }, EGG_HOVER_DELAY)
}

function hideEgg() {
  if (eggTimer) clearTimeout(eggTimer)
  // 移出后停留片刻，再缓缓淡出
  eggTimer = setTimeout(() => {
    eggVisible.value = false
    eggTimer = null
  }, EGG_FADE_OUT_DELAY)
}

async function toggleHideStats(val: boolean) {
  try {
    await setHideStats(val);
    hideStats.value = val;
  } catch (e) {
    console.error("Failed to set hide stats", e);
    hideStats.value = !val;
  }
}

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
    const [c, hs] = await Promise.all([getConfig(), getHideStats()]);
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
    };
    hideStats.value = hs;
    stats.value = await getTodayStats();
    const raw = await getTodayRecords();
    const map = new Map<number, boolean>();
    for (const [ts, active] of raw) {
      map.set(ts, active);
    }
    records.value = map;
  } catch (e) {
    console.error("Failed to load data", e);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

onActivated(() => {
  loadData();
  if (!pollTimer) {
    pollTimer = setInterval(loadData, 10000);
  }
});

onDeactivated(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (eggTimer) {
    clearTimeout(eggTimer);
    eggTimer = null;
  }
  eggVisible.value = false;
});
</script>

<template>
  <page-scroll>
    <div class="dashboard">
    <div class="egg-toast" :class="{ 'egg-toast--visible': eggVisible }" aria-hidden="true" @mouseenter="showEgg" @mouseleave="hideEgg">
      <span class="demo-thanks">{{ t('dashboard.thanks') }}</span>
    </div>
    <header class="header">
      <p class="subtitle">
        {{
          new Date().toLocaleDateString(locale, {
            month: "long",
            day: "numeric",
            weekday: "long",
          })
        }}
      </p>
      <div class="header-actions">
        <span class="hide-stats-label">{{ t('dashboard.hideStats.label') }}</span>
        <n-switch
          :value="hideStats"
          size="small"
          @update:value="toggleHideStats"
        />
      </div>
    </header>

    <section v-show="!hideStats" class="stats">
      <div class="stat stat-active">
        <div class="stat-head">
          <span class="dot dot-active" />
          <span class="stat-label">{{ t('dashboard.stats.active') }}</span>
        </div>
        <p class="stat-value">
          {{ fmtDuration(blockStats.activeMinutes) }}
        </p>
      </div>
      <div class="stat stat-rest">
        <div class="stat-head">
          <span class="dot dot-rest" />
          <span class="stat-label">{{ t('dashboard.stats.rest') }}</span>
        </div>
        <p class="stat-value">
          {{ fmtDuration(blockStats.restMinutes) }}
        </p>
      </div>
      <div class="stat stat-ratio">
        <div class="stat-head">
          <span class="dot dot-ratio" />
          <span class="stat-label">{{ t('dashboard.stats.ratio') }}</span>
        </div>
        <p class="stat-value">
          {{ activityPercent }}<span class="stat-unit">%</span>
        </p>
      </div>
      <div class="stat stat-blocks">
        <div class="stat-head">
          <span class="dot dot-muted" />
          <span class="stat-label">{{ t('dashboard.stats.blocks') }}</span>
        </div>
        <p class="stat-value">
          {{ activeBlockCount }}<span v-if="t('dashboard.stats.blocksUnit')" class="stat-unit">{{ t('dashboard.stats.blocksUnit') }}</span>
        </p>
      </div>
    </section>


    <n-card class="panel" :bordered="false">
      <div class="panel-header">
        <h2 class="panel-title">{{ t('dashboard.activity.title') }}</h2>
        <n-radio-group v-model:value="timelineMode" size="small">
          <n-radio-button value="segments">{{ t('dashboard.activity.overview') }}</n-radio-button>
          <n-radio-button value="grid">{{ t('dashboard.activity.detailed') }}</n-radio-button>
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
        {{ t('dashboard.activity.empty') }}
      </p>
    </n-card>
    </div>
  </page-scroll>
</template>

<style scoped>
.dashboard {
  position: relative;
  padding: 1.25rem;
}

/* toast：居中停在内容顶部，hit 区域就是文字本体，hover 到字上才淡入，移出后延迟淡出 */
.egg-toast {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  padding-top: 0.3125rem;
  z-index: 20;
  opacity: 0;
  transition: opacity 0.9s ease;
}

.egg-toast--visible {
  opacity: 1;
}

.demo-thanks {
  font-size: 0.8125rem;
  font-weight: 500;
  color: #6d28d9;
  white-space: nowrap;
  user-select: none;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.hide-stats-label {
  font-size: 0.75rem;
  color: #8b7aab;
  white-space: nowrap;
}

.subtitle {
  margin: 0;
  font-size: 0.8125rem;
  color: #8b7aab;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

@media (max-width: 30rem) {
  .stats {
    grid-template-columns: 1fr;
  }
}

.widget-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13.75rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
  align-items: stretch;
}

.widget-card {
  min-width: 0;
}

.stat {
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.75rem;
  padding: 0.375rem 0.5rem;
  box-shadow: 0 0.0625rem 0.1875rem rgba(46, 16, 101, 0.04);
}

.stat-head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.375rem;
}

.dot {
  width: 0.4375rem;
  height: 0.4375rem;
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
  font-size: 0.75rem;
  color: #8b7aab;
  font-weight: 500;
}

.stat-value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.stat-unit {
  font-size: 0.75rem;
  font-weight: 500;
  margin-left: 0.1875rem;
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
  border-radius: 0.75rem !important;
  border: 0.0625rem solid #ebe6f2 !important;
  box-shadow: 0 0.0625rem 0.1875rem rgba(46, 16, 101, 0.04) !important;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
  gap: 0.75rem;
}

.panel-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #2e1065;
}

.empty {
  margin: 2rem 0 0;
  text-align: center;
  font-size: 0.8125rem;
  color: #a1a1aa;
}
</style>
