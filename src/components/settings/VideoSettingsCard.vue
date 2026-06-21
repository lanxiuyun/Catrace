<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NInput, useMessage } from 'naive-ui'
import {
  getVideoActiveRulesText,
  setVideoActiveRulesText,
  getVideoActiveEnabled,
  setVideoActiveEnabled,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const rulesText = ref('')
const enabled = ref(true)
const loading = ref({ rules: false, enabled: false })
const saving = ref(false)

onMounted(async () => {
  loading.value.rules = true
  try {
    const [text, e] = await Promise.all([
      getVideoActiveRulesText(),
      getVideoActiveEnabled(),
    ])
    rulesText.value = text
    enabled.value = e
  } catch (err) {
    console.error(err)
    message.error(t('videoRules.loadFailed'))
  } finally {
    loading.value.rules = false
  }
})

async function toggleEnabled(val: boolean) {
  loading.value.enabled = true
  try {
    await setVideoActiveEnabled(val)
    enabled.value = val
    message.success(val ? t('settings.messages.videoActiveOn') : t('settings.messages.videoActiveOff'))
  } catch (err) {
    console.error(err)
    message.error(t('settings.messages.setFailed'))
    enabled.value = !val
  } finally {
    loading.value.enabled = false
  }
}

function validatePatterns(text: string): string | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      new RegExp(trimmed)
    } catch {
      return trimmed
    }
  }
  return null
}

async function saveRules() {
  const invalid = validatePatterns(rulesText.value)
  if (invalid) {
    message.error(t('videoRules.invalidPattern', { pattern: invalid }))
    return
  }
  saving.value = true
  try {
    await setVideoActiveRulesText(rulesText.value)
    message.success(t('videoRules.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('videoRules.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function resetDefaults() {
  if (!window.confirm(t('videoRules.confirmReset'))) return
  saving.value = true
  try {
    await setVideoActiveRulesText('')
    rulesText.value = await getVideoActiveRulesText()
    message.success(t('videoRules.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('videoRules.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="group video-group">
    <div class="group-label">{{ t('settings.groups.video') }}</div>

    <setting-row :title="t('settings.video.enabledTitle')" :desc="t('settings.video.enabledDesc')">
      <n-switch
        :value="enabled"
        :loading="loading.enabled"
        @update:value="toggleEnabled"
      />
    </setting-row>

    <div class="divider" />

    <div class="section-header">
      <div class="section-meta">
        <div class="setting-title">{{ t('videoRules.title') }}</div>
        <div class="setting-desc">{{ t('videoRules.subtitle') }}</div>
      </div>
    </div>

    <n-input
      v-model:value="rulesText"
      type="textarea"
      :placeholder="t('videoRules.placeholder')"
      :rows="10"
      :disabled="loading.rules"
      class="rules-textarea"
    />

    <div class="hint">{{ t('videoRules.hint') }}</div>

    <div class="rule-actions">
      <n-button size="small" quaternary @click="resetDefaults">
        {{ t('videoRules.resetDefault') }}
      </n-button>
      <n-button type="primary" size="small" :loading="saving" @click="saveRules">
        {{ t('videoRules.saveRules') }}
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.video-group {
  background: linear-gradient(180deg, #ffffff 0%, #faf8ff 100%);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin: 0.75rem 0;
}

.section-meta {
  flex-shrink: 1;
  min-width: 0;
}

.setting-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0.125rem;
}

.setting-desc {
  font-size: 0.75rem;
  color: #8B7AAB;
}

.rules-textarea :deep(.n-input__textarea-el) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.6;
}

.hint {
  margin-top: 0.625rem;
  font-size: 0.75rem;
  color: #8B7AAB;
  line-height: 1.5;
  white-space: pre-line;
}

.rule-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 0.0625rem solid #F5F3FF;
}
</style>
