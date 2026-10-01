<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import {
  getNotificationForwardStatus,
  setNotificationForwardEnabled,
  setNotificationTakeoverEnabled,
  openNotificationPermissionSettings,
  type NotificationForwardStatus,
} from '../../api/tauri'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()

const ready = ref(false)
const loading = ref(false)
const status = ref<NotificationForwardStatus | null>(null)

const enabled = computed(() => status.value?.enabled ?? false)
const takeover = computed(() => status.value?.takeover ?? false)
const access = computed(() => status.value?.access ?? 'unknown')
const supported = computed(() => access.value !== 'unavailable')

// 未授权与待授权的出路相同（去系统设置开「允许应用访问通知」），提示一并给出
const accessBlocked = computed(
  () => supported.value && (access.value === 'denied' || access.value === 'unspecified'),
)
// 开启失败时开关会被回滚成 false，单看 enabled 提示条永远出不来；
// 记一次「尝试过开启」，授权成功收起
const attempted = ref(false)
const showAccessHint = computed(() => accessBlocked.value && (enabled.value || attempted.value))

const accessTag = computed(() => {
  switch (access.value) {
    case 'granted':
      return { type: 'success' as const, label: t('settings.sysNotify.accessGranted') }
    case 'denied':
      return { type: 'warning' as const, label: t('settings.sysNotify.accessDenied') }
    case 'unavailable':
      return { type: 'default' as const, label: t('settings.sysNotify.accessUnavailable') }
    default:
      return { type: 'default' as const, label: t('settings.sysNotify.accessUnspecified') }
  }
})

async function refresh() {
  status.value = await getNotificationForwardStatus()
}

onMounted(() => {
  // 从系统设置授权回来时窗口重新聚焦，借机刷新授权状态
  window.addEventListener('focus', onFocus)
  refresh()
    .catch((e) => console.error(e))
    .finally(() => {
      ready.value = true
    })
})

onUnmounted(() => {
  window.removeEventListener('focus', onFocus)
})

// KeepAlive 下回到设置页时刷新授权状态
onActivated(() => {
  refresh().catch(() => {})
})

async function onToggle(v: boolean) {
  if (v) attempted.value = true
  loading.value = true
  try {
    status.value = await setNotificationForwardEnabled(v)
    if (status.value.enabled) {
      attempted.value = false
    } else {
      message.warning(t('settings.sysNotify.startFailed'))
    }
  } catch {
    message.error(t('settings.messages.saveFailed'))
    refresh().catch(() => {})
  } finally {
    loading.value = false
  }
}

async function applyTakeover(v: boolean) {
  try {
    await setNotificationTakeoverEnabled(v)
    if (status.value) status.value.takeover = v
  } catch {
    message.error(t('settings.messages.saveFailed'))
    refresh().catch(() => {})
  }
}

function onTakeoverToggle(v: boolean) {
  // 开启会修改系统通知设置，先说清楚再动手
  if (!v) {
    applyTakeover(false)
    return
  }
  dialog.warning({
    title: t('settings.sysNotify.takeoverConfirmTitle'),
    content: t('settings.sysNotify.takeoverConfirmBody'),
    positiveText: t('settings.sysNotify.takeoverConfirmOk'),
    negativeText: t('settings.sysNotify.cancel'),
    onPositiveClick: () => applyTakeover(true),
  })
}

function openSystemSettings() {
  openNotificationPermissionSettings().catch(() => {})
}

function onFocus() {
  refresh().catch(() => {})
}
</script>

<template>
  <n-card :title="t('settings.groups.sysNotify')" size="small">
    <n-space vertical :size="14">
      <div class="row">
        <div class="meta">
          <div class="title">{{ t('settings.sysNotify.forwardTitle') }}</div>
          <div class="desc">{{ t('settings.sysNotify.forwardDesc') }}</div>
        </div>
        <div class="side">
          <n-tag size="small" :type="accessTag.type" :bordered="false">
            {{ accessTag.label }}
          </n-tag>
          <n-switch
            :value="enabled"
            :loading="loading || !ready"
            :disabled="!supported"
            @update:value="onToggle"
          />
        </div>
      </div>

      <div v-if="enabled" class="row">
        <div class="meta">
          <div class="title">{{ t('settings.sysNotify.takeoverTitle') }}</div>
          <div class="desc">{{ t('settings.sysNotify.takeoverDesc') }}</div>
        </div>
        <n-switch :value="takeover" @update:value="onTakeoverToggle" />
      </div>

      <div v-if="showAccessHint" class="denied">
        <span class="denied-text">{{ t('settings.sysNotify.deniedHint') }}</span>
        <n-button size="small" secondary @click="openSystemSettings">
          {{ t('settings.sysNotify.openSystemSettings') }}
        </n-button>
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

.meta {
  min-width: 0;
  flex: 1;
}

.side {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ct-text);
}

.desc {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--ct-text-muted);
}

.denied {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  background: var(--ct-error-soft);
  border: 0.0625rem solid var(--ct-error);
  border-radius: 0.5rem;
}

.denied-text {
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--ct-error-strong);
}
</style>
