<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { getConfig, setConfig, getVideoActiveEnabled, setVideoActiveEnabled } from '../../api/tauri'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()

const config = ref({ window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 })
const videoActiveEnabled = ref(true)
const loading = ref({ config: false, videoActive: false })
const isReady = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  try {
    const [c, va] = await Promise.all([getConfig(), getVideoActiveEnabled()])
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
      snooze_interval_minutes: Number(c.snooze_interval_minutes) || 3,
    }
    videoActiveEnabled.value = va
    isReady.value = true
  } catch (e) {
    console.error('Failed to load reminder settings', e)
  }
})

watch(
  () => ({ window_minutes: config.value.window_minutes, break_minutes: config.value.break_minutes, snooze_interval_minutes: config.value.snooze_interval_minutes }),
  async (newVal, oldVal) => {
    if (!isReady.value) return
    if (newVal.window_minutes === oldVal.window_minutes && newVal.break_minutes === oldVal.break_minutes && newVal.snooze_interval_minutes === oldVal.snooze_interval_minutes) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      loading.value.config = true
      try {
        await setConfig(config.value)
        message.success(t('settings.messages.saved'))
      } catch (e) {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value.config = false
      }
    }, 500)
  }
)

async function toggleVideoActive(val: boolean) {
  loading.value.videoActive = true
  try {
    await setVideoActiveEnabled(val)
    videoActiveEnabled.value = val
    message.success(val ? t('settings.messages.videoActiveOn') : t('settings.messages.videoActiveOff'))
  } catch (e) {
    message.error(t('settings.messages.setFailed'))
    videoActiveEnabled.value = !val
  } finally {
    loading.value.videoActive = false
  }
}
</script>

<template>
  <div class="group">
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

    <div class="divider" />

    <setting-row :title="t('settings.reminder.videoActiveTitle')" :desc="t('settings.reminder.videoActiveDesc')">
      <template #default>
        <div class="video-active-control">
          <a class="video-rules-link" @click="router.push('/video-rules')">
            {{ t('videoRules.title') }} →
          </a>
          <n-switch
            :value="videoActiveEnabled"
            :loading="loading.videoActive"
            @update:value="toggleVideoActive"
          />
        </div>
      </template>
    </setting-row>
  </div>
</template>

<style scoped>
.video-active-control {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.video-rules-link {
  color: #7C3AED;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.125rem;
  font-size: 0.75rem;
}

.video-rules-link:hover {
  color: #6D28D9;
}
</style>
