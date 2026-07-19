<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NSelect, NButton, useDialog, useMessage } from 'naive-ui'
import { load, type Store } from '@tauri-apps/plugin-store'
import {
  getSignalRuntimeConfig,
  purgeKeySequences,
  setSignalKeySequenceEnabled,
  setSignalKeySequenceRetentionHours,
} from '../../api/tauri'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()

const enabled = ref(false)
const retentionHours = ref(24)
const loading = ref(false)
const ready = ref(false)
let store: Store | null = null

const retentionOptions = [
  { label: '1h', value: 1 },
  { label: '24h', value: 24 },
  { label: '7d', value: 168 },
]

async function getStore() {
  if (!store) store = await load('settings.json', { defaults: {}, autoSave: true })
  return store
}

async function syncBackend() {
  await setSignalKeySequenceEnabled(enabled.value)
  await setSignalKeySequenceRetentionHours(retentionHours.value)
}

onMounted(async () => {
  try {
    const s = await getStore()
    enabled.value = (await s.get<boolean>('signal_key_sequence_enabled')) ?? false
    retentionHours.value = (await s.get<number>('signal_key_sequence_retention_hours')) ?? 24
    await syncBackend()
    // Confirm runtime
    await getSignalRuntimeConfig().catch(() => null)
    ready.value = true
  } catch (e) {
    console.error('Failed to load signal settings', e)
    ready.value = true
  }
})

async function onToggle(v: boolean) {
  if (v) {
    dialog.warning({
      title: t('settings.signal.enableConfirmTitle'),
      content: t('settings.signal.enableConfirmBody'),
      positiveText: t('settings.signal.enableConfirmOk'),
      negativeText: t('settings.signal.cancel'),
      onPositiveClick: async () => {
        loading.value = true
        try {
          enabled.value = true
          const s = await getStore()
          await s.set('signal_key_sequence_enabled', true)
          await setSignalKeySequenceEnabled(true)
          message.success(t('settings.messages.saved'))
        } catch {
          enabled.value = false
          message.error(t('settings.messages.saveFailed'))
        } finally {
          loading.value = false
        }
      },
    })
    return
  }
  loading.value = true
  try {
    enabled.value = false
    const s = await getStore()
    await s.set('signal_key_sequence_enabled', false)
    await setSignalKeySequenceEnabled(false)
    message.success(t('settings.messages.saved'))
  } catch {
    message.error(t('settings.messages.saveFailed'))
  } finally {
    loading.value = false
  }
}

async function onRetention(v: number) {
  loading.value = true
  try {
    retentionHours.value = v
    const s = await getStore()
    await s.set('signal_key_sequence_retention_hours', v)
    await setSignalKeySequenceRetentionHours(v)
    message.success(t('settings.messages.saved'))
  } catch {
    message.error(t('settings.messages.saveFailed'))
  } finally {
    loading.value = false
  }
}

function onPurge() {
  dialog.warning({
    title: t('settings.signal.purgeTitle'),
    content: t('settings.signal.purgeBody'),
    positiveText: t('settings.signal.purgeOk'),
    negativeText: t('settings.signal.cancel'),
    onPositiveClick: async () => {
      try {
        const n = await purgeKeySequences()
        message.success(t('settings.signal.purgeDone', { n }))
      } catch {
        message.error(t('settings.messages.saveFailed'))
      }
    },
  })
}
</script>

<template>
  <div class="group signal-group">
    <div class="group-label">{{ t('settings.groups.signal') }}</div>

    <setting-row
      :title="t('settings.signal.keySeqTitle')"
      :desc="t('settings.signal.keySeqDesc')"
    >
      <n-switch
        :value="enabled"
        :loading="loading || !ready"
        @update:value="onToggle"
      />
    </setting-row>

    <div class="divider" />

    <setting-row
      :title="t('settings.signal.retentionTitle')"
      :desc="t('settings.signal.retentionDesc')"
    >
      <n-select
        :value="retentionHours"
        :options="retentionOptions"
        :disabled="loading"
        style="width: 7rem"
        @update:value="onRetention"
      />
    </setting-row>

    <div class="divider" />

    <setting-row :title="t('settings.signal.purgeTitle')" :desc="t('settings.signal.purgeDesc')">
      <n-button size="small" secondary type="warning" @click="onPurge">
        {{ t('settings.signal.purgeBtn') }}
      </n-button>
    </setting-row>
  </div>
</template>

<style scoped>
.signal-group.group {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-color: #cbd5e1;
}
.signal-group :deep(.group-label) {
  color: #475569;
}
</style>
