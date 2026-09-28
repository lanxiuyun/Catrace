<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NSpace, NSwitch, NTag, useMessage } from 'naive-ui'
import {
  getNotificationForwardStatus,
  setNotificationForwardEnabled,
  setNotificationTakeoverEnabled,
  getNotificationKnownApps,
  setNotificationMutedAumids,
  openNotificationPermissionSettings,
  type NotificationForwardStatus,
  type NotificationKnownApp,
} from '../../api/tauri'

const { t } = useI18n()
const message = useMessage()

const ready = ref(false)
const loading = ref(false)
const status = ref<NotificationForwardStatus | null>(null)
const apps = ref<NotificationKnownApp[]>([])

const enabled = computed(() => status.value?.enabled ?? false)
const takeover = computed(() => status.value?.takeover ?? false)
const access = computed(() => status.value?.access ?? 'unknown')
const supported = computed(() => access.value !== 'unavailable')

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
  if (status.value.enabled) {
    apps.value = await getNotificationKnownApps()
  }
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

// KeepAlive 下回到设置页时刷新（应用列表随通知到达增长）
onActivated(() => {
  refresh().catch(() => {})
})

async function onToggle(v: boolean) {
  loading.value = true
  try {
    status.value = await setNotificationForwardEnabled(v)
    if (!status.value.enabled) {
      message.warning(t('settings.sysNotify.startFailed'))
    }
  } catch {
    message.error(t('settings.messages.saveFailed'))
    refresh().catch(() => {})
  } finally {
    loading.value = false
  }
}

async function onTakeoverToggle(v: boolean) {
  try {
    await setNotificationTakeoverEnabled(v)
    if (status.value) status.value.takeover = v
  } catch {
    message.error(t('settings.messages.saveFailed'))
  }
}

async function toggleMute(app: NotificationKnownApp, allow: boolean) {
  app.muted = !allow
  const muted = apps.value.filter((a) => a.muted).map((a) => a.aumid)
  try {
    await setNotificationMutedAumids(muted)
  } catch {
    app.muted = !app.muted
    message.error(t('settings.messages.saveFailed'))
  }
}

function openSystemSettings() {
  openNotificationPermissionSettings().catch(() => {})
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

      <div v-if="enabled && access === 'denied'" class="denied">
        <span class="denied-text">{{ t('settings.sysNotify.deniedHint') }}</span>
        <n-button size="small" secondary @click="openSystemSettings">
          {{ t('settings.sysNotify.openSystemSettings') }}
        </n-button>
      </div>

      <div v-if="enabled && apps.length" class="apps">
        <div class="apps-title">{{ t('settings.sysNotify.appsTitle') }}</div>
        <div v-for="a in apps" :key="a.aumid" class="app-row">
          <span class="app-name" :title="a.aumid">{{ a.name }}</span>
          <n-switch
            size="small"
            :value="!a.muted"
            @update:value="(v: boolean) => toggleMute(a, v)"
          />
        </div>
        <div class="apps-desc">{{ t('settings.sysNotify.appsDesc') }}</div>
      </div>
      <div v-else-if="enabled" class="apps-empty">
        {{ t('settings.sysNotify.appsEmpty') }}
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
  border: 0.0625rem solid var(--ct-warning-soft);
  border-radius: 0.5rem;
}

.denied-text {
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--ct-text);
}

.apps {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.apps-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ct-text-muted);
}

.app-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0;
}

.app-name {
  font-size: 0.8125rem;
  color: var(--ct-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.apps-desc {
  font-size: 0.6875rem;
  color: var(--ct-text-muted);
}

.apps-empty {
  font-size: 0.75rem;
  color: var(--ct-text-muted);
}
</style>
