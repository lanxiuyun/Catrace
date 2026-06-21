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
} from 'naive-ui'
import { getMediaDebugInfo, type MediaDebugInfo, getToastDebugMode, setToastDebugMode } from '../api/tauri'

const { t } = useI18n()

const data = ref<MediaDebugInfo | null>(null)
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const toastDebugMode = ref(false)
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

async function refresh(manual = false) {
  if (manual) loading.value = true
  errorMsg.value = null
  try {
    data.value = await getMediaDebugInfo()
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
})
</script>

<template>
  <div class="debug-page">
    <div class="page-header">
      <h2>{{ t('debug.title') }}</h2>
      <n-space align="center" :size="16">
        <n-space align="center" :size="8">
          <span class="debug-switch-label">Toast 调试背景</span>
          <n-switch :value="toastDebugMode" @update:value="toggleToastDebugMode" />
        </n-space>
        <n-button size="small" :loading="loading" @click="refresh(true)">{{ t('debug.refresh') }}</n-button>
      </n-space>
    </div>

    <n-space vertical :size="16">
      <n-alert v-if="errorMsg" type="error" :show-icon="true">
        {{ errorMsg }}
      </n-alert>

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
  padding: 1.5rem;
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

.result-item {
  text-align: center;
}

.result-label {
  font-size: 0.75rem;
  color: #8b7aab;
  margin-bottom: 0.375rem;
}

.debug-switch-label {
  font-size: 0.8125rem;
  color: #6b5b8a;
}
</style>
