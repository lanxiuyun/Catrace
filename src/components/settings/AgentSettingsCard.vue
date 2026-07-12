<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NTag, NRadioGroup, NRadioButton, useMessage } from 'naive-ui'
import {
  getAgentNotificationEnabled,
  setAgentNotificationEnabled,
  installAgentHooks,
  uninstallAgentHooks,
  isAgentHookInstalled,
  getAgentEventModes,
  setAgentEventMode,
  type AgentEventMode,
  type AgentEventModeEntry,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const enabled = ref(true)
const enabledLoading = ref(false)
const installed = ref(false)
const installing = ref(false)
const uninstalling = ref(false)
const eventModes = ref<AgentEventModeEntry[]>([])
const modeLoading = ref<Record<string, boolean>>({})

const eventNameKeys: Record<string, string> = {
  SessionStart: 'settings.agent.eventSessionStart',
  UserPromptSubmit: 'settings.agent.eventUserPromptSubmit',
  Stop: 'settings.agent.eventStop',
  StopFailure: 'settings.agent.eventStopFailure',
  Notification: 'settings.agent.eventNotification',
}

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
  try {
    eventModes.value = await getAgentEventModes()
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

async function changeMode(event: string, mode: AgentEventMode) {
  modeLoading.value[event] = true
  const prev = eventModes.value.find((e) => e.event === event)?.mode
  try {
    await setAgentEventMode(event, mode)
    const entry = eventModes.value.find((e) => e.event === event)
    if (entry) entry.mode = mode
  } catch {
    message.error(t('settings.messages.saveFailed'))
    const entry = eventModes.value.find((e) => e.event === event)
    if (entry && prev) entry.mode = prev
  } finally {
    modeLoading.value[event] = false
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

    <template v-if="enabled">
      <div class="divider" />

      <div class="events-header">
        <div class="events-title">{{ t('settings.agent.eventsTitle') }}</div>
        <div class="events-desc">{{ t('settings.agent.eventsDesc') }}</div>
      </div>

      <div v-for="entry in eventModes" :key="entry.event" class="event-row">
        <span class="event-name">{{ t(eventNameKeys[entry.event] || entry.event) }}</span>
        <n-radio-group
          :value="entry.mode"
          size="small"
          :disabled="modeLoading[entry.event]"
          @update:value="(m: AgentEventMode) => changeMode(entry.event, m)"
        >
          <n-radio-button value="off">{{ t('settings.agent.modeOff') }}</n-radio-button>
          <n-radio-button value="auto">{{ t('settings.agent.modeAuto') }}</n-radio-button>
          <n-radio-button value="sticky">{{ t('settings.agent.modeSticky') }}</n-radio-button>
        </n-radio-group>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hook-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.events-header {
  padding: 0.5rem 0 0.25rem;
}

.events-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #333;
}

.events-desc {
  font-size: 0.75rem;
  color: #999;
  margin-top: 0.125rem;
  line-height: 1.4;
}

.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0;
}

.event-name {
  font-size: 0.8125rem;
  color: #555;
}
</style>
