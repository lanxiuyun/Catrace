<script setup lang="ts">
import { ref, onActivated, onDeactivated } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NSpace,
  NTag,
  NButton,
  NEmpty,
  NDescriptions,
  NDescriptionsItem,
  NTable,
  NText,
  NAlert,
  NSwitch,
  NInputNumber,
} from 'naive-ui'
import {
  getMediaDebugInfo,
  type MediaDebugInfo,
  getToastDebugMode,
  setToastDebugMode,
  startNotificationTest,
  stopNotificationTest,
  getRecentSignalMinutes,
  getSignalRuntimeConfig,
  type SignalMinuteRecord,
  type SignalRuntimeConfig,
} from '../api/tauri'

const { t } = useI18n()

const data = ref<MediaDebugInfo | null>(null)
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const toastDebugMode = ref(false)
const testRunning = ref(false)
const testInterval = ref(15)
const signalMinutes = ref<SignalMinuteRecord[]>([])
const signalRuntime = ref<SignalRuntimeConfig | null>(null)
const signalError = ref<string | null>(null)
let mounted = true
let timer: ReturnType<typeof setTimeout> | null = null

async function loadToastDebugMode() {
  try {
    toastDebugMode.value = await getToastDebugMode()
  } catch (e: any) {
    console.error(e)
  }
}

async function toggleToastDebugMode(value: boolean) {
  try {
    await setToastDebugMode(value)
    toastDebugMode.value = value
  } catch (e: any) {
    console.error(e)
  }
}

async function startTest() {
  try {
    await startNotificationTest(testInterval.value)
    testRunning.value = true
  } catch (e: any) {
    console.error(e)
  }
}

async function stopTest() {
  try {
    await stopNotificationTest()
    testRunning.value = false
  } catch (e: any) {
    console.error(e)
  }
}

function formatMinuteTs(ts: number): string {
  // signal_minutes.timestamp = bucket_start + 60 (bucket end)
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function mouseSlotsFilled(json: string | null): string {
  if (!json) return '—'
  try {
    const arr = JSON.parse(json) as Array<number | null>
    if (!Array.isArray(arr)) return '—'
    const filled = arr.filter((v) => v !== null && v !== undefined).length
    return `${filled}/60`
  } catch {
    return '—'
  }
}

function formatDistance(px: number): string {
  if (!Number.isFinite(px)) return '—'
  if (px >= 1000) return `${(px / 1000).toFixed(1)}k`
  return String(Math.round(px))
}

async function refresh(manual = false) {
  if (manual) loading.value = true
  errorMsg.value = null
  signalError.value = null
  try {
    const [media, minutes, runtime] = await Promise.all([
      getMediaDebugInfo(),
      getRecentSignalMinutes(12),
      getSignalRuntimeConfig(),
    ])
    data.value = media
    signalMinutes.value = minutes
    signalRuntime.value = runtime
  } catch (e: any) {
    errorMsg.value = e?.message || String(e)
    console.error(e)
  } finally {
    if (manual) loading.value = false
  }
}

function startRefreshLoop() {
  refresh(false).finally(() => {
    if (mounted) {
      timer = setTimeout(startRefreshLoop, 2000)
    }
  })
}

onActivated(() => {
  mounted = true
  startRefreshLoop()
  loadToastDebugMode()
})

onDeactivated(() => {
  mounted = false
  if (timer) clearTimeout(timer)
  stopTest()
})
</script>

<template>
  <div class="debug-page">
    <div class="page-header">
      <h2>{{ t('debug.title') }}</h2>
      <div class="header-actions">
        <n-space align="center" :size="8">
          <span class="debug-switch-label">Toast 调试背景</span>
          <n-switch :value="toastDebugMode" @update:value="toggleToastDebugMode" />
        </n-space>
        <n-button size="small" :loading="loading" @click="refresh(true)">{{ t('debug.refresh') }}</n-button>
      </div>
    </div>

    <n-space vertical :size="16">
      <n-alert v-if="errorMsg" type="error" :show-icon="true">
        {{ errorMsg }}
      </n-alert>

      <n-card :title="t('debug.notificationTest.title')" size="small">
        <n-space align="center" :size="16">
          <n-space align="center" :size="8">
            <span class="debug-switch-label">{{ t('debug.notificationTest.interval') }}</span>
            <n-input-number
              v-model:value="testInterval"
              :min="1"
              :disabled="testRunning"
              style="width: 7rem"
            >
              <template #suffix>{{ t('debug.notificationTest.seconds') }}</template>
            </n-input-number>
          </n-space>
          <n-button
            v-if="!testRunning"
            size="small"
            type="primary"
            @click="startTest"
          >{{ t('debug.notificationTest.start') }}</n-button>
          <n-button
            v-else
            size="small"
            type="error"
            @click="stopTest"
          >{{ t('debug.notificationTest.stop') }}</n-button>
        </n-space>
      </n-card>

      <n-card :title="t('debug.signal.title')" size="small">
        <n-space vertical :size="12">
          <n-alert v-if="signalError" type="warning" :show-icon="true">
            {{ signalError }}
          </n-alert>

          <n-descriptions v-if="signalRuntime" :column="3" size="small" bordered>
            <n-descriptions-item :label="t('debug.signal.keySeq')">
              <n-tag :type="signalRuntime.key_sequence_enabled ? 'warning' : 'default'" size="small">
                {{ signalRuntime.key_sequence_enabled ? t('debug.yes') : t('debug.no') }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.signal.retention')">
              {{ signalRuntime.retention_hours }}h
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.signal.pending')">
              {{ (signalRuntime.snapshot?.pending_buckets as number) ?? 0 }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.signal.curMinute')">
              {{ signalRuntime.snapshot?.minute_ts ? formatMinuteTs(Number(signalRuntime.snapshot.minute_ts) + 60) : '—' }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.signal.curKeys')">
              {{ signalRuntime.snapshot?.key_count ?? 0 }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.signal.curMouse')">
              {{ formatDistance(Number(signalRuntime.snapshot?.mouse_distance_px ?? 0)) }} px
            </n-descriptions-item>
          </n-descriptions>

          <n-table v-if="signalMinutes.length > 0" :single-line="false" size="small">
            <thead>
              <tr>
                <th>{{ t('debug.signal.colTime') }}</th>
                <th>{{ t('debug.signal.colApp') }}</th>
                <th>{{ t('debug.signal.colFg') }}</th>
                <th>{{ t('debug.signal.colKeys') }}</th>
                <th>{{ t('debug.signal.colSeq') }}</th>
                <th>{{ t('debug.signal.colMouse') }}</th>
                <th>{{ t('debug.signal.colSlots') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in signalMinutes" :key="row.timestamp">
                <td>{{ formatMinuteTs(row.timestamp) }}</td>
                <td class="signal-app">{{ row.dominant_process_name || '—' }}</td>
                <td>{{ row.foreground_sample_count }}</td>
                <td>{{ row.key_count }}</td>
                <td>
                  <n-tag v-if="row.key_sequence_json" type="warning" size="small">
                    {{ t('debug.signal.seqOn') }}
                  </n-tag>
                  <n-tag v-else size="small">{{ t('debug.signal.seqOff') }}</n-tag>
                </td>
                <td>{{ formatDistance(row.mouse_distance_px) }}</td>
                <td>{{ mouseSlotsFilled(row.mouse_seconds_json) }}</td>
              </tr>
            </tbody>
          </n-table>
          <n-empty v-else :description="t('debug.signal.empty')" size="small" />
          <n-text depth="3" class="signal-hint">{{ t('debug.signal.hint') }}</n-text>
        </n-space>
      </n-card>

      <template v-if="data">
      <!-- 最终判定 -->
      <n-card :title="t('debug.finalResult')" size="small">
        <n-space align="center" :size="24">
          <div class="result-item">
            <div class="result-label">{{ t('debug.mediaActive') }}</div>
            <n-tag :type="data.media_active ? 'success' : 'default'" size="large">
              {{ data.media_active ? t('debug.mediaActiveTrue') : 'false' }}
            </n-tag>
          </div>
          <div class="result-item">
            <div class="result-label">{{ t('debug.mkCount') }}</div>
            <n-tag size="large">{{ data.mouse_keyboard_count }}</n-tag>
          </div>
          <div class="result-item">
            <div class="result-label">{{ t('debug.estimatedStatus') }}</div>
            <n-tag :type="data.mouse_keyboard_count >= 3 || data.media_active ? 'success' : 'default'" size="large">
              {{ data.mouse_keyboard_count >= 3 || data.media_active ? t('timeline.active') : t('timeline.rest') }}
            </n-tag>
          </div>
        </n-space>
      </n-card>

      <!-- 音频会话 -->
      <n-card :title="t('debug.audioSessions')" size="small">
        <n-space vertical :size="12">
          <n-descriptions :column="3" size="small" bordered>
            <n-descriptions-item :label="t('debug.available')">
              <n-tag :type="data.audio_error ? 'error' : 'success'">
                {{ data.audio_error ? t('debug.no') : t('debug.yes') }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.sessionCount')">{{ data.audio_sessions.length }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.audioActive')">
              <n-tag :type="data.audio_active ? 'success' : 'default'">
                {{ data.audio_active ? t('debug.yes') : t('debug.no') }}
              </n-tag>
            </n-descriptions-item>
          </n-descriptions>

          <n-text v-if="data.audio_error" type="error">
            {{ t('debug.errorPrefix') }}{{ data.audio_error }}
          </n-text>

          <n-table v-if="data.audio_sessions.length > 0" :single-line="false" size="small">
            <thead>
              <tr>
                <th>{{ t('debug.processName') }}</th>
                <th>PID</th>
                <th>{{ t('debug.peak') }}</th>
                <th>{{ t('debug.whitelisted') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in data.audio_sessions" :key="i">
                <td>{{ s.process_name }}</td>
                <td>{{ s.pid }}</td>
                <td>{{ s.peak.toFixed(4) }}</td>
                <td>
                  <n-tag :type="s.whitelisted ? 'success' : 'default'" size="small">
                    {{ s.whitelisted ? t('debug.yes') : t('debug.no') }}
                  </n-tag>
                </td>
              </tr>
            </tbody>
          </n-table>

          <n-empty v-else-if="!data.audio_error" :description="t('debug.noAudioSessions')" size="small" />
        </n-space>
      </n-card>

      <!-- 焦点窗口 -->
      <n-card :title="t('debug.focusWindow')" size="small">
        <n-space vertical :size="12">
          <n-descriptions :column="1" size="small" bordered>
            <n-descriptions-item :label="t('debug.windowTitle')">{{ data.focus_window_title }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.appName')">{{ data.focus_app_name }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.processPath')">{{ data.focus_process_path }}</n-descriptions-item>
          </n-descriptions>
        </n-space>
      </n-card>
      </template>
    </n-space>
  </div>
</template>

<style scoped>
.debug-page {
  padding: 1.25rem;
  max-width: 56.25rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.page-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: #2e1065;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.debug-switch-label {
  font-size: 0.8125rem;
  color: #6b5b8a;
}

.result-item {
  text-align: center;
}

.result-label {
  font-size: 0.75rem;
  color: #8b7aab;
  margin-bottom: 0.375rem;
}

.signal-app {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.signal-hint {
  font-size: 0.75rem;
}
</style>
