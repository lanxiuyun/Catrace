<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, useMessage } from 'naive-ui'
import {
  getAccessibilityPermissionStatus,
  getPlatform,
  requestAccessibilityPermission,
} from '../api/tauri'

const { t } = useI18n()
const message = useMessage()

const visible = ref(false)
const requesting = ref(false)
let pollTimer: number | undefined

onMounted(async () => {
  try {
    const platform = await getPlatform()
    if (platform !== 'macos') return
    visible.value = !(await getAccessibilityPermissionStatus())
  } catch (e) {
    console.error('Failed to check accessibility permission', e)
    return
  }
  if (visible.value) startPolling()
})

onUnmounted(stopPolling)

function startPolling() {
  if (pollTimer !== undefined) return
  pollTimer = window.setInterval(async () => {
    try {
      if (await getAccessibilityPermissionStatus()) {
        visible.value = false
        stopPolling()
      }
    } catch {
      // 状态查询失败时保留横幅，等下一轮
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer === undefined) return
  window.clearInterval(pollTimer)
  pollTimer = undefined
}

async function handleAuthorize() {
  requesting.value = true
  try {
    await requestAccessibilityPermission()
    // 系统设置里完成勾选后由轮询自动收起横幅
  } catch (e) {
    message.error(t('settings.messages.accessibilityFailed'))
    console.error(e)
  } finally {
    requesting.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="access-banner" role="alert">
    <svg class="access-banner-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
    <div class="access-banner-copy">
      <strong>{{ t('accessibilityBanner.title') }}</strong>
      <span>{{ t('accessibilityBanner.desc') }}</span>
    </div>
    <NButton size="small" type="warning" :loading="requesting" @click="handleAuthorize">
      {{ t('accessibilityBanner.authorize') }}
    </NButton>
  </div>
</template>

<style scoped>
.access-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--ct-warning-soft);
  border-bottom: 1px solid var(--ct-warning);
  color: var(--ct-warning-strong);
}

.access-banner-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.access-banner-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
}

.access-banner-copy strong {
  font-size: 0.8125rem;
  font-weight: 600;
}

.access-banner-copy span {
  font-size: 0.75rem;
  opacity: 0.85;
}
</style>
