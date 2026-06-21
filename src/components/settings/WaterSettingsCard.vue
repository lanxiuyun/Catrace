<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, useMessage } from 'naive-ui'
import { getWaterSettings, setWaterSettings, testWaterNotification } from '../../api/tauri'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const message = useMessage()

const waterEnabled = ref(true)
const waterInterval = ref(60)
const savedInterval = ref(60)
const loading = ref(false)
const isReady = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  try {
    const ws = await getWaterSettings()
    waterEnabled.value = ws.enabled
    waterInterval.value = Number(ws.interval_minutes) || 60
    savedInterval.value = waterInterval.value
    isReady.value = true
  } catch (e) {
    console.error('Failed to load water settings', e)
  }
})

async function toggleWaterEnabled(val: boolean) {
  loading.value = true
  try {
    await setWaterSettings(val, waterInterval.value)
    waterEnabled.value = val
    message.success(t('settings.messages.saved'))
  } catch (e) {
    message.error(t('settings.messages.saveFailed'))
    waterEnabled.value = !val
  } finally {
    loading.value = false
  }
}

watch(
  () => waterInterval.value,
  async () => {
    if (!isReady.value || waterInterval.value === savedInterval.value) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      loading.value = true
      try {
        await setWaterSettings(waterEnabled.value, waterInterval.value)
        savedInterval.value = waterInterval.value
        message.success(t('settings.messages.saved'))
      } catch (e) {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value = false
      }
    }, 500)
  }
)

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
  <div class="group water-group water-group">
    <div class="group-label">{{ t('settings.groups.water') }}</div>

    <setting-row :title="t('settings.reminder.waterTitle')" :desc="t('settings.reminder.waterDesc')">
      <n-switch
        :value="waterEnabled"
        :loading="loading"
        @update:value="toggleWaterEnabled"
      />
    </setting-row>

    <template v-if="waterEnabled">
      <div class="divider" />

      <setting-row :title="t('settings.reminder.waterIntervalTitle')" :desc="t('settings.reminder.waterIntervalDesc')">
        <slider-control v-model:model-value="waterInterval" :min="5" :max="180" :step="5" :disabled="!waterEnabled" :suffix="' ' + t('common.minutes')" />
      </setting-row>

      <div class="divider" />

      <setting-row :title="t('settings.reminder.waterTest')">
        <button class="water-test-btn" :disabled="!waterEnabled" @click="notifyWater">
          {{ t('settings.reminder.waterTest') }}
        </button>
      </setting-row>
    </template>
  </div>
</template>

<style scoped>
.water-group.water-group {
  background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
  border-color: #bfdbfe;
}

.water-group.water-group :deep(.group-label) {
  color: #2563eb;
}

.water-group.water-group :deep(.divider) {
  background: #dbeafe;
}

.water-group.water-group :deep(.setting-value) {
  color: #2563eb;
}

.water-group.water-group :deep(.n-switch--active) {
  --n-rail-color-active: #3b82f6 !important;
}

.water-group.water-group :deep(.n-switch.n-switch--active .n-switch__rail) {
  background-color: #3b82f6 !important;
}

.water-group.water-group :deep(.n-slider-rail__fill) {
  background-color: #3b82f6 !important;
}

.water-group.water-group :deep(.n-slider-handle) {
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
