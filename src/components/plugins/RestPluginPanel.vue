<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NInput, NSlider, useMessage } from 'naive-ui'
import {
  getConfig,
  setConfig,
  setRestPluginEnabled,
  getReminderText,
  setReminderText,
  testNotification,
  type AppConfig,
} from '../../api/tauri'
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import PluginSection from './PluginSection.vue'

const { t } = useI18n()
const message = useMessage()

const { value: config, loading: configLoading } = useAutoSavedSetting<AppConfig>({
  initialValue: { enabled: true, window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 },
  load: async () => {
    const c = await getConfig()
    return {
      enabled: c.enabled ?? true,
      window_minutes: Number(c.window_minutes) || 45,
      break_minutes: Number(c.break_minutes) || 5,
      snooze_interval_minutes: Number(c.snooze_interval_minutes) || 3,
    }
  },
  save: async (value) => {
    await setConfig({
      window_minutes: value.window_minutes,
      break_minutes: value.break_minutes,
      snooze_interval_minutes: value.snooze_interval_minutes,
    })
  },
  debounce: 500,
  isEqual: (a, b) =>
    a.window_minutes === b.window_minutes &&
    a.break_minutes === b.break_minutes &&
    a.snooze_interval_minutes === b.snooze_interval_minutes,
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

const testing = ref(false)
const enabledLoading = ref(false)

async function handleEnabledChange(value: boolean) {
  const previous = config.value.enabled ?? true
  config.value = { ...config.value, enabled: value }
  window.dispatchEvent(new CustomEvent('catrace:plugin-enabled-changed', {
    detail: { id: 'rest', enabled: value },
  }))
  enabledLoading.value = true
  try {
    await setRestPluginEnabled(value)
    message.success(t('settings.messages.saved'))
  } catch {
    config.value = { ...config.value, enabled: previous }
    window.dispatchEvent(new CustomEvent('catrace:plugin-enabled-changed', {
      detail: { id: 'rest', enabled: previous },
    }))
    message.error(t('settings.messages.saveFailed'))
  } finally {
    enabledLoading.value = false
  }
}

async function sendTest() {
  if (testing.value) return
  testing.value = true
  try {
    await testNotification()
    message.success(t('settings.messages.notifySent'))
    await new Promise<void>((r) => setTimeout(r, 1000))
  } catch {
    message.error(t('settings.messages.notifyFailed'))
  } finally {
    testing.value = false
  }
}

const headerEnabled = computed(() => config.value.enabled ?? true)

defineExpose({
  headerEnabled,
  headerLoading: enabledLoading,
  toggleEnabled: handleEnabledChange,
})
</script>

<template>
  <plugin-section :title="t('plugins.rest.timingSection')">
    <div class="event-row">
      <div class="event-label">
        <span class="event-name">{{ t('plugins.rest.windowTitle') }}</span>
        <span class="event-desc">{{ t('plugins.rest.windowDesc') }}</span>
      </div>
      <div class="slider-value-row">
        <n-slider
          v-model:value="config.window_minutes"
          :min="10"
          :max="120"
          :step="5"
          :disabled="configLoading"
          style="width: 8rem"
        />
        <span class="value-display">{{ config.window_minutes }} {{ t('common.minutes') }}</span>
      </div>
    </div>
    <div class="event-row">
      <div class="event-label">
        <span class="event-name">{{ t('plugins.rest.breakTitle') }}</span>
        <span class="event-desc">{{ t('plugins.rest.breakDesc') }}</span>
      </div>
      <div class="slider-value-row">
        <n-slider
          v-model:value="config.break_minutes"
          :min="1"
          :max="30"
          :step="1"
          :disabled="configLoading"
          style="width: 8rem"
        />
        <span class="value-display">{{ config.break_minutes }} {{ t('common.minutes') }}</span>
      </div>
    </div>
    <div class="event-row">
      <div class="event-label">
        <span class="event-name">{{ t('plugins.rest.snoozeTitle') }}</span>
        <span class="event-desc">{{ t('plugins.rest.snoozeDesc') }}</span>
      </div>
      <div class="slider-value-row">
        <n-slider
          v-model:value="config.snooze_interval_minutes"
          :min="1"
          :max="10"
          :step="1"
          :disabled="configLoading"
          style="width: 8rem"
        />
        <span class="value-display">{{ config.snooze_interval_minutes }} {{ t('common.minutes') }}</span>
      </div>
    </div>
  </plugin-section>

  <plugin-section :title="t('plugins.rest.contentSection')">
    <div class="event-row align-start">
      <span class="event-name">{{ t('plugins.rest.customTitle') }}</span>
      <n-input
        v-model:value="customTitle"
        :placeholder="t('plugins.rest.previewDefaultTitle')"
        size="small"
        style="max-width: 12rem"
      />
    </div>
    <div class="event-row align-start">
      <span class="event-name">{{ t('plugins.rest.customBody') }}</span>
      <n-input
        v-model:value="customBody"
        :placeholder="t('plugins.rest.previewDefaultBody')"
        type="textarea"
        :rows="2"
        size="small"
        style="max-width: 12rem"
      />
    </div>
    <div class="section-footer">
      <n-button size="small" type="primary" :loading="testing" @click="sendTest">
        <template #icon>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </template>
        {{ t('plugins.rest.testBtn') }}
      </n-button>
    </div>
  </plugin-section>
</template>

<style scoped>
.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.event-row + .event-row {
  border-top: 0.0625rem solid #f1f5f9;
}

.event-row.align-start {
  align-items: flex-start;
}

.event-label {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.event-name {
  font-size: 0.8125rem;
  color: #334155;
}

.event-desc {
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.4;
}

.slider-value-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.value-display {
  font-size: 0.75rem;
  color: #64748b;
  min-width: 3.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.section-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.5rem;
  border-top: 0.0625rem solid #f1f5f9;
}
</style>
