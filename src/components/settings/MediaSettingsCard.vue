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
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()

const platform = ref('windows')
const isWindows = computed(() => platform.value === 'windows')
const saving = ref(false)

onMounted(async () => {
  try {
    platform.value = await getPlatform()
  } catch (err) {
    console.error(err)
  }
})

const { value: enabled, loading: enabledLoading } = useAutoSavedSetting<boolean>({
  initialValue: true,
  load: getMediaActiveEnabled,
  save: setMediaActiveEnabled,
  debounce: 0,
  onSuccess: (val) => message.success(val ? t('settings.messages.mediaActiveOn') : t('settings.messages.mediaActiveOff')),
  onError: () => message.error(t('settings.messages.setFailed')),
})

const { value: whitelistText, loading: whitelistLoading, refresh: refreshWhitelist } = useAutoSavedSetting<string>({
  initialValue: '',
  load: getMediaWhitelistText,
  save: setMediaWhitelistText,
  debounce: 500,
  onSuccess: () => message.success(t('mediaWhitelist.saveSuccess')),
  onError: () => message.error(t('mediaWhitelist.saveFailed')),
})

async function resetWhitelistDefaults() {
  if (!window.confirm(t('mediaWhitelist.confirmReset'))) return
  saving.value = true
  try {
    await setMediaWhitelistText('')
    await refreshWhitelist()
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
        :loading="enabledLoading"
        @update:value="enabled = $event"
      />
    </setting-row>

    <template v-if="isWindows && enabled">
      <div class="divider" />

      <div class="whitelist-header">
        <div>
          <div class="whitelist-title">{{ t('mediaWhitelist.title') }}</div>
          <div class="whitelist-desc">{{ t('mediaWhitelist.desc') }}</div>
        </div>
        <n-button :loading="saving" @click="resetWhitelistDefaults">
          {{ t('mediaWhitelist.resetDefault') }}
        </n-button>
      </div>

      <n-input
        v-model:value="whitelistText"
        type="textarea"
        :placeholder="t('mediaWhitelist.placeholder')"
        :rows="6"
        :disabled="whitelistLoading"
        class="rules-textarea"
      />
    </template>

    <template v-if="!isWindows">
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

.whitelist-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin: 0.75rem 0 0.5rem;
}

.whitelist-title {
  margin: 0 0 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
}

.whitelist-desc {
  margin: 0;
  font-size: 0.75rem;
  color: #8B7AAB;
  line-height: 1.5;
}

.rules-textarea :deep(.n-input__textarea-el) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.6;
}

.platform-hint {
  margin-top: 0.5rem;
}

.platform-hint :deep(.n-alert-body__content) {
  font-size: 0.8125rem;
  line-height: 1.5;
}
</style>
