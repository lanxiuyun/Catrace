<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NSwitch, useMessage } from 'naive-ui'
import { getEyeSettings, setEyeSettings, testEyeNotification } from '../../api/tauri'
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const message = useMessage()

interface EyeSettings {
  enabled: boolean
  interval_minutes: number
}

const { value: settings, loading } = useAutoSavedSetting<EyeSettings>({
  initialValue: { enabled: true, interval_minutes: 20 },
  load: async () => {
    const es = await getEyeSettings()
    return {
      enabled: es.enabled,
      interval_minutes: Number(es.interval_minutes) || 20,
    }
  },
  save: (v) => setEyeSettings(v.enabled, v.interval_minutes),
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

async function notifyEye() {
  try {
    await testEyeNotification()
    message.success(t('settings.messages.notifySent'))
  } catch (e) {
    message.error(t('settings.messages.notifyFailed'))
  }
}
</script>

<template>
  <div class="group eye-group">
    <div class="group-label">{{ t('settings.groups.eye') }}</div>

    <setting-row :title="t('settings.reminder.eyeTitle')" :desc="t('settings.reminder.eyeDesc')">
      <n-switch
        :value="settings.enabled"
        :loading="loading"
        @update:value="settings.enabled = $event"
      />
    </setting-row>

    <template v-if="settings.enabled">
      <div class="divider" />

      <setting-row :title="t('settings.reminder.eyeIntervalTitle')" :desc="t('settings.reminder.eyeIntervalDesc')">
        <slider-control v-model:model-value="settings.interval_minutes" :min="5" :max="120" :step="5" :disabled="!settings.enabled" :suffix="' ' + t('common.minutes')" />
      </setting-row>

      <div class="divider" />

      <setting-row :title="t('settings.reminder.eyeTest')">
        <button class="eye-test-btn" :disabled="!settings.enabled" @click="notifyEye">
          {{ t('settings.reminder.eyeTest') }}
        </button>
      </setting-row>
    </template>
  </div>
</template>

<style scoped>
.eye-group.group {
  background: linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%);
  border-color: #a7f3d0;
}

.eye-group :deep(.group-label) {
  color: #059669;
}

.eye-group :deep(.divider) {
  background: #d1fae5;
}

.eye-group :deep(.setting-value) {
  color: #059669;
}

.eye-group :deep(.n-switch--active) {
  --n-rail-color-active: #10b981 !important;
}

.eye-group :deep(.n-switch.n-switch--active .n-switch__rail) {
  background-color: #10b981 !important;
}

.eye-group :deep(.n-slider-rail__fill) {
  background-color: #10b981 !important;
}

.eye-group :deep(.n-slider-handle) {
  background-color: #10b981 !important;
  box-shadow: 0 0 0 0.125rem rgba(16, 185, 129, 0.3) !important;
}

.eye-test-btn {
  height: 1.875rem;
  padding: 0 0.875rem;
  border-radius: 0.5rem;
  border: none;
  background: #10b981;
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.eye-test-btn:hover {
  background: #059669;
}

.eye-test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
