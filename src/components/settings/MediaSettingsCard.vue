<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NInput, useMessage } from 'naive-ui'
import {
  getMediaActiveEnabled,
  setMediaActiveEnabled,
  getMediaWhitelistText,
  setMediaWhitelistText,
  getMediaFallbackRulesText,
  setMediaFallbackRulesText,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const enabled = ref(true)
const whitelistText = ref('')
const rulesText = ref('')
const loading = ref({ enabled: false, whitelist: false, rules: false })
const saving = ref({ whitelist: false, rules: false })

onMounted(async () => {
  loading.value.whitelist = true
  loading.value.rules = true
  try {
    const [whitelist, rules, e] = await Promise.all([
      getMediaWhitelistText(),
      getMediaFallbackRulesText(),
      getMediaActiveEnabled(),
    ])
    whitelistText.value = whitelist
    rulesText.value = rules
    enabled.value = e
  } catch (err) {
    console.error(err)
    message.error(t('mediaWhitelist.loadFailed'))
  } finally {
    loading.value.whitelist = false
    loading.value.rules = false
  }
})

async function toggleEnabled(val: boolean) {
  loading.value.enabled = true
  try {
    await setMediaActiveEnabled(val)
    enabled.value = val
    message.success(val ? t('settings.messages.mediaActiveOn') : t('settings.messages.mediaActiveOff'))
  } catch (err) {
    console.error(err)
    message.error(t('settings.messages.setFailed'))
    enabled.value = !val
  } finally {
    loading.value.enabled = false
  }
}

async function saveWhitelist() {
  saving.value.whitelist = true
  try {
    await setMediaWhitelistText(whitelistText.value)
    message.success(t('mediaWhitelist.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('mediaWhitelist.saveFailed'))
  } finally {
    saving.value.whitelist = false
  }
}

async function resetWhitelistDefaults() {
  if (!window.confirm(t('mediaWhitelist.confirmReset'))) return
  saving.value.whitelist = true
  try {
    await setMediaWhitelistText('')
    whitelistText.value = await getMediaWhitelistText()
    message.success(t('mediaWhitelist.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('mediaWhitelist.saveFailed'))
  } finally {
    saving.value.whitelist = false
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
    message.error(t('mediaRules.invalidPattern', { pattern: invalid }))
    return
  }
  saving.value.rules = true
  try {
    await setMediaFallbackRulesText(rulesText.value)
    message.success(t('mediaRules.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('mediaRules.saveFailed'))
  } finally {
    saving.value.rules = false
  }
}

async function resetRulesDefaults() {
  if (!window.confirm(t('mediaRules.confirmReset'))) return
  saving.value.rules = true
  try {
    await setMediaFallbackRulesText('')
    rulesText.value = await getMediaFallbackRulesText()
    message.success(t('mediaRules.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('mediaRules.saveFailed'))
  } finally {
    saving.value.rules = false
  }
}
</script>

<template>
  <div class="group media-group">
    <div class="group-label">{{ t('settings.groups.media') }}</div>

    <setting-row :title="t('settings.media.enabledTitle')" :desc="t('settings.media.enabledDesc')">
      <n-switch
        :value="enabled"
        :loading="loading.enabled"
        @update:value="toggleEnabled"
      />
    </setting-row>

    <div class="divider" />

    <div class="section-header">
      <div class="section-meta">
        <div class="setting-title">{{ t('mediaWhitelist.title') }}</div>
        <div class="setting-desc">{{ t('mediaWhitelist.subtitle') }}</div>
      </div>
    </div>

    <n-input
      v-model:value="whitelistText"
      type="textarea"
      :placeholder="t('mediaWhitelist.placeholder')"
      :rows="6"
      :disabled="loading.whitelist"
      class="rules-textarea"
    />

    <div class="hint">{{ t('mediaWhitelist.hint') }}</div>

    <div class="rule-actions">
      <n-button size="small" quaternary @click="resetWhitelistDefaults">
        {{ t('mediaWhitelist.resetDefault') }}
      </n-button>
      <n-button type="primary" size="small" :loading="saving.whitelist" @click="saveWhitelist">
        {{ t('mediaWhitelist.saveRules') }}
      </n-button>
    </div>

    <div class="divider" />

    <div class="section-header">
      <div class="section-meta">
        <div class="setting-title">{{ t('mediaRules.title') }}</div>
        <div class="setting-desc">{{ t('mediaRules.subtitle') }}</div>
      </div>
    </div>

    <n-input
      v-model:value="rulesText"
      type="textarea"
      :placeholder="t('mediaRules.placeholder')"
      :rows="6"
      :disabled="loading.rules"
      class="rules-textarea"
    />

    <div class="hint">{{ t('mediaRules.hint') }}</div>

    <div class="rule-actions">
      <n-button size="small" quaternary @click="resetRulesDefaults">
        {{ t('mediaRules.resetDefault') }}
      </n-button>
      <n-button type="primary" size="small" :loading="saving.rules" @click="saveRules">
        {{ t('mediaRules.saveRules') }}
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.media-group {
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
