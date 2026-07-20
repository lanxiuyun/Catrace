<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NSpace, NSwitch, NButton, NInput, useMessage, useDialog } from 'naive-ui'
import {
  getEventSdkStatus,
  setEventSdkEnabled,
  rotateEventSdkToken,
} from '../../api/tauri'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()

const ready = ref(false)
const loading = ref(false)
const enabled = ref(true)
const baseUrl = ref('http://127.0.0.1:23457')
const token = ref('')
const showToken = ref(false)

async function refresh() {
  const s = await getEventSdkStatus()
  enabled.value = s.enabled
  baseUrl.value = s.base_url
  token.value = s.token
}

onMounted(async () => {
  try {
    await refresh()
  } catch (e) {
    console.error(e)
  } finally {
    ready.value = true
  }
})

async function onToggle(v: boolean) {
  loading.value = true
  try {
    await setEventSdkEnabled(v)
    enabled.value = v
    message.success(t('settings.messages.saved'))
  } catch {
    enabled.value = !v
    message.error(t('settings.messages.saveFailed'))
  } finally {
    loading.value = false
  }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(token.value)
    message.success(t('settings.eventSdk.copied'))
  } catch {
    message.error(t('settings.messages.saveFailed'))
  }
}

function onRotate() {
  dialog.warning({
    title: t('settings.eventSdk.rotateTitle'),
    content: t('settings.eventSdk.rotateBody'),
    positiveText: t('settings.eventSdk.rotateOk'),
    negativeText: t('settings.eventSdk.cancel'),
    onPositiveClick: async () => {
      loading.value = true
      try {
        token.value = await rotateEventSdkToken()
        message.success(t('settings.eventSdk.rotated'))
      } catch {
        message.error(t('settings.messages.saveFailed'))
      } finally {
        loading.value = false
      }
    },
  })
}
</script>

<template>
  <n-card :title="t('settings.groups.eventSdk')" size="small">
    <n-space vertical :size="14">
      <div class="row">
        <div class="meta">
          <div class="title">{{ t('settings.eventSdk.enableTitle') }}</div>
          <div class="desc">{{ t('settings.eventSdk.enableDesc') }}</div>
        </div>
        <n-switch :value="enabled" :loading="loading || !ready" @update:value="onToggle" />
      </div>

      <div class="row">
        <div class="meta">
          <div class="title">{{ t('settings.eventSdk.endpointTitle') }}</div>
          <div class="desc">{{ t('settings.eventSdk.endpointDesc') }}</div>
        </div>
        <code class="mono">{{ baseUrl }}/v1</code>
      </div>

      <div class="row row-token">
        <div class="meta">
          <div class="title">{{ t('settings.eventSdk.tokenTitle') }}</div>
          <div class="desc">{{ t('settings.eventSdk.tokenDesc') }}</div>
        </div>
        <div class="token-row">
          <n-input
            :value="showToken ? token : '\u2022'.repeat(Math.min(28, token.length || 28))"
            readonly
            size="small"
            class="token-input"
          />
          <n-button size="small" secondary @click="showToken = !showToken">
            {{ showToken ? t('settings.eventSdk.hide') : t('settings.eventSdk.show') }}
          </n-button>
          <n-button size="small" type="primary" @click="copyToken">
            {{ t('settings.eventSdk.copy') }}
          </n-button>
          <n-button size="small" secondary :disabled="loading" @click="onRotate">
            {{ t('settings.eventSdk.rotate') }}
          </n-button>
        </div>
      </div>
    </n-space>
  </n-card>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.row-token {
  align-items: flex-start;
}

.meta {
  min-width: 0;
  flex: 1;
}

.title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2e1065;
}

.desc {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: #8b7aab;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  color: #5b21b6;
  background: #f3e8ff;
  padding: 0.25rem 0.5rem;
  border-radius: 0.5rem;
  white-space: nowrap;
}

.token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: center;
  justify-content: flex-end;
  max-width: 26rem;
}

.token-input {
  width: 11rem;
}
</style>

