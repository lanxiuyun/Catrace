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
  <div class="rest-panel" :class="{ 'is-disabled': !uiEnabled }">
    <header class="panel-header">
      <div class="header-left">
        <div class="icon-badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
            <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0z" />
            <path d="M5 18v2" />
            <path d="M19 18v2" />
          </svg>
        </div>
        <div class="header-text">
          <h2 class="panel-title">{{ t('plugins.rest.name') }}</h2>
          <p class="panel-subtitle">{{ t('plugins.rest.subtitle') }}</p>
        </div>
      </div>

      <div class="header-actions">
        <div class="master-switch">
          <span class="master-label">{{ t('plugins.rest.pluginStatus') }}</span>
          <n-switch
            :value="uiEnabled"
            :aria-label="t('plugins.rest.switchAria')"
            @update:value="uiEnabled = $event"
          />
        </div>
        <n-button type="primary" :loading="testing" :disabled="!uiEnabled" @click="sendTest">
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </template>
          {{ t('plugins.rest.testBtn') }}
        </n-button>
      </div>
    </header>

    <template v-if="uiEnabled">
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
      </section>
    </template>

    <div v-else class="empty-state">
      <div class="empty-icon" aria-hidden="true">🔕</div>
      <h4>{{ t('plugins.rest.name') }}</h4>
      <p>{{ t('plugins.rest.disabledHint') || t('plugins.agent.disabledHint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.rest-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.rest-panel.is-disabled .panel-section {
  opacity: 0.62;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
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
  color: #7c3aed;
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
  color: #1e1b4b;
  line-height: 1.3;
}

.panel-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.4;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.master-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.7rem;
  background: #f1f5f9;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.625rem;
}

.master-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.02rem;
}

.section-card {
  background: #fff;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.875rem;
  padding: 0.25rem 0.25rem;
  box-shadow: 0 0.0625rem 0.125rem rgba(15, 23, 42, 0.03);
}

.section-card :deep(.setting-meta) {
  width: 12rem;
  flex-shrink: 0;
  max-width: none;
}

.divider {
  height: 0.0625rem;
  background: #f1f5f9;
  margin: 0 0.75rem;
}

.empty-state {
  text-align: center;
  padding: 2.5rem 1rem;
  border-radius: 1rem;
  border: 0.0625rem dashed #e2e8f0;
  background: #fff;
}

.empty-icon {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.empty-state h4 {
  margin: 0;
  font-size: 0.875rem;
  color: #334155;
}

.empty-state p {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: #94a3b8;
}
</style>
