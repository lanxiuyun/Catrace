<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NSwitch,
  NButton,
  NInput,
  useMessage,
} from 'naive-ui'
import {
  getVideoActiveRulesText,
  setVideoActiveRulesText,
  getVideoActiveEnabled,
  setVideoActiveEnabled,
} from '../api/tauri'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()

const rulesText = ref('')
const enabled = ref(true)
const loading = ref(false)
const saving = ref(false)

onMounted(async () => {
  loading.value = true
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
    loading.value = false
  }
})

async function toggleEnabled(val: boolean) {
  try {
    await setVideoActiveEnabled(val)
    enabled.value = val
  } catch (err) {
    console.error(err)
    message.error(t('settings.messages.setFailed'))
    enabled.value = !val
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

function goBack() {
  router.push('/settings')
}
</script>

<template>
  <div class="video-rules">
    <div class="page-header">
      <div>
        <h1 class="title">{{ t('videoRules.title') }}</h1>
        <p class="subtitle">{{ t('videoRules.subtitle') }}</p>
      </div>
      <n-button size="small" @click="goBack">
        {{ t('nav.settings') }}
      </n-button>
    </div>

    <div class="group">
      <div class="group-label">{{ t('settings.groups.reminder') }}</div>
      <div class="setting-row">
        <div class="setting-meta">
          <div class="setting-title">{{ t('videoRules.enabled') }}</div>
          <div class="setting-desc">{{ t('videoRules.enabledDesc') }}</div>
        </div>
        <n-switch :value="enabled" @update:value="toggleEnabled" />
      </div>
    </div>

    <div class="group">
      <div class="group-header">
        <div class="group-label">{{ t('videoRules.title') }}</div>
      </div>

      <n-input
        v-model:value="rulesText"
        type="textarea"
        :placeholder="t('videoRules.placeholder')"
        :rows="14"
        :disabled="loading"
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
  </div>
</template>

<style scoped>
.video-rules {
  padding: 32px 40px;
  max-width: 720px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.title {
  font-size: 22px;
  font-weight: 700;
  color: #2E1065;
  margin: 0 0 4px 0;
}
.subtitle {
  font-size: 13px;
  color: #8B7AAB;
  margin: 0;
}

.group {
  background: #fff;
  border: 1px solid #EBE6F2;
  border-radius: 14px;
  padding: 20px 28px;
  margin-bottom: 16px;
}
.group-label {
  font-size: 11px;
  font-weight: 600;
  color: #8B7AAB;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.group-header .group-label {
  margin-bottom: 0;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 14px 0;
}
.setting-meta {
  flex-shrink: 1;
  min-width: 0;
}
.setting-title {
  font-size: 14px;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 2px;
}
.setting-desc {
  font-size: 12px;
  color: #8B7AAB;
}

.rules-textarea :deep(.n-input__textarea-el) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  color: #8B7AAB;
  line-height: 1.5;
  white-space: pre-line;
}

.rule-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #F5F3FF;
}
</style>
