<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { getConfig, setConfig, type AppConfig } from '../../api/tauri'
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const message = useMessage()

const { value: config } = useAutoSavedSetting<AppConfig>({
  initialValue: { window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 },
  load: async () => {
    const c = await getConfig()
    return {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
      snooze_interval_minutes: Number(c.snooze_interval_minutes) || 3,
    }
  },
  save: setConfig,
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})
</script>

<template>
  <div class="group reminder-group">
    <div class="group-label">{{ t('settings.groups.reminder') }}</div>

    <setting-row :title="t('settings.reminder.windowTitle')" :desc="t('settings.reminder.windowDesc')">
      <slider-control v-model:model-value="config.window_minutes" :min="10" :max="120" :step="5" :suffix="' ' + t('common.minutes')" />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.reminder.breakTitle')" :desc="t('settings.reminder.breakDesc')">
      <slider-control v-model:model-value="config.break_minutes" :min="1" :max="30" :step="1" :suffix="' ' + t('common.minutes')" />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.reminder.snoozeIntervalTitle')" :desc="t('settings.reminder.snoozeIntervalDesc')">
      <slider-control v-model:model-value="config.snooze_interval_minutes" :min="1" :max="10" :step="1" :suffix="' ' + t('common.minutes')" />
    </setting-row>
  </div>
</template>

<style scoped>
.reminder-group :deep(.setting-meta) {
  width: 13rem;
  flex-shrink: 0;
  max-width: none;
}
</style>
