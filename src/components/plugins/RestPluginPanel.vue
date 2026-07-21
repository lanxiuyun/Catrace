<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NInput, useMessage } from 'naive-ui'
import { load, type Store } from '@tauri-apps/plugin-store'
import {
  getConfig,
  setConfig,
  getReminderMode,
  setReminderMode,
  getReminderText,
  setReminderText,
  testNotification,
  type AppConfig,
} from '../../api/tauri'
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import SettingRow from '../settings/SettingRow.vue'
import SliderControl from '../settings/SliderControl.vue'

const STORE_KEY = 'plugin_rest_ui_enabled'

const { t } = useI18n()
const message = useMessage()

let settingsStore: Store | null = null
async function getStore() {
  if (!settingsStore) {
    settingsStore = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return settingsStore
}

const { value: uiEnabled } = useAutoSavedSetting<boolean>({
  initialValue: true,
  load: async () => {
    const s = await getStore()
    const v = await s.get<boolean>(STORE_KEY)
    return v ?? true
  },
  save: async (v) => {
    const s = await getStore()
    await s.set(STORE_KEY, v)
  },
  debounce: 0,
})

const { value: config, loading: configLoading } = useAutoSavedSetting<AppConfig>({
  initialValue: { window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 },
  load: async () => {
    const c = await getConfig()
    return {
      window_minutes: Number(c.window_minutes) || 45,
      break_minutes: Number(c.break_minutes) || 5,
      snooze_interval_minutes: Number(c.snooze_interval_minutes) || 3,
    }
  },
  save: setConfig,
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

interface ReminderTextSettings {
  title: string
  body: string
}

const { value: reminderText } = useAutoSavedSetting<ReminderTextSettings>({
  initialValue: { title: '', body: '' },
  load: async () => {
    const rt = await getReminderText()
    return {
      title: rt.title || '',
      body: rt.body || '',
    }
  },
  save: (v) => setReminderText(v.title, v.body),
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

const customTitle = computed({
  get: () => reminderText.value.title,
  set: (v: string) => {
    reminderText.value = { ...reminderText.value, title: v }
  },
})

const customBody = computed({
  get: () => reminderText.value.body,
  set: (v: string) => {
    reminderText.value = { ...reminderText.value, body: v }
  },
})

// 当前版本久坐插件只支持 toast；遗留 popup/fullscreen 配置写回 toast
onMounted(async () => {
  try {
    const mode = await getReminderMode()
    if (mode !== 'toast') {
      await setReminderMode('toast')
    }
  } catch {
    // 启动迁移失败不挡面板
  }
})

const testing = ref(false)

async function sendTest() {
  if (testing.value) return
  testing.value = true
  try {
    await testNotification()
    message.success(t('settings.messages.notifySent'))
    // 先限流 1s，避免连点打爆 toast 窗口路径
    await new Promise<void>((r) => setTimeout(r, 1000))
  } catch {
    message.error(t('settings.messages.notifyFailed'))
  } finally {
    testing.value = false
  }
}

</script>

<template>
  <div class="rest-panel">
    <header class="panel-header">
      <div class="header-left">
        <div class="icon-badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div class="header-text">
          <h2 class="panel-title">{{ t('plugins.rest.name') }}</h2>
          <p class="panel-subtitle">{{ t('plugins.rest.subtitle') }}</p>
        </div>
      </div>
      <n-switch
        :value="uiEnabled"
        :aria-label="t('plugins.rest.switchAria')"
        @update:value="uiEnabled = $event"
      />
    </header>

    <section class="panel-section">
      <h3 class="section-title">{{ t('plugins.rest.timingSection') }}</h3>
      <div class="section-card">
        <setting-row :title="t('plugins.rest.windowTitle')" :desc="t('plugins.rest.windowDesc')">
          <slider-control
            v-model:model-value="config.window_minutes"
            :min="10"
            :max="120"
            :step="5"
            :disabled="configLoading"
            :suffix="' ' + t('common.minutes')"
          />
        </setting-row>
        <div class="divider" />
        <setting-row :title="t('plugins.rest.breakTitle')" :desc="t('plugins.rest.breakDesc')">
          <slider-control
            v-model:model-value="config.break_minutes"
            :min="1"
            :max="30"
            :step="1"
            :disabled="configLoading"
            :suffix="' ' + t('common.minutes')"
          />
        </setting-row>
        <div class="divider" />
        <setting-row :title="t('plugins.rest.snoozeTitle')" :desc="t('plugins.rest.snoozeDesc')">
          <slider-control
            v-model:model-value="config.snooze_interval_minutes"
            :min="1"
            :max="10"
            :step="1"
            :disabled="configLoading"
            :suffix="' ' + t('common.minutes')"
          />
        </setting-row>
      </div>
    </section>

    <section class="panel-section">
      <h3 class="section-title">{{ t('plugins.rest.contentSection') }}</h3>
      <div class="section-card">
        <setting-row :title="t('plugins.rest.customTitle')" :desc="t('plugins.rest.customTitleDesc')" style="align-items: flex-start;">
          <n-input
            v-model:value="customTitle"
            :placeholder="t('plugins.rest.previewDefaultTitle')"
            size="small"
            style="width: 13.75rem;"
          />
        </setting-row>
        <div class="divider" />
        <setting-row :title="t('plugins.rest.customBody')" :desc="t('plugins.rest.customBodyDesc')" style="align-items: flex-start;">
          <n-input
            v-model:value="customBody"
            :placeholder="t('plugins.rest.previewDefaultBody')"
            type="textarea"
            :rows="2"
            size="small"
            style="width: 13.75rem;"
          />
        </setting-row>
      </div>
      <div class="test-actions">
        <n-button type="primary" :loading="testing" @click="sendTest">
          {{ t('plugins.rest.testBtn') }}
        </n-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rest-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

.icon-badge {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  background: #ede9fe;
  color: #6d28d9;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.header-text {
  min-width: 0;
}

.panel-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #2e1065;
  line-height: 1.3;
}

.panel-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #8b7aab;
  line-height: 1.4;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.section-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #8b7aab;
  text-transform: uppercase;
  letter-spacing: 0.03rem;
}

.section-card {
  background: #fafaff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  padding: 0.25rem 0.25rem;
}

.section-card :deep(.setting-meta) {
  width: 12rem;
  flex-shrink: 0;
  max-width: none;
}

.divider {
  height: 0.0625rem;
  background: #f5f3ff;
  margin: 0 0.75rem;
}

.test-actions {
  display: flex;
  justify-content: flex-start;
  padding: 0.75rem 0.25rem 0;
}
</style>
