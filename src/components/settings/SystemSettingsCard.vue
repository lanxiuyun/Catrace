<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSelect, NSwitch, NButton, NProgress, useMessage } from 'naive-ui'
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import i18n from '../../i18n'
import { detectDefaultLocale, type SupportedLocale } from '../../utils/locale'
import { getSilentStart, setSilentStart, getLocale, setLocale } from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const autostart = ref(false)
const silentStart = ref(false)
const localeVal = ref('zh-CN')
const appVersion = ref('')
const updateInfo = ref<{ available: boolean; version?: string; body?: string } | null>(null)
const updateLoading = ref(false)
const updateInstalling = ref(false)
const downloadProgress = ref(0)
const downloadTotal = ref(0)
const downloadReceived = ref(0)
const loading = ref({ autostart: false, silent: false, locale: false })
const isReady = ref(false)

const localeOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
]


onMounted(async () => {
  try {
    const [a, s, v, loc] = await Promise.all([
      isEnabled(),
      getSilentStart(),
      getVersion(),
      getLocale(),
    ])
    autostart.value = a
    silentStart.value = s
    appVersion.value = v

    if (!loc) {
      const detected = detectDefaultLocale()
      localeVal.value = detected
      await setLocale(detected)
      i18n.global.locale.value = detected
      // 首次自动检测默认语言，静默保存，不弹「已保存」提示
    } else {
      localeVal.value = loc
      i18n.global.locale.value = loc as SupportedLocale
    }

    isReady.value = true
  } catch (e) {
    console.error('Failed to load system settings', e)
  }
})

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

async function changeLocale(val: string) {
  if (!isReady.value) return
  loading.value.locale = true
  const oldVal = localeVal.value
  try {
    await setLocale(val)
    localeVal.value = val
    i18n.global.locale.value = val as 'zh-CN' | 'en-US'
    message.success(t('settings.messages.saved'))
  } catch (e) {
    message.error(t('settings.messages.saveFailed'))
    localeVal.value = oldVal
  } finally {
    loading.value.locale = false
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
  <div class="group">
    <div class="group-label">{{ t('settings.groups.system') }}</div>

    <setting-row :title="t('settings.language.title')" :desc="t('settings.language.desc')">
      <n-select
        v-model:value="localeVal"
        :options="localeOptions"
        :loading="loading.locale"
        size="small"
        style="width: 10rem;"
        @update:value="changeLocale"
      />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.startup.autostartTitle')" :desc="t('settings.startup.autostartDesc')">
      <n-switch
        :value="autostart"
        :loading="loading.autostart"
        @update:value="toggleAutostart"
      />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.startup.silentStartTitle')" :desc="t('settings.startup.silentStartDesc')">
      <n-switch
        :value="silentStart"
        :loading="loading.silent"
        :disabled="!autostart"
        @update:value="toggleSilentStart"
      />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.update.softwareVersion')" :desc="appVersion || '...'">
      <n-button
        :loading="updateLoading"
        :disabled="updateInstalling"
        @click="handleCheckUpdate"
      >{{ t('settings.update.checkUpdate') }}</n-button>
    </setting-row>

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
</template>

<style scoped>
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
</style>
