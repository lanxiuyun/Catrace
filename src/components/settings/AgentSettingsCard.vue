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
  getSupportedAgents,
  type AgentEventMode,
  type AgentEventModeEntry,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const enabled = ref(true)
const enabledLoading = ref(false)
const agents = ref<string[]>([])
const installedMap = ref<Record<string, boolean>>({})
const busyMap = ref<Record<string, boolean>>({})
const eventModes = ref<AgentEventModeEntry[]>([])
const modeLoading = ref<Record<string, boolean>>({})

const agentNameKeys: Record<string, string> = {
  claude: 'settings.agent.nameClaude',
  codex: 'settings.agent.nameCodex',
  gemini: 'settings.agent.nameGemini',
  kimi: 'settings.agent.nameKimi',
}

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
    agents.value = await getSupportedAgents()
    const results = await Promise.all(
      agents.value.map((a) => isAgentHookInstalled(a).catch(() => false))
    )
    agents.value.forEach((a, i) => {
      installedMap.value[a] = results[i]
    })
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

async function install(agent: string) {
  busyMap.value[agent] = true
  try {
    await installAgentHooks(agent)
    installedMap.value[agent] = true
    message.success(t('settings.agent.installSuccess'))
  } catch (e) {
    message.error(`${t('settings.agent.installFailed')}: ${e}`)
  } finally {
    busyMap.value[agent] = false
  }
}

async function uninstall(agent: string) {
  busyMap.value[agent] = true
  try {
    await uninstallAgentHooks(agent)
    installedMap.value[agent] = false
    message.success(t('settings.agent.uninstallSuccess'))
  } catch {
    message.error(t('settings.agent.uninstallFailed'))
  } finally {
    busyMap.value[agent] = false
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

    <div class="agents-header">
      <div class="events-title">{{ t('settings.agent.hookTitle') }}</div>
      <div class="events-desc">{{ t('settings.agent.hookDesc') }}</div>
    </div>

    <div v-for="agent in agents" :key="agent" class="event-row">
      <div class="agent-label">
        <span class="event-name">{{ t(agentNameKeys[agent] || agent) }}</span>
        <n-tag v-if="installedMap[agent]" type="success" size="small">
          {{ t('settings.agent.installed') }}
        </n-tag>
        <n-tag v-else type="default" size="small">{{ t('settings.agent.notInstalled') }}</n-tag>
      </div>
      <n-button
        v-if="!installedMap[agent]"
        size="small"
        :loading="busyMap[agent]"
        @click="install(agent)"
      >
        {{ t('settings.agent.installBtn') }}
      </n-button>
      <n-button v-else size="small" :loading="busyMap[agent]" @click="uninstall(agent)">
        {{ t('settings.agent.uninstallBtn') }}
      </n-button>
    </div>

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
.agents-header {
  padding: 0.5rem 0 0.25rem;
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

.agent-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
