<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { getConfig, setConfig } from '../../api/tauri'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const message = useMessage()

const config = ref({ window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 })
const savedConfig = ref({ ...config.value })
const loading = ref(false)
const isReady = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  try {
    const c = await getConfig()
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
      snooze_interval_minutes: Number(c.snooze_interval_minutes) || 3,
    }
    savedConfig.value = { ...config.value }
    isReady.value = true
  } catch (e) {
    console.error('Failed to load reminder settings', e)
  }
})

watch(
  () => ({ window_minutes: config.value.window_minutes, break_minutes: config.value.break_minutes, snooze_interval_minutes: config.value.snooze_interval_minutes }),
  async () => {
    if (!isReady.value) return
    if (config.value.window_minutes === savedConfig.value.window_minutes &&
        config.value.break_minutes === savedConfig.value.break_minutes &&
        config.value.snooze_interval_minutes === savedConfig.value.snooze_interval_minutes) {
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      loading.value = true
      try {
        await setConfig(config.value)
        savedConfig.value = { ...config.value }
        message.success(t('settings.messages.saved'))
      } catch (e) {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value = false
      }
    }, 500)
  }
)
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
