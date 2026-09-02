<script setup lang="ts">
import { NSwitch } from 'naive-ui'

interface Props {
  title: string
  subtitle: string
  enabled: boolean
  loading?: boolean
  switchAriaLabel?: string
}

withDefaults(defineProps<Props>(), {
  loading: false,
})

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
        </div>
        <p class="panel-subtitle">{{ subtitle }}</p>
      </div>
    </div>

    <n-switch
      :value="enabled"
      :loading="loading"
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
