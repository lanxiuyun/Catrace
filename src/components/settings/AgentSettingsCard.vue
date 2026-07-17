<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NTag, NRadioGroup, NRadioButton, NInput, NSlider, useMessage } from 'naive-ui'
import {
  getAgentNotificationEnabled,
  setAgentNotificationEnabled,
  installAgentHooks,
  uninstallAgentHooks,
  isAgentHookInstalled,
  getAgentEventModes,
  setAgentEventMode,
  getSupportedAgents,
  getAgentSoundSettings,
  setAgentSoundSettings,
  pickAgentSoundFile,
  type AgentEventMode,
  type AgentEventModeEntry,
  type AgentSoundMode,
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

const soundMode = ref<AgentSoundMode>('builtin')
const soundPath = ref('')
const soundVolume = ref(1.0)
const soundLoading = ref(false)

let soundVolumeTimer: ReturnType<typeof setTimeout> | null = null

async function saveSoundVolume() {
  if (soundVolumeTimer) {
    clearTimeout(soundVolumeTimer)
  }
  soundVolumeTimer = setTimeout(() => {
    saveSound()
  }, 200)
}

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
  PermissionRequest: 'settings.agent.eventPermissionRequest',
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
  try {
    const s = await getAgentSoundSettings()
    soundMode.value = s.mode
    soundPath.value = s.custom_path
    soundVolume.value = s.volume
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

async function saveSound() {
  soundLoading.value = true
  try {
    await setAgentSoundSettings(soundMode.value, soundPath.value, soundVolume.value)
    message.success(t('settings.messages.saved'))
  } catch {
    message.error(t('settings.messages.saveFailed'))
  } finally {
    soundLoading.value = false
  }
}

async function handlePickSoundFile() {
  try {
    const path = await pickAgentSoundFile()
    if (path) {
      soundPath.value = path
      await saveSound()
    }
  } catch {
    message.error(t('settings.messages.saveFailed'))
  }
}
</script>

<template>
  <div class="group">
    <div class="group-label">{{ t('settings.groups.agent') }}</div>

    <setting-row :title="t('settings.agent.enabledTitle')" :desc="t('settings.agent.enabledDesc')">
      <n-switch :value="enabled" :loading="enabledLoading" @update:value="toggleEnabled" />
    </setting-row>

    <template v-if="enabled">
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
      <div class="divider" />

      <div class="events-header">
        <div class="events-title">{{ t('settings.agent.soundTitle') }}</div>
        <div class="events-desc">{{ t('settings.agent.soundDesc') }}</div>
      </div>

      <div class="event-row">
        <span class="event-name">{{ t('settings.agent.soundMode') }}</span>
        <n-radio-group
          :value="soundMode"
          size="small"
          :disabled="soundLoading"
          @update:value="(m: AgentSoundMode) => { soundMode = m; saveSound() }"
        >
          <n-radio-button value="builtin">{{ t('settings.agent.soundBuiltin') }}</n-radio-button>
          <n-radio-button value="custom">{{ t('settings.agent.soundCustom') }}</n-radio-button>
          <n-radio-button value="muted">{{ t('settings.agent.soundMuted') }}</n-radio-button>
        </n-radio-group>
      </div>

      <div v-if="soundMode !== 'muted'" class="event-row">
        <span class="event-name">{{ t('settings.agent.soundVolume') }}</span>
        <div class="sound-volume-row">
          <n-slider
            v-model:value="soundVolume"
            :min="0"
            :max="1"
            :step="0.05"
            :disabled="soundLoading"
            style="width: 8rem"
            @update:value="saveSoundVolume"
          />
          <span class="volume-value">{{ Math.round(soundVolume * 100) }}%</span>
        </div>
      </div>

      <div v-if="soundMode === 'custom'" class="event-row">
        <span class="event-name">{{ t('settings.agent.soundPath') }}</span>
        <div class="sound-path-row">
          <n-input
            v-model:value="soundPath"
            size="small"
            style="max-width: 12rem"
            :placeholder="t('settings.agent.soundPathPlaceholder')"
            @blur="saveSound"
          />
          <n-button size="small" :loading="soundLoading" @click="handlePickSoundFile">
            {{ t('settings.agent.soundPickFile') }}
          </n-button>
        </div>
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

.sound-path-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 18rem;
  flex: 1;
  justify-content: flex-end;
}

.sound-path-row .n-input {
  flex: 1;
}

.sound-volume-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.volume-value {
  font-size: 0.75rem;
  color: #666;
  min-width: 2.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.agent-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
