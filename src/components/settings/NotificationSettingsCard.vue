<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSelect, NInput, NButton, useMessage } from 'naive-ui'
import { getReminderMode, setReminderMode, getReminderText, setReminderText, getFullscreenSettings, setFullscreenSettings, testNotification } from '../../api/tauri'
import SettingRow from './SettingRow.vue'
import SliderControl from './SliderControl.vue'

const { t } = useI18n()
const message = useMessage()

const reminderMode = ref('toast')
const savedReminderMode = ref('toast')
const customBody = ref('')
const savedCustomBody = ref('')
const fullscreenBg = ref('')
const fullscreenOpacity = ref(80)
const fullscreenFitMode = ref('contain')
const savedFullscreen = ref({ bg: '', opacity: 80, fitMode: 'contain' })
const loading = ref({ reminderMode: false, reminderText: false, fullscreen: false })
const isReady = ref(false)
let textSaveTimer: ReturnType<typeof setTimeout> | null = null
let fullscreenSaveTimer: ReturnType<typeof setTimeout> | null = null

const reminderModeOptions = [
  { label: t('settings.reminder.modeToast'), value: 'toast' },
  { label: t('settings.reminder.modePopup'), value: 'popup' },
  { label: t('settings.reminder.modeFullscreen'), value: 'fullscreen' },
]

const fullscreenFitOptions = [
  { label: () => t('settings.reminder.fitContain'), value: 'contain' },
  { label: () => t('settings.reminder.fitCover'), value: 'cover' },
  { label: () => t('settings.reminder.fitFill'), value: 'fill' },
]

onMounted(async () => {
  try {
    const [rm, rt, fs] = await Promise.all([
      getReminderMode(),
      getReminderText(),
      getFullscreenSettings(),
    ])
    reminderMode.value = rm || 'toast'
    savedReminderMode.value = reminderMode.value
    customBody.value = rt.body || ''
    savedCustomBody.value = customBody.value
    fullscreenBg.value = fs.bg_image || ''
    fullscreenOpacity.value = Number(fs.opacity) || 80
    fullscreenFitMode.value = fs.fit_mode || 'contain'
    savedFullscreen.value = { bg: fullscreenBg.value, opacity: fullscreenOpacity.value, fitMode: fullscreenFitMode.value }
    isReady.value = true
  } catch (e) {
    console.error('Failed to load notification settings', e)
  }
})

watch(reminderMode, async (newVal, oldVal) => {
  if (!isReady.value || newVal === savedReminderMode.value) return
  loading.value.reminderMode = true
  try {
    await setReminderMode(newVal)
    savedReminderMode.value = newVal
    message.success(t('settings.messages.saved'))
  } catch (e) {
    message.error(t('settings.messages.saveFailed'))
    reminderMode.value = oldVal
  } finally {
    loading.value.reminderMode = false
  }
})

watch(
  () => customBody.value,
  async () => {
    if (!isReady.value || customBody.value === savedCustomBody.value) return
    if (textSaveTimer) clearTimeout(textSaveTimer)
    textSaveTimer = setTimeout(async () => {
      loading.value.reminderText = true
      try {
        await setReminderText('', customBody.value)
        savedCustomBody.value = customBody.value
        message.success(t('settings.messages.saved'))
      } catch (e) {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value.reminderText = false
      }
    }, 500)
  }
)

watch(
  () => ({ bg: fullscreenBg.value, opacity: fullscreenOpacity.value, fitMode: fullscreenFitMode.value }),
  async () => {
    if (!isReady.value) return
    if (fullscreenBg.value === savedFullscreen.value.bg &&
        fullscreenOpacity.value === savedFullscreen.value.opacity &&
        fullscreenFitMode.value === savedFullscreen.value.fitMode) {
      return
    }
    if (fullscreenSaveTimer) clearTimeout(fullscreenSaveTimer)
    fullscreenSaveTimer = setTimeout(async () => {
      loading.value.fullscreen = true
      try {
        await setFullscreenSettings(fullscreenBg.value, fullscreenOpacity.value, fullscreenFitMode.value, '')
        savedFullscreen.value = { bg: fullscreenBg.value, opacity: fullscreenOpacity.value, fitMode: fullscreenFitMode.value }
        message.success(t('settings.messages.saved'))
      } catch (e) {
        console.error('[Fullscreen] Save FAILED:', e)
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value.fullscreen = false
      }
    }, 500)
  }
)

function handleBgFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    fullscreenBg.value = reader.result as string
  }
  reader.readAsDataURL(file)
}

function clearBg() {
  fullscreenBg.value = ''
}

async function notify() {
  try {
    await testNotification()
    message.success(t('settings.messages.notifySent'))
  } catch (e) {
    message.error(t('settings.messages.notifyFailed'))
  }
}
</script>

<template>
  <div class="group">
    <div class="group-label">{{ t('settings.groups.notification') }}</div>

    <setting-row :title="t('settings.reminder.modeTitle')" :desc="t('settings.reminder.modeDesc')">
      <n-select
        v-model:value="reminderMode"
        :options="reminderModeOptions"
        :loading="loading.reminderMode"
        size="small"
        style="width: 10rem;"
      />
    </setting-row>

    <transition name="fade-slide">
      <div v-if="reminderMode === 'fullscreen'" class="fullscreen-section">
        <div class="fs-bg-upload">
          <div v-if="fullscreenBg" class="fs-bg-preview">
            <img :src="fullscreenBg" alt="bg" />
            <div class="fs-bg-actions">
              <label class="fs-btn fs-btn-secondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                {{ t('settings.reminder.changeBg') }}
                <input type="file" accept="image/*" @change="handleBgFileChange" hidden />
              </label>
              <button class="fs-btn fs-btn-danger" @click="clearBg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                {{ t('settings.reminder.clearBg') }}
              </button>
            </div>
          </div>
          <label v-else class="fs-bg-empty">
            <input type="file" accept="image/*" @change="handleBgFileChange" hidden />
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C4B5FD" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            <span class="fs-empty-text">{{ t('settings.reminder.fullscreenBgTitle') }}</span>
            <span class="fs-empty-hint">{{ t('settings.reminder.fullscreenBgDesc') }}</span>
          </label>
        </div>

        <setting-row :title="t('settings.reminder.fullscreenOpacityTitle')" :desc="t('settings.reminder.fullscreenOpacityDesc')">
          <slider-control v-model:model-value="fullscreenOpacity" :min="0" :max="100" :step="5" suffix="%" />
        </setting-row>

        <setting-row :title="t('settings.reminder.fullscreenFitModeTitle')" :desc="t('settings.reminder.fullscreenFitModeDesc')">
          <n-select v-model:value="fullscreenFitMode" :options="fullscreenFitOptions" style="width: 8.75rem;" />
        </setting-row>
      </div>
    </transition>

    <div class="divider" />

    <setting-row :title="t('settings.reminder.customBody')" :desc="t('settings.reminder.customBodyDesc')" style="align-items: flex-start;">
      <n-input
        v-model:value="customBody"
        :placeholder="t('settings.reminder.customBody')"
        type="textarea"
        :rows="2"
        size="small"
        style="width: 13.75rem;"
      />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.reminder.testNotifyTitle')" :desc="t('settings.reminder.testNotifyDesc')">
      <n-button @click="notify">{{ t('settings.reminder.testNotifyBtn') }}</n-button>
    </setting-row>
  </div>
</template>

<style scoped>
.fullscreen-section {
  background: #FAFAFF;
  border: 0.0625rem solid #F5F3FF;
  border-radius: 0.625rem;
  margin: 0.125rem 0 0.5rem;
  padding: 0.5rem 0.75rem;
}

.fullscreen-section :deep(.divider) {
  background: #F0EDFA;
}

.fullscreen-section :deep(.setting-row) {
  padding-top: 0.25rem;
}

.fs-bg-upload {
  margin-bottom: 0.25rem;
}

.fs-bg-preview {
  position: relative;
  width: 100%;
  height: 6.875rem;
  border-radius: 0.625rem;
  overflow: hidden;
  border: 0.0625rem solid #EBE6F2;
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
  color: #2E1065;
  backdrop-filter: blur(0.5rem);
}

.fs-btn-secondary:hover {
  background: #fff;
  box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.12);
}

.fs-btn-danger {
  background: rgba(255, 255, 255, 0.92);
  color: #EF4444;
  backdrop-filter: blur(0.5rem);
}

.fs-btn-danger:hover {
  background: #FEE2E2;
  color: #DC2626;
}

.fs-bg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 6.25rem;
  border-radius: 0.625rem;
  border: 0.125rem dashed #E0D8F0;
  background: #FAFAFF;
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 0.375rem;
}

.fs-bg-empty:hover {
  border-color: #C4B5FD;
  background: #F5F3FF;
}

.fs-bg-empty:hover svg {
  stroke: #7C3AED;
}

.fs-empty-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #2E1065;
}

.fs-empty-hint {
  font-size: 0.75rem;
  color: #8B7AAB;
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
