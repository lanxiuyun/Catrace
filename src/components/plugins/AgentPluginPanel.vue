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
  <div class="agent-panel">
    <header class="panel-header">
      <div class="header-left">
        <div class="icon-badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
        </div>
        <div class="header-text">
          <h2 class="panel-title">{{ t('plugins.agent.name') }}</h2>
          <p class="panel-subtitle">{{ t('plugins.agent.subtitle') }}</p>
        </div>
      </div>
      <n-switch
        :value="enabled"
        :loading="enabledLoading"
        :aria-label="t('plugins.agent.switchAria')"
        @update:value="toggleEnabled"
      />
    </header>

    <template v-if="enabled">
      <section class="panel-section">
        <h3 class="section-title">{{ t('settings.agent.hookTitle') }}</h3>
        <div class="section-card">
          <p class="section-desc">{{ t('settings.agent.hookDesc') }}</p>
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
        </div>
      </section>

      <section class="panel-section">
        <h3 class="section-title">{{ t('settings.agent.eventsTitle') }}</h3>
        <div class="section-card">
          <p class="section-desc">{{ t('settings.agent.eventsDesc') }}</p>
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
        </div>
      </section>

      <section class="panel-section">
        <h3 class="section-title">{{ t('settings.agent.soundTitle') }}</h3>
        <div class="section-card">
          <p class="section-desc">{{ t('settings.agent.soundDesc') }}</p>
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
        </div>
      </section>
    </template>

    <p v-else class="disabled-hint">{{ t('plugins.agent.disabledHint') }}</p>
  </div>
</template>

<style scoped>
.agent-panel {
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
  background: #faf8ff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
}

.section-desc {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: #8b7aab;
  line-height: 1.4;
}

.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.event-row + .event-row {
  border-top: 0.0625rem solid #f0ebf7;
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
  min-width: 0;
}

.disabled-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: #8b7aab;
  line-height: 1.5;
}
</style>