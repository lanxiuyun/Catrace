<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NSlider,
  NSwitch,
  NButton,
  NProgress,
  NSelect,
  NInput,
  useMessage,
} from 'naive-ui'
import { useRouter } from 'vue-router'
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { load, type Store } from '@tauri-apps/plugin-store'
import Sortable from 'sortablejs'
import {
  getConfig, setConfig,
  getSilentStart, setSilentStart,
  getVideoActiveEnabled, setVideoActiveEnabled,
  getLocale, setLocale,
  testNotification, testWaterNotification,
  getReminderMode, setReminderMode,
  getReminderText, setReminderText,
  getFullscreenSettings, setFullscreenSettings,
  getWaterSettings, setWaterSettings,
} from '../api/tauri'
import i18n from '../i18n'

const { t } = useI18n()
const router = useRouter()

const config = ref({ window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3 })
const autostart = ref(false)
const silentStart = ref(false)
const videoActiveEnabled = ref(true)
const waterEnabled = ref(true)
const waterInterval = ref(60)
const localeVal = ref('zh-CN')
const reminderMode = ref('toast')
const customBody = ref('')
const fullscreenBg = ref('')
const fullscreenOpacity = ref(80)
const fullscreenFitMode = ref('contain')
const fullscreenFitOptions = [
  { label: () => t('settings.reminder.fitContain'), value: 'contain' },
  { label: () => t('settings.reminder.fitCover'), value: 'cover' },
  { label: () => t('settings.reminder.fitFill'), value: 'fill' },
]
const loading = ref({ config: false, autostart: false, silent: false, videoActive: false, water: false, locale: false, reminderMode: false, reminderText: false, fullscreen: false })
const message = useMessage()
const isConfigReady = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

// 设置页卡片拖拽排序
const GROUP_KEYS = ['reminder', 'system', 'notification', 'links', 'water'] as const
type GroupKey = typeof GROUP_KEYS[number]
const defaultGroupOrder: GroupKey[] = ['reminder', 'system', 'notification', 'links', 'water']
const groupOrder = ref<GroupKey[]>([...defaultGroupOrder])
let settingsStore: Store | null = null
let sortable: Sortable | null = null

async function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return settingsStore
}

async function loadGroupOrder() {
  try {
    const store = await getSettingsStore()
    const saved = await store.get<GroupKey[]>('settings_group_order')
    if (saved && saved.length === GROUP_KEYS.length && saved.every(k => GROUP_KEYS.includes(k))) {
      groupOrder.value = saved
    }
  } catch (e) {
    console.error('Failed to load settings group order', e)
  }
}

async function saveGroupOrder() {
  try {
    const store = await getSettingsStore()
    await store.set('settings_group_order', groupOrder.value)
  } catch (e) {
    console.error('Failed to save settings group order', e)
    message.error(t('settings.messages.saveFailed'))
  }
}

function initSortable() {
  const grid = document.querySelector('.settings-grid')
  if (!grid || sortable) return
  sortable = Sortable.create(grid as HTMLElement, {
    forceFallback: true,
    animation: 200,
    ghostClass: 'dragging',
    dragClass: 'drag-over',
    handle: '.group',
    filter: '.n-slider, .n-switch, .n-button, .n-select, .n-input, .n-base-selection, .n-base-select-menu, .link-item, .fs-btn, .water-test-btn, .video-rules-link, input, textarea, select, button, a',
    preventOnFilter: false,
    onEnd: () => {
      const keys = Array.from(grid.children)
        .map(child => child.getAttribute('data-group-key') as GroupKey | null)
        .filter((k): k is GroupKey => !!k && GROUP_KEYS.includes(k))
      if (keys.length === GROUP_KEYS.length) {
        groupOrder.value = keys
        saveGroupOrder()
      }
    },
  })
}

// 更新状态
const appVersion = ref('')
const updateInfo = ref<{ available: boolean; version?: string; body?: string } | null>(null)
const updateLoading = ref(false)
const updateInstalling = ref(false)
const downloadProgress = ref(0)
const downloadTotal = ref(0)
const downloadReceived = ref(0)

const localeOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
]

const reminderModeOptions = [
  { label: t('settings.reminder.modeToast'), value: 'toast' },
  { label: t('settings.reminder.modePopup'), value: 'popup' },
  { label: t('settings.reminder.modeFullscreen'), value: 'fullscreen' },
]

function detectDefaultLocale(): string {
  const lang = navigator.language || 'zh-CN'
  if (lang.startsWith('en')) return 'en-US'
  return 'zh-CN'
}

onMounted(async () => {
  try {
    const [c, a, s, v, va, ws, loc, rm, rt, fs] = await Promise.all([
      getConfig(),
      isEnabled(),
      getSilentStart(),
      getVersion(),
      getVideoActiveEnabled(),
      getWaterSettings(),
      getLocale(),
      getReminderMode(),
      getReminderText(),
      getFullscreenSettings(),
    ])
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
      snooze_interval_minutes: Number(c.snooze_interval_minutes) || 3,
    }
    autostart.value = a
    silentStart.value = s
    videoActiveEnabled.value = va
    waterEnabled.value = ws.enabled
    waterInterval.value = Number(ws.interval_minutes) || 60
    appVersion.value = v
    reminderMode.value = rm || 'toast'
    customBody.value = rt.body || ''
    // 后端已将文件路径转为 data URL，直接使用
    fullscreenBg.value = fs.bg_image || ''
    fullscreenOpacity.value = Number(fs.opacity) || 80
    fullscreenFitMode.value = fs.fit_mode || 'contain'

    // 如果 DB 里没有 locale，自动检测并保存
    if (!loc) {
      const detected = detectDefaultLocale()
      localeVal.value = detected
      await setLocale(detected)
      i18n.global.locale.value = detected as 'zh-CN' | 'en-US'
    } else {
      localeVal.value = loc
      i18n.global.locale.value = loc as 'zh-CN' | 'en-US'
    }

    // 加载用户自定义卡片顺序
    await loadGroupOrder()

    // 等待 Vue 处理完批量 watcher（此时 isConfigReady 仍为 false，watcher 会跳过）
    await nextTick()
    initSortable()
    isConfigReady.value = true
  } catch (e) {
    console.error('Failed to load settings', e)
  }
})

watch(
  () => ({ window_minutes: config.value.window_minutes, break_minutes: config.value.break_minutes, snooze_interval_minutes: config.value.snooze_interval_minutes }),
  async (newVal, oldVal) => {
    if (!isConfigReady.value) return
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

watch(localeVal, async (newVal, oldVal) => {
  if (!isConfigReady.value || newVal === oldVal) return
  loading.value.locale = true
  try {
    await setLocale(newVal)
    i18n.global.locale.value = newVal as 'zh-CN' | 'en-US'
    message.success(t('settings.messages.saved'))
  } catch (e) {
    message.error(t('settings.messages.saveFailed'))
    localeVal.value = oldVal
  } finally {
    loading.value.locale = false
  }
})

watch(reminderMode, async (newVal, oldVal) => {
  if (!isConfigReady.value || newVal === oldVal) return
  loading.value.reminderMode = true
  try {
    await setReminderMode(newVal)
    message.success(t('settings.messages.saved'))
  } catch (e) {
    message.error(t('settings.messages.saveFailed'))
    reminderMode.value = oldVal
  } finally {
    loading.value.reminderMode = false
  }
})

let textSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => customBody.value,
  async (newVal, oldVal) => {
    if (!isConfigReady.value) return
    if (newVal === oldVal) return
    if (textSaveTimer) clearTimeout(textSaveTimer)
    textSaveTimer = setTimeout(async () => {
      loading.value.reminderText = true
      try {
        await setReminderText('', customBody.value)
        message.success(t('settings.messages.saved'))
      } catch (e) {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value.reminderText = false
      }
    }, 500)
  }
)

let fullscreenSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => ({ bg: fullscreenBg.value, opacity: fullscreenOpacity.value, fitMode: fullscreenFitMode.value }),
  async (newVal, oldVal) => {
    if (!isConfigReady.value) return
    if (newVal.bg === oldVal.bg && newVal.opacity === oldVal.opacity && newVal.fitMode === oldVal.fitMode) return
    if (fullscreenSaveTimer) clearTimeout(fullscreenSaveTimer)
    fullscreenSaveTimer = setTimeout(async () => {
      loading.value.fullscreen = true
      try {
        await setFullscreenSettings(fullscreenBg.value, fullscreenOpacity.value, fullscreenFitMode.value, '')
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

async function toggleAutostart(val: boolean) {
  loading.value.autostart = true
  try {
    if (val) {
      await enable()
    } else {
      await disable()
    }
    autostart.value = val
    message.success(val ? t('settings.messages.autostartOn') : t('settings.messages.autostartOff'))
  } catch (e) {
    message.error(t('settings.messages.setFailed'))
    autostart.value = !val
  } finally {
    loading.value.autostart = false
  }
}

async function toggleSilentStart(val: boolean) {
  loading.value.silent = true
  try {
    await setSilentStart(val)
    silentStart.value = val
    message.success(val ? t('settings.messages.silentOn') : t('settings.messages.silentOff'))
  } catch (e) {
    message.error(t('settings.messages.setFailed'))
    silentStart.value = !val
  } finally {
    loading.value.silent = false
  }
}

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

async function toggleWaterEnabled(val: boolean) {
  loading.value.water = true
  try {
    await setWaterSettings(val, waterInterval.value)
    waterEnabled.value = val
    message.success(t('settings.messages.saved'))
  } catch (e) {
    message.error(t('settings.messages.saveFailed'))
    waterEnabled.value = !val
  } finally {
    loading.value.water = false
  }
}

let waterSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => waterInterval.value,
  async (newVal, oldVal) => {
    if (!isConfigReady.value) return
    if (newVal === oldVal) return
    if (waterSaveTimer) clearTimeout(waterSaveTimer)
    waterSaveTimer = setTimeout(async () => {
      loading.value.water = true
      try {
        await setWaterSettings(waterEnabled.value, newVal)
        message.success(t('settings.messages.saved'))
      } catch (e) {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value.water = false
      }
    }, 500)
  }
)

async function notify() {
  try {
    await testNotification()
    message.success(t('settings.messages.notifySent'))
  } catch (e) {
    message.error(t('settings.messages.notifyFailed'))
  }
}

async function notifyWater() {
  try {
    await testWaterNotification()
    message.success(t('settings.messages.notifySent'))
  } catch (e) {
    message.error(t('settings.messages.notifyFailed'))
  }
}

async function handleCheckUpdate() {
  updateLoading.value = true
  try {
    const update = await check({
      headers: { 'X-AccessKey': '9SzxzOb3pQgkOB-LU-QU1Q' },
    })
    if (update) {
      updateInfo.value = { available: true, version: update.version, body: update.body || '' }
      message.info(t('settings.update.newVersion', { version: update.version }))
    } else {
      updateInfo.value = { available: false }
      message.success(t('settings.messages.noUpdate'))
    }
  } catch (e) {
    message.error(t('settings.messages.checkFailed'))
    console.error(e)
  } finally {
    updateLoading.value = false
  }
}

async function handleInstallUpdate() {
  updateInstalling.value = true
  downloadProgress.value = 0
  downloadTotal.value = 0
  downloadReceived.value = 0
  try {
    const update = await check({
      headers: { 'X-AccessKey': '9SzxzOb3pQgkOB-LU-QU1Q' },
    })
    if (!update) {
      message.warning(t('settings.messages.noUpdateFound'))
      return
    }
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          downloadTotal.value = event.data.contentLength || 0
          break
        case 'Progress':
          downloadReceived.value += event.data.chunkLength
          if (downloadTotal.value > 0) {
            downloadProgress.value = Math.round((downloadReceived.value / downloadTotal.value) * 100)
          }
          break
        case 'Finished':
          downloadProgress.value = 100
          break
      }
    })
    message.success(t('settings.messages.installSuccess'))
    await relaunch()
  } catch (e) {
    message.error(t('settings.messages.updateFailed'))
    console.error(e)
  } finally {
    updateInstalling.value = false
  }
}
</script>

<template>
  <div class="settings">
    <h1 class="title">{{ t('settings.title') }}</h1>

    <div class="settings-grid">
      <!-- 提醒偏好 -->
      <div
        class="group group-reminder"
        :style="{ order: groupOrder.indexOf('reminder') + 1 }"
        data-group-key="reminder"
      >
        <div class="group-label">{{ t('settings.groups.reminder') }}</div>

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.windowTitle') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.windowDesc') }}</div>
          </div>
          <div class="setting-control slider-control">
            <n-slider v-model:value="config.window_minutes" :min="10" :max="120" :step="5" />
            <span class="setting-value">{{ config.window_minutes }} {{ t('common.minutes') }}</span>
          </div>
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.breakTitle') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.breakDesc') }}</div>
          </div>
          <div class="setting-control slider-control">
            <n-slider v-model:value="config.break_minutes" :min="1" :max="30" :step="1" />
            <span class="setting-value">{{ config.break_minutes }} {{ t('common.minutes') }}</span>
          </div>
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.snoozeIntervalTitle') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.snoozeIntervalDesc') }}</div>
          </div>
          <div class="setting-control slider-control">
            <n-slider v-model:value="config.snooze_interval_minutes" :min="1" :max="10" :step="1" />
            <span class="setting-value">{{ config.snooze_interval_minutes }} {{ t('common.minutes') }}</span>
          </div>
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.videoActiveTitle') }}</div>
            <div class="setting-desc">
              {{ t('settings.reminder.videoActiveDesc') }}
              <a class="video-rules-link" @click="router.push('/video-rules')">
                {{ t('videoRules.title') }} →
              </a>
            </div>
          </div>
          <n-switch
            :value="videoActiveEnabled"
            :loading="loading.videoActive"
            @update:value="toggleVideoActive"
          />
        </div>
      </div>

      <!-- 系统 -->
      <div
        class="group group-system"
        :style="{ order: groupOrder.indexOf('system') + 1 }"
        data-group-key="system"
      >
        <div class="group-label">{{ t('settings.groups.system') }}</div>

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.language.title') }}</div>
            <div class="setting-desc">{{ t('settings.language.desc') }}</div>
          </div>
          <n-select
            v-model:value="localeVal"
            :options="localeOptions"
            :loading="loading.locale"
            size="small"
            style="width: 10rem;"
          />
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.startup.autostartTitle') }}</div>
            <div class="setting-desc">{{ t('settings.startup.autostartDesc') }}</div>
          </div>
          <n-switch
            :value="autostart"
            :loading="loading.autostart"
            @update:value="toggleAutostart"
          />
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.startup.silentStartTitle') }}</div>
            <div class="setting-desc">{{ t('settings.startup.silentStartDesc') }}</div>
          </div>
          <n-switch
            :value="silentStart"
            :loading="loading.silent"
            :disabled="!autostart"
            @update:value="toggleSilentStart"
          />
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.update.softwareVersion') }}</div>
            <div class="setting-desc">{{ appVersion || '...' }}</div>
          </div>
          <div class="setting-control">
            <n-button
              :loading="updateLoading"
              :disabled="updateInstalling"
              @click="handleCheckUpdate"
            >{{ t('settings.update.checkUpdate') }}</n-button>
          </div>
        </div>

        <template v-if="updateInfo?.available">
          <div class="divider" />
          <div class="update-banner">
            <div class="update-banner-title">
              {{ t('settings.update.newVersion', { version: updateInfo.version }) }}
            </div>
            <div v-if="updateInfo.body" class="update-banner-body">
              {{ updateInfo.body }}
            </div>
            <n-button
              type="primary"
              :loading="updateInstalling && downloadProgress === 0"
              :disabled="updateInstalling"
              @click="handleInstallUpdate"
            >{{ updateInstalling ? t('settings.update.downloading') : t('settings.update.updateNow') }}</n-button>
            <div v-if="updateInstalling" class="download-progress">
              <n-progress
                type="line"
                :percentage="downloadProgress"
                :height="8"
                :show-indicator="false"
                color="#7C3AED"
                rail-color="#EBE6F2"
              />
              <div class="download-progress-text">
                {{ downloadProgress }}%
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 提醒设置 -->
      <div
        class="group group-notification"
        :style="{ order: groupOrder.indexOf('notification') + 1 }"
        data-group-key="notification"
      >
        <div class="group-label">{{ t('settings.groups.notification') }}</div>

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.modeTitle') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.modeDesc') }}</div>
          </div>
          <n-select
            v-model:value="reminderMode"
            :options="reminderModeOptions"
            :loading="loading.reminderMode"
            size="small"
            style="width: 10rem;"
          />
        </div>

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

            <div class="setting-row" style="padding-top: 0.25rem;">
              <div class="setting-meta">
                <div class="setting-title">{{ t('settings.reminder.fullscreenOpacityTitle') }}</div>
                <div class="setting-desc">{{ t('settings.reminder.fullscreenOpacityDesc') }}</div>
              </div>
              <div class="setting-control slider-control">
                <n-slider v-model:value="fullscreenOpacity" :min="0" :max="100" :step="5" />
                <span class="setting-value">{{ fullscreenOpacity }}%</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-meta">
                <div class="setting-title">{{ t('settings.reminder.fullscreenFitModeTitle') }}</div>
                <div class="setting-desc">{{ t('settings.reminder.fullscreenFitModeDesc') }}</div>
              </div>
              <div class="setting-control">
                <n-select v-model:value="fullscreenFitMode" :options="fullscreenFitOptions" style="width: 8.75rem;" />
              </div>
            </div>
          </div>
        </transition>

        <div class="divider" />

        <div class="setting-row" style="align-items: flex-start;">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.customBody') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.customBodyDesc') }}</div>
          </div>
          <n-input
            v-model:value="customBody"
            :placeholder="t('settings.reminder.customBody')"
            type="textarea"
            :rows="2"
            size="small"
            style="width: 13.75rem;"
          />
        </div>

        <div class="divider" />

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.testNotifyTitle') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.testNotifyDesc') }}</div>
          </div>
          <n-button @click="notify">{{ t('settings.reminder.testNotifyBtn') }}</n-button>
        </div>
      </div>

      <!-- 相关链接 -->
      <div
        class="group links-group group-links"
        :style="{ order: groupOrder.indexOf('links') + 1 }"
        data-group-key="links"
      >
        <div class="group-label">{{ t('settings.groups.links') }}</div>
        <div class="link-list">
          <div class="link-item" @click="openUrl('https://github.com/lanxiuyun/Catrace')">
            <div class="link-icon" style="background:#F3F4F6;color:#24292F;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </div>
            <div class="link-body">
              <div class="link-title">{{ t('settings.links.githubTitle') }}</div>
              <div class="link-desc">{{ t('settings.links.githubDesc') }}</div>
            </div>
            <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          <div class="link-item" @click="openUrl('https://github.com/lanxiuyun/Catrace/releases')">
            <div class="link-icon" style="background:#EFF6FF;color:#3B82F6;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <div class="link-body">
              <div class="link-title">{{ t('settings.links.changelogTitle') }}</div>
              <div class="link-desc">{{ t('settings.links.changelogDesc') }}</div>
            </div>
            <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          <div class="link-item" @click="openUrl('https://github.com/lanxiuyun/Catrace/issues')">
            <div class="link-icon" style="background:#FFFBEB;color:#F59E0B;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <div class="link-body">
              <div class="link-title">{{ t('settings.links.issuesTitle') }}</div>
              <div class="link-desc">{{ t('settings.links.issuesDesc') }}</div>
            </div>
            <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </div>

      <!-- 喝水提醒 -->
      <div
        class="group water-group group-water"
        :style="{ order: groupOrder.indexOf('water') + 1 }"
        data-group-key="water"
      >
        <div class="group-label">{{ t('settings.groups.water') }}</div>

        <div class="setting-row">
          <div class="setting-meta">
            <div class="setting-title">{{ t('settings.reminder.waterTitle') }}</div>
            <div class="setting-desc">{{ t('settings.reminder.waterDesc') }}</div>
          </div>
          <n-switch
            :value="waterEnabled"
            :loading="loading.water"
            @update:value="toggleWaterEnabled"
          />
        </div>

        <template v-if="waterEnabled">
          <div class="divider" />

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">{{ t('settings.reminder.waterIntervalTitle') }}</div>
              <div class="setting-desc">{{ t('settings.reminder.waterIntervalDesc') }}</div>
            </div>
            <div class="setting-control slider-control">
              <n-slider v-model:value="waterInterval" :min="5" :max="180" :step="5" :disabled="!waterEnabled" />
              <span class="setting-value water-value">{{ waterInterval }} {{ t('common.minutes') }}</span>
            </div>
          </div>

          <div class="divider" />

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">{{ t('settings.reminder.waterTest') }}</div>
            </div>
            <button class="water-test-btn" :disabled="!waterEnabled" @click="notifyWater">
              {{ t('settings.reminder.waterTest') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 1.25rem;
}

.title {
  font-size: 1.375rem;
  font-weight: 700;
  color: #2E1065;
  margin: 0 0 1rem 0;
}

/* 响应式卡片网格布局（与今日活动概览一致） */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(23.75rem, 1fr));
  gap: 0.75rem;
}

/* 分组卡片 */
.group {
  position: relative;
  background: #fff;
  border: 0.0625rem solid #EBE6F2;
  border-radius: 0.875rem;
  padding: 1rem 1.25rem;
  box-sizing: border-box;
  cursor: grab;
  transition: opacity 0.15s ease, border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}
.group:active {
  cursor: grabbing;
}
.group.dragging {
  opacity: 0.55;
  transform: scale(0.985);
  pointer-events: none;
}
.group.drag-over {
  border: 0.0625rem dashed #7C3AED;
  background: #FAF5FF;
}
.group-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8B7AAB;
  text-transform: uppercase;
  letter-spacing: 0.0312rem;
  margin-bottom: 0;
}

/* 设置行 */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0.625rem 0;
}
.setting-row.actions {
  padding: 0.375rem 0 0.25rem;
}

.setting-meta {
  flex-shrink: 1;
  min-width: 0;
}
.setting-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0;
}
.setting-desc {
  font-size: 0.75rem;
  color: #8B7AAB;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.slider-control {
  flex: 1;
  max-width: 20rem;
  min-width: 7.5rem;
}
.slider-control :deep(.n-slider) {
  flex: 1;
}
.setting-value {
  font-size: 0.875rem;
  font-weight: 700;
  color: #7C3AED;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 3.5rem;
  text-align: right;
}

.divider {
  height: 0.0625rem;
  background: #F5F3FF;
  margin: 0;
}

/* 全屏提醒子区域 */
.fullscreen-section {
  background: #FAFAFF;
  border: 0.0625rem solid #F5F3FF;
  border-radius: 0.625rem;
  margin: 0.125rem 0 0.5rem;
  padding: 0.5rem 0.75rem;
}
.fullscreen-section .divider {
  background: #F0EDFA;
}
.fullscreen-section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #7C3AED;
  letter-spacing: 0.0187rem;
  margin-bottom: 0.25rem;
}

/* 展开/收起过渡动画 */
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

/* 相关链接 */
.links-group {
  padding: 1rem 1.25rem 0.625rem;
}
.link-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.link-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  background: #FAFAFF;
  border: 0.0625rem solid #F5F3FF;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.link-item:hover {
  background: #F5F3FF;
  border-color: #EDE9FE;
  transform: translateY(0.0625rem);
}
.link-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.link-body {
  flex: 1;
  min-width: 0;
}
.link-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0.125rem;
}
.link-desc {
  font-size: 0.75rem;
  color: #8B7AAB;
}
.link-arrow {
  color: #C4B5FD;
  flex-shrink: 0;
  transition: color 0.15s ease;
}
.link-item:hover .link-arrow {
  color: #7C3AED;
}
.download-progress {
  margin-top: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.625rem;
}
.download-progress :deep(.n-progress-graph-line) {
  flex: 1;
}
.download-progress-text {
  font-size: 0.75rem;
  color: #8B7AAB;
  font-variant-numeric: tabular-nums;
  min-width: 2.5em;
  text-align: right;
}

/* 更新提示 */
.update-banner {
  padding: 0.625rem 0 0.25rem;
}
.update-banner-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0.375rem;
}
.update-banner-body {
  font-size: 0.75rem;
  color: #8B7AAB;
  margin-bottom: 0.75rem;
  white-space: pre-wrap;
  line-height: 1.5;
  max-height: 10rem;
  overflow-y: auto;
  padding-right: 0.5rem;
}

.bg-preview {
  position: relative;
  width: 13.75rem;
  height: 7.5rem;
  border-radius: 0.625rem;
  overflow: hidden;
  border: 0.0625rem solid #EBE6F2;
}
.bg-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bg-clear {
  position: absolute;
  bottom: 0.375rem;
  right: 0.375rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.375rem;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.6875rem;
  cursor: pointer;
  transition: background 0.15s ease;
}
.bg-clear:hover {
  background: rgba(0, 0, 0, 0.8);
}

/* 全屏背景上传 */
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

/* 内容位置编辑器 */
.content-pos-editor {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.pos-preview {
  position: relative;
  width: 11.25rem;
  height: 6.3125rem;
  border-radius: 0.5rem;
  background: #1a1a2e;
  background-size: cover;
  background-position: center;
  border: 0.0625rem solid #EBE6F2;
  cursor: crosshair;
  overflow: hidden;
}
.pos-dot {
  position: absolute;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: #7C3AED;
  border: 0.125rem solid #fff;
  box-shadow: 0 0 0 0.125rem rgba(124, 58, 237, 0.4), 0 0.125rem 0.5rem rgba(0, 0, 0, 0.3);
  transform: translate(-50%, -50%);
  pointer-events: none;
  transition: left 0.05s, top 0.05s;
}
.pos-reset {
  font-size: 0.6875rem;
  padding: 0.25rem 0.625rem;
}

.water-group {
  background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
  border-color: #bfdbfe;
}
.water-group .group-label {
  color: #2563eb;
}
.water-group .divider {
  background: #dbeafe;
}
.water-value {
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

.video-rules-link {
  color: #7C3AED;
  cursor: pointer;
  margin-left: 0.375rem;
  text-decoration: underline;
  text-underline-offset: 0.125rem;
}
.video-rules-link:hover {
  color: #6D28D9;
}

/* 响应式 */
@media (max-width: 56.25rem) {
  .settings {
    padding: 1.25rem;
  }
  .slider-control {
    max-width: 16.25rem;
  }
}
</style>
