<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NSwitch, useMessage } from 'naive-ui'
import { getWaterSettings, setWaterSettings, testWaterNotification } from '../../api/tauri'
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const message = useMessage()

interface WaterSettings {
  enabled: boolean
  interval_minutes: number
}

const { value: settings, loading } = useAutoSavedSetting<WaterSettings>({
  initialValue: { enabled: true, interval_minutes: 60 },
  load: async () => {
    const ws = await getWaterSettings()
    return {
      enabled: ws.enabled,
      interval_minutes: Number(ws.interval_minutes) || 60,
    }
  },
  save: (v) => setWaterSettings(v.enabled, v.interval_minutes),
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

async function notifyWater() {
  try {
    await testWaterNotification()
    message.success(t('settings.messages.notifySent'))
  } catch (e) {
    message.error(t('settings.messages.notifyFailed'))
  }
}
</script>

<template>
  <div class="group water-group">
    <div class="group-label">{{ t('settings.groups.water') }}</div>

    <setting-row :title="t('settings.reminder.waterTitle')" :desc="t('settings.reminder.waterDesc')">
      <n-switch
        :value="settings.enabled"
        :loading="loading"
        @update:value="settings.enabled = $event"
      />
    </setting-row>

    <template v-if="settings.enabled">
      <div class="divider" />

      <setting-row :title="t('settings.reminder.waterIntervalTitle')" :desc="t('settings.reminder.waterIntervalDesc')">
        <slider-control v-model:model-value="settings.interval_minutes" :min="5" :max="180" :step="5" :disabled="!settings.enabled" :suffix="' ' + t('common.minutes')" />
      </setting-row>

      <div class="divider" />

      <setting-row :title="t('settings.reminder.waterTest')">
        <button class="water-test-btn" :disabled="!settings.enabled" @click="notifyWater">
          {{ t('settings.reminder.waterTest') }}
        </button>
      </setting-row>
    </template>
  </div>
</template>

<style scoped>
.water-group.group {
  background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
  border-color: #bfdbfe;
}

.water-group :deep(.group-label) {
  color: #2563eb;
}

.water-group :deep(.divider) {
  background: #dbeafe;
}

.water-group :deep(.setting-value) {
  color: #2563eb;
}

.water-group :deep(.n-switch--active) {
  --n-rail-color-active: #3b82f6 !important;
}

.water-group :deep(.n-switch.n-switch--active .n-switch__rail) {
  background-color: #3b82f6 !important;
}

.water-group :deep(.n-slider-rail__fill) {
  background-color: #3b82f6 !important;
}

.water-group :deep(.n-slider-handle) {
  background-color: #3b82f6 !important;
  box-shadow: 0 0 0 0.125rem rgba(59, 130, 246, 0.3) !important;
}

.water-test-btn {
  height: 1.875rem;
  padding: 0 0.875rem;
  border-radius: 0.5rem;
  border: none;
  background: #3b82f6;
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.water-test-btn:hover {
  background: #2563eb;
}

.water-test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
