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
import { getVideoDebugInfo, type VideoDebugInfo, getToastDebugMode, setToastDebugMode } from '../api/tauri'

const { t } = useI18n()

const data = ref<VideoDebugInfo | null>(null)
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
    data.value = await getVideoDebugInfo()
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
              {{ data.media_active ? t('debug.videoActiveTrue') : 'false' }}
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

      <!-- GSMTCSM -->
      <n-card :title="t('debug.gsmtcsm')" size="small">
        <n-space vertical :size="12">
          <n-descriptions :column="3" size="small" bordered>
            <n-descriptions-item :label="t('debug.available')">
              <n-tag :type="data.gsmtcsm_available ? 'success' : 'error'">
                {{ data.gsmtcsm_available ? t('debug.yes') : t('debug.no') }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item :label="t('debug.sessionCount')">{{ data.gsmtcsm_session_count }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.hasPlaying')">
              <n-tag :type="data.gsmtcsm_has_playing ? 'success' : 'default'">
                {{ data.gsmtcsm_has_playing ? t('debug.yes') : t('debug.no') }}
              </n-tag>
            </n-descriptions-item>
          </n-descriptions>

          <n-text v-if="data.gsmtcsm_error" type="error">
            {{ t('debug.errorPrefix') }}{{ data.gsmtcsm_error }}
          </n-text>

          <n-table v-if="data.gsmtcsm_sessions.length > 0" :single-line="false" size="small">
            <thead>
              <tr>
                <th>{{ t('debug.table.title') }}</th>
                <th>{{ t('debug.table.artist') }}</th>
                <th>{{ t('debug.table.status') }}</th>
                <th>{{ t('debug.table.type') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in data.gsmtcsm_sessions" :key="i">
                <td>{{ s.title }}</td>
                <td>{{ s.artist }}</td>
                <td>
                  <n-tag :type="s.status === 'Playing' ? 'success' : 'default'" size="small">
                    {{ s.status }}
                  </n-tag>
                </td>
                <td>{{ s.playback_type }}</td>
              </tr>
            </tbody>
          </n-table>

          <n-empty v-else-if="!data.gsmtcsm_error" :description="t('debug.noMediaSessions')" size="small" />
        </n-space>
      </n-card>

      <!-- 焦点窗口 -->
      <n-card :title="t('debug.focusWindow')" size="small">
        <n-space vertical :size="12">
          <n-descriptions :column="1" size="small" bordered>
            <n-descriptions-item :label="t('debug.windowTitle')">{{ data.focus_window_title }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.appName')">{{ data.focus_app_name }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.processPath')">{{ data.focus_process_path }}</n-descriptions-item>
            <n-descriptions-item :label="t('debug.keywordMatch')">
              <n-tag :type="data.keyword_matched ? 'success' : 'default'">
                {{ data.keyword_matched ? t('debug.yes') : t('debug.no') }}
              </n-tag>
              <n-text v-if="data.matched_keyword" depth="3" style="margin-left: 8px;">
                {{ t('debug.matchedPrefix') }}{{ data.matched_keyword }}
              </n-text>
            </n-descriptions-item>
          </n-descriptions>
        </n-space>
      </n-card>
      </template>
    </n-space>
  </div>
</template>

<style scoped>
.debug-page {
  padding: 24px;
  max-width: 900px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  color: #2e1065;
}

.result-item {
  text-align: center;
}

.result-label {
  font-size: 12px;
  color: #8b7aab;
  margin-bottom: 6px;
}

.debug-switch-label {
  font-size: 13px;
  color: #6b5b8a;
}
</style>
