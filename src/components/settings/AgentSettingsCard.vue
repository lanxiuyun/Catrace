<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NTag, useMessage } from 'naive-ui'
import {
  getAgentNotificationEnabled,
  setAgentNotificationEnabled,
  installAgentHooks,
  uninstallAgentHooks,
  isAgentHookInstalled,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const enabled = ref(true)
const enabledLoading = ref(false)
const installed = ref(false)
const installing = ref(false)
const uninstalling = ref(false)

onMounted(async () => {
  try {
    enabled.value = await getAgentNotificationEnabled()
  } catch {
    // ignore
  }
  try {
    installed.value = await isAgentHookInstalled()
  } catch {
    // ignore
  }
})

async function toggleEnabled(val: boolean) {
  enabledLoading.value = true
  try {
    await setAgentNotificationEnabled(val)
    enabled.value = val
    message.success(t('settings.messages.saved'))
  } catch {
    message.error(t('settings.messages.saveFailed'))
  } finally {
    enabledLoading.value = false
  }
}

async function install() {
  installing.value = true
  try {
    await installAgentHooks()
    installed.value = true
    message.success(t('settings.agent.installSuccess'))
  } catch {
    message.error(t('settings.agent.installFailed'))
  } finally {
    installing.value = false
  }
}

async function uninstall() {
  uninstalling.value = true
  try {
    await uninstallAgentHooks()
    installed.value = false
    message.success(t('settings.agent.uninstallSuccess'))
  } catch {
    message.error(t('settings.agent.uninstallFailed'))
  } finally {
    uninstalling.value = false
  }
}
</script>

<template>
  <div class="group">
    <div class="group-label">{{ t('settings.groups.agent') }}</div>

    <setting-row :title="t('settings.agent.enabledTitle')" :desc="t('settings.agent.enabledDesc')">
      <n-switch :value="enabled" :loading="enabledLoading" @update:value="toggleEnabled" />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.agent.hookTitle')" :desc="t('settings.agent.hookDesc')">
      <div class="hook-actions">
        <n-tag v-if="installed" type="success" size="small">{{ t('settings.agent.installed') }}</n-tag>
        <n-tag v-else type="default" size="small">{{ t('settings.agent.notInstalled') }}</n-tag>
        <n-button v-if="!installed" size="small" :loading="installing" @click="install">
          {{ t('settings.agent.installBtn') }}
        </n-button>
        <n-button v-else size="small" :loading="uninstalling" @click="uninstall">
          {{ t('settings.agent.uninstallBtn') }}
        </n-button>
      </div>
    </setting-row>
  </div>
</template>

<style scoped>
.hook-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
