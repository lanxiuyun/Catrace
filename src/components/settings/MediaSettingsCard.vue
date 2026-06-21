<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NInput, NAlert, useMessage } from 'naive-ui'
import {
  getMediaActiveEnabled,
  setMediaActiveEnabled,
  getMediaWhitelistText,
  setMediaWhitelistText,
  getPlatform,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const platform = ref('windows')
const isWindows = computed(() => platform.value === 'windows')
const enabled = ref(true)
const whitelistText = ref('')
const loading = ref({ enabled: false, whitelist: false })
const saving = ref(false)

onMounted(async () => {
  loading.value.whitelist = true
  try {
    const [whitelist, e, p] = await Promise.all([
      getMediaWhitelistText(),
      getMediaActiveEnabled(),
      getPlatform(),
    ])
    whitelistText.value = whitelist
    enabled.value = e
    platform.value = p
  } catch (err) {
    console.error(err)
    message.error(t('mediaWhitelist.loadFailed'))
  } finally {
    loading.value.whitelist = false
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
  saving.value = true
  try {
    await setMediaWhitelistText(whitelistText.value)
    message.success(t('mediaWhitelist.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('mediaWhitelist.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function resetWhitelistDefaults() {
  if (!window.confirm(t('mediaWhitelist.confirmReset'))) return
  saving.value = true
  try {
    await setMediaWhitelistText('')
    whitelistText.value = await getMediaWhitelistText()
    message.success(t('mediaWhitelist.saveSuccess'))
  } catch (err) {
    console.error(err)
    message.error(t('mediaWhitelist.saveFailed'))
  } finally {
    saving.value = false
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

    <template v-if="isWindows">
      <div class="divider" />

      <div class="whitelist-title">{{ t('mediaWhitelist.title') }}</div>

      <n-input
        v-model:value="whitelistText"
        type="textarea"
        :placeholder="t('mediaWhitelist.placeholder')"
        :rows="6"
        :disabled="loading.whitelist"
        class="rules-textarea"
      />

      <div class="rule-actions">
        <n-button size="small" quaternary @click="resetWhitelistDefaults">
          {{ t('mediaWhitelist.resetDefault') }}
        </n-button>
        <n-button type="primary" size="small" :loading="saving" @click="saveWhitelist">
          {{ t('mediaWhitelist.saveRules') }}
        </n-button>
      </div>
    </template>

    <template v-else>
      <div class="divider" />
      <n-alert type="info" :show-icon="true" class="platform-hint">
        {{ t('media.unsupportedPlatformHint') }}
      </n-alert>
    </template>
  </div>
</template>

<style scoped>
.media-group {
  background: linear-gradient(180deg, #ffffff 0%, #faf8ff 100%);
}

.whitelist-title {
  margin: 0.75rem 0 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
}

.rules-textarea :deep(.n-input__textarea-el) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.6;
}

.rule-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 0.0625rem solid #F5F3FF;
}

.platform-hint {
  margin-top: 0.5rem;
}

.platform-hint :deep(.n-alert-body__content) {
  font-size: 0.8125rem;
  line-height: 1.5;
}
</style>
