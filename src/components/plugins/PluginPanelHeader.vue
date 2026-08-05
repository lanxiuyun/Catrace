<script setup lang="ts">
import { NSwitch } from 'naive-ui'
import { useI18n } from 'vue-i18n'

interface Props {
  title: string
  subtitle: string
  enabled: boolean
  loading?: boolean
  switchAriaLabel?: string
  hasSidecar?: boolean
  sidecarRunning?: boolean
  runtimeBlocked?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
  hasSidecar: false,
  sidecarRunning: false,
  runtimeBlocked: false,
})

const { t } = useI18n()

const emit = defineEmits<{
  'update:enabled': [value: boolean]
}>()

function onUpdate(value: boolean) {
  emit('update:enabled', value)
}
</script>

<template>
  <header class="panel-header">
    <div class="header-left">
      <div class="icon-badge" aria-hidden="true">
        <slot name="icon" />
      </div>
      <div class="header-text">
        <div class="title-row">
          <h2 class="panel-title">{{ title }}</h2>
          <span
            v-if="hasSidecar"
            class="sidecar-badge"
            :class="{ running: sidecarRunning }"
            :title="
              sidecarRunning
                ? t('plugins.external.sidecarRunning')
                : t('plugins.external.sidecarStopped')
            "
          >
            <span class="sidecar-dot" aria-hidden="true" />
            {{ t('plugins.external.sidecarBadge') }}
          </span>
          <span v-if="runtimeBlocked" class="node-badge">
            {{ t('plugins.external.nodeMissingTag') }}
          </span>
        </div>
        <p class="panel-subtitle">{{ subtitle }}</p>
      </div>
    </div>

    <n-switch
      :value="enabled"
      :loading="loading"
      :disabled="runtimeBlocked"
      :aria-label="switchAriaLabel"
      @update:value="onUpdate"
    />
  </header>
</template>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: nowrap;
  flex: none;
  padding: 1rem 1.5rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

.icon-badge {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  background: #ede9fe;
  color: #7c3aed;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.header-text {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.panel-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #1e1b4b;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidecar-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  flex-shrink: 0;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.2;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.sidecar-badge.running {
  color: #047857;
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.sidecar-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 999px;
  background: #94a3b8;
}

.sidecar-badge.running .sidecar-dot {
  background: #10b981;
}

.node-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.2;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
}

.panel-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
