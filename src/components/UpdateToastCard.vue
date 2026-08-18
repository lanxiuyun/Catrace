<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  version?: string
  updateBody?: string
  showUpdateBody?: boolean
  updateInstalling?: boolean
  downloadProgress?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggleDetails'): void
  (e: 'install'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="update-toast">
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot" />
        <h2 class="title">
          {{ t('settings.update.newVersion', { version }) }}
        </h2>
      </div>
      <button
        v-if="!updateInstalling"
        class="close-btn"
        aria-label="关闭"
        @click="emit('close')"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div v-if="showUpdateBody && updateBody" class="update-body">
      {{ updateBody }}
    </div>

    <div v-if="updateInstalling" class="update-progress">
      <div class="update-progress-track">
        <div class="update-progress-fill" :style="{ width: `${downloadProgress || 0}%` }" />
      </div>
      <div class="update-progress-text">{{ downloadProgress || 0 }}%</div>
    </div>

    <div class="actions">
      <button class="btn btn-secondary" @click="emit('toggleDetails')">
        {{ showUpdateBody ? t('settings.update.hideDetails') : t('settings.update.viewDetails') }}
      </button>
      <button class="btn btn-primary" :disabled="!!updateInstalling" @click="emit('install')">
        {{ updateInstalling ? t('settings.update.downloading') : t('settings.update.updateNow') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.update-toast {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.pulse-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #f59e0b;
  animation: pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.3);
  }
}

.title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #92400e;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.close-btn {
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #9c8db5;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: #fffbeb;
  color: #d97706;
}

.close-btn:active {
  transform: scale(0.95);
}

.update-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 10rem;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #78350f;
  background: #fffbeb;
  border-radius: 0.375rem;
  padding: 0.5rem 0.625rem;
  margin: 0.375rem 0 0.625rem 0;
}

.update-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.375rem 0 0.625rem;
}

.update-progress-track {
  flex: 1;
  height: 0.375rem;
  background: #f3f4f6;
  border-radius: 0.25rem;
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  border-radius: 0.25rem;
  transition: width 0.2s ease;
}

.update-progress-text {
  font-size: 0.75rem;
  color: #92400e;
  font-variant-numeric: tabular-nums;
  min-width: 2.5em;
  text-align: right;
}

.actions {
  display: flex;
  gap: 0.375rem;
  margin-top: auto;
}

.btn {
  flex: 1;
  height: 1.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.btn-secondary {
  background: #fffbeb;
  color: #d97706;
}

.btn-secondary:hover {
  background: #fef3c7;
}

.btn-primary {
  background: #f59e0b;
  color: #ffffff;
}

.btn-primary:hover {
  background: #d97706;
}

.btn-primary:disabled {
  background: #fcd34d;
  cursor: not-allowed;
}

.btn:active {
  transform: scale(0.97);
}
</style>