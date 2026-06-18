<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getWaterStats, recordWater } from '../api/tauri'

const { t } = useI18n()

const count = ref(0)
const lastTs = ref<number | null>(null)
const loading = ref(false)

function fmtLast(ts: number | null): string {
  if (!ts) return t('water.lastDrank')
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return t('water.justNow')
  const minutes = Math.floor(diff / 60)
  if (minutes < 60) return t('water.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  return t('water.hoursAgo', { n: hours })
}

const lastLabel = computed(() => fmtLast(lastTs.value))

async function load() {
  try {
    const stats = await getWaterStats()
    count.value = stats.count
    lastTs.value = stats.last_ts
  } catch (e) {
    console.error('Failed to load water stats', e)
  }
}

async function addDrink() {
  loading.value = true
  try {
    await recordWater(Math.floor(Date.now() / 1000))
    await load()
  } catch (e) {
    console.error('Failed to record water', e)
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  load()
  timer = setInterval(load, 30000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="water-widget">
    <div class="water-head">
      <div class="water-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"/>
        </svg>
      </div>
      <span class="water-label">{{ t('water.todayCount') }}</span>
    </div>
    <div class="water-main">
      <div class="water-count">{{ count }}</div>
      <button class="water-add" :disabled="loading" @click="addDrink" :title="t('water.add')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
    <div class="water-last">{{ lastLabel }}</div>
  </div>
</template>

<style scoped>
.water-widget {
  background: #fff;
  border: 1px solid #ebe6f2;
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(46, 16, 101, 0.04);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 140px;
}
.water-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.water-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #eff6ff;
  color: #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.water-label {
  font-size: 13px;
  color: #8b7aab;
  font-weight: 500;
}
.water-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.water-count {
  font-size: 28px;
  font-weight: 700;
  color: #2563eb;
  line-height: 1;
}
.water-add {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: #eff6ff;
  color: #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.water-add:hover {
  background: #dbeafe;
}
.water-add:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.water-last {
  font-size: 12px;
  color: #8b7aab;
  min-height: 18px;
}
</style>
