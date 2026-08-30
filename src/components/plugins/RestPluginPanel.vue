<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NInput, NSelect, NSlider, useMessage } from 'naive-ui'
import {
  getConfig,
  setConfig,
  setRestPluginEnabled,
  getReminderMode,
  setReminderMode,
  getReminderText,
  setReminderText,
  getFullscreenSettings,
  setFullscreenSettings,
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

const { value: reminderMode, loading: reminderModeLoading } = useAutoSavedSetting<string>({
  initialValue: 'toast',
  load: async () => {
    const mode = await getReminderMode()
    return mode === 'fullscreen' ? 'fullscreen' : 'toast'
  },
  save: setReminderMode,
  debounce: 0,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

interface FullscreenSettings {
  bg: string
  opacity: number
  fitMode: string
}

const { value: fullscreen } = useAutoSavedSetting<FullscreenSettings>({
  initialValue: { bg: '', opacity: 80, fitMode: 'contain' },
  load: async () => {
    const fs = await getFullscreenSettings()
    return {
      bg: fs.bg_image || '',
      opacity: Number(fs.opacity) || 80,
      fitMode: fs.fit_mode || 'contain',
    }
  },
  save: (v) => setFullscreenSettings(v.bg, v.opacity, v.fitMode, ''),
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

const reminderModeOptions = computed(() => [
  { label: t('plugins.rest.modeToast'), value: 'toast' },
  { label: t('plugins.rest.modeFullscreen'), value: 'fullscreen' },
])

const fullscreenFitOptions = computed(() => [
  { label: t('plugins.rest.fitContain'), value: 'contain' },
  { label: t('plugins.rest.fitCover'), value: 'cover' },
  { label: t('plugins.rest.fitFill'), value: 'fill' },
])

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

const fullscreenOpacity = computed({
  get: () => fullscreen.value.opacity,
  set: (v: number) => {
    fullscreen.value = { ...fullscreen.value, opacity: v }
  },
})

const fullscreenFitMode = computed({
  get: () => fullscreen.value.fitMode,
  set: (v: string) => {
    fullscreen.value = { ...fullscreen.value, fitMode: v }
  },
})

const testing = ref(false)
const enabledLoading = ref(false)

function handleBgFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    fullscreen.value = { ...fullscreen.value, bg: reader.result as string }
  }
  reader.readAsDataURL(file)
  target.value = ''
}

function clearBg() {
  fullscreen.value = { ...fullscreen.value, bg: '' }
}

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

  <plugin-section :title="t('plugins.rest.methodSection')">
    <div class="event-row">
      <div class="event-label">
        <span class="event-name">{{ t('plugins.rest.modeTitle') }}</span>
        <span class="event-desc">{{ t('plugins.rest.modeDesc') }}</span>
      </div>
      <n-select
        v-model:value="reminderMode"
        :options="reminderModeOptions"
        :loading="reminderModeLoading"
        size="small"
        style="width: 10rem"
      />
    </div>

    <template v-if="reminderMode === 'fullscreen'">
      <div class="event-row align-start">
        <div class="event-label">
          <span class="event-name">{{ t('plugins.rest.fullscreenBgTitle') }}</span>
          <span class="event-desc">{{ t('plugins.rest.fullscreenBgDesc') }}</span>
        </div>
        <div class="fs-bg-upload">
          <div v-if="fullscreen.bg" class="fs-bg-preview">
            <img :src="fullscreen.bg" alt="" />
            <div class="fs-bg-actions">
              <label class="fs-btn fs-btn-secondary">
                {{ t('plugins.rest.changeBg') }}
                <input type="file" accept="image/*" hidden @change="handleBgFileChange" />
              </label>
              <button type="button" class="fs-btn fs-btn-danger" @click="clearBg">
                {{ t('plugins.rest.clearBg') }}
              </button>
            </div>
          </div>
          <label v-else class="fs-bg-empty">
            <input type="file" accept="image/*" hidden @change="handleBgFileChange" />
            <span class="fs-empty-text">{{ t('plugins.rest.fullscreenBgTitle') }}</span>
            <span class="fs-empty-hint">{{ t('plugins.rest.fullscreenBgDesc') }}</span>
          </label>
        </div>
      </div>
      <div class="event-row">
        <div class="event-label">
          <span class="event-name">{{ t('plugins.rest.fullscreenOpacityTitle') }}</span>
          <span class="event-desc">{{ t('plugins.rest.fullscreenOpacityDesc') }}</span>
        </div>
        <div class="slider-value-row">
          <n-slider
            v-model:value="fullscreenOpacity"
            :min="0"
            :max="100"
            :step="5"
            style="width: 8rem"
          />
          <span class="value-display">{{ fullscreenOpacity }}%</span>
        </div>
      </div>
      <div class="event-row">
        <div class="event-label">
          <span class="event-name">{{ t('plugins.rest.fullscreenFitModeTitle') }}</span>
          <span class="event-desc">{{ t('plugins.rest.fullscreenFitModeDesc') }}</span>
        </div>
        <n-select
          v-model:value="fullscreenFitMode"
          :options="fullscreenFitOptions"
          size="small"
          style="width: 8.75rem"
        />
      </div>
    </template>
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

.fs-bg-upload {
  width: 12rem;
}

.fs-bg-preview {
  position: relative;
  width: 100%;
  height: 4.5rem;
  border-radius: 0.5rem;
  overflow: hidden;
  border: 0.0625rem solid #e2e8f0;
}

.fs-bg-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fs-bg-actions {
  position: absolute;
  bottom: 0.375rem;
  right: 0.375rem;
  display: flex;
  gap: 0.375rem;
}

.fs-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.75rem;
  cursor: pointer;
}

.fs-btn-secondary {
  background: rgba(255, 255, 255, 0.92);
  color: #334155;
}

.fs-btn-danger {
  background: rgba(255, 255, 255, 0.92);
  color: #ef4444;
}

.fs-bg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 4.5rem;
  border-radius: 0.5rem;
  border: 0.125rem dashed #e2e8f0;
  background: #f8fafc;
  cursor: pointer;
  gap: 0.25rem;
  padding: 0.5rem;
}

.fs-empty-text {
  font-size: 0.75rem;
  color: #334155;
}

.fs-empty-hint {
  font-size: 0.6875rem;
  color: #94a3b8;
  text-align: center;
}
</style>
