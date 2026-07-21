<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NSelect, NInput, useMessage } from 'naive-ui'
import { load, type Store } from '@tauri-apps/plugin-store'
import {
  getConfig,
  setConfig,
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

interface FullscreenSettings {
  bg: string
  opacity: number
  fitMode: string
}

const { value: reminderMode, loading: reminderModeLoading } = useAutoSavedSetting<string>({
  initialValue: 'toast',
  load: async () => {
    const mode = await getReminderMode()
    if (mode === 'popup') {
      await setReminderMode('toast')
      return 'toast'
    }
    return mode
  },
  save: setReminderMode,
  debounce: 0,
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


const testing = ref(false)

function handleBgFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    fullscreen.value.bg = reader.result as string
  }
  reader.readAsDataURL(file)
  target.value = ''
}

function clearBg() {
  fullscreen.value.bg = ''
}

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
      <h3 class="section-title">{{ t('plugins.rest.methodSection') }}</h3>
      <div class="section-card">
        <setting-row :title="t('plugins.rest.modeTitle')" :desc="t('plugins.rest.modeDesc')">
          <n-select
            v-model:value="reminderMode"
            :options="reminderModeOptions"
            :loading="reminderModeLoading"
            size="small"
            style="width: 10rem;"
          />
        </setting-row>

        <transition name="fade-slide">
          <div v-if="reminderMode === 'fullscreen'" class="fullscreen-section">
            <div class="divider" />
            <div class="fs-bg-upload">
              <div v-if="fullscreen.bg" class="fs-bg-preview">
                <img :src="fullscreen.bg" alt="bg" />
                <div class="fs-bg-actions">
                  <label class="fs-btn fs-btn-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    {{ t('plugins.rest.changeBg') }}
                    <input type="file" accept="image/*" @change="handleBgFileChange" hidden />
                  </label>
                  <button type="button" class="fs-btn fs-btn-danger" @click="clearBg">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    {{ t('plugins.rest.clearBg') }}
                  </button>
                </div>
              </div>
              <label v-else class="fs-bg-empty">
                <input type="file" accept="image/*" @change="handleBgFileChange" hidden />
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C4B5FD" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                <span class="fs-empty-text">{{ t('plugins.rest.fullscreenBgTitle') }}</span>
                <span class="fs-empty-hint">{{ t('plugins.rest.fullscreenBgDesc') }}</span>
              </label>
            </div>

            <setting-row :title="t('plugins.rest.fullscreenOpacityTitle')" :desc="t('plugins.rest.fullscreenOpacityDesc')">
              <slider-control v-model:model-value="fullscreen.opacity" :min="0" :max="100" :step="5" suffix="%" />
            </setting-row>

            <div class="divider" />

            <setting-row :title="t('plugins.rest.fullscreenFitModeTitle')" :desc="t('plugins.rest.fullscreenFitModeDesc')">
              <n-select v-model:value="fullscreen.fitMode" :options="fullscreenFitOptions" size="small" style="width: 8.75rem;" />
            </setting-row>
          </div>
        </transition>
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

.fullscreen-section {
  background: #fafaff;
  border-radius: 0.625rem;
  margin: 0.125rem 0 0.25rem;
  padding: 0 0 0.25rem;
}

.fs-bg-upload {
  margin: 0.5rem 0.75rem 0.75rem;
}

.fs-bg-preview {
  position: relative;
  width: 100%;
  height: 6.875rem;
  border-radius: 0.625rem;
  overflow: hidden;
  border: 0.0625rem solid #ebe6f2;
}

.fs-bg-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fs-bg-actions {
  position: absolute;
  bottom: 0.625rem;
  right: 0.625rem;
  display: flex;
  gap: 0.5rem;
}

.fs-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.5rem;
  border: none;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.fs-btn-secondary {
  background: rgba(255, 255, 255, 0.92);
  color: #2e1065;
  backdrop-filter: blur(0.5rem);
}

.fs-btn-secondary:hover {
  background: #fff;
  box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.12);
}

.fs-btn-danger {
  background: rgba(255, 255, 255, 0.92);
  color: #ef4444;
  backdrop-filter: blur(0.5rem);
}

.fs-btn-danger:hover {
  background: #fee2e2;
  color: #dc2626;
}

.fs-bg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 6.25rem;
  border-radius: 0.625rem;
  border: 0.125rem dashed #e0d8f0;
  background: #fafaff;
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 0.375rem;
}

.fs-bg-empty:hover {
  border-color: #c4b5fd;
  background: #f5f3ff;
}

.fs-bg-empty:hover svg {
  stroke: #7c3aed;
}

.fs-empty-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #2e1065;
}

.fs-empty-hint {
  font-size: 0.75rem;
  color: #8b7aab;
}

.test-actions {
  display: flex;
  justify-content: flex-start;
  padding: 0.75rem 0.25rem 0;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.fade-slide-enter-to,
.fade-slide-leave-from {
  opacity: 1;
  max-height: 25rem;
}
</style>
