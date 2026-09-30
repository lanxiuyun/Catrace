<script setup lang="ts">
import type { EventAction } from '../types/event'

const props = defineProps<{
  appName?: string
  icon?: string
  title: string
  body: string
  isHovered?: boolean
  /** 后端已过滤过的可触发按钮（protocol / 有激活器的 background/foreground） */
  actions?: EventAction[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', action: EventAction): void
}>()

const displayName = () => props.appName || 'Windows'
</script>

<template>
  <div class="notif-toast">
    <div class="header">
      <img v-if="icon" class="app-icon" :src="icon" alt="" />
      <div v-else class="app-icon app-icon-fallback">
        {{ displayName().slice(0, 1).toUpperCase() }}
      </div>
      <span class="app-name">{{ displayName() }}</span>
      <button class="close-btn" aria-label="Close" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <div v-if="!isHovered" class="progress-bar" />
    <p v-if="title" class="notif-title">{{ title }}</p>
    <p v-if="body && body !== title" class="notif-body">{{ body }}</p>
    <div v-if="actions && actions.length" class="notif-actions">
      <button v-for="a in actions" :key="a.id" class="notif-action-btn" @click="emit('action', a)">
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.notif-toast {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  --accent: var(--ct-accent);
  --light-bg: var(--ct-accent-softer);
}

.header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.app-icon {
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 0.25rem;
  flex-shrink: 0;
  object-fit: contain;
}

.app-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--ct-on-accent);
  background: var(--accent);
}

.app-name {
  flex: 1;
  min-width: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.0312rem;
  text-transform: uppercase;
  color: var(--ct-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  background: transparent;
  border-radius: 0.25rem;
  color: var(--ct-text-subtle);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.close-btn:hover {
  background: var(--light-bg);
  color: var(--accent);
}

.progress-bar {
  height: 0.125rem;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--light-bg));
  transform-origin: left center;
  animation: shrink var(--toast-auto-hide-ms, 6000ms) linear forwards;
  margin: 0.375rem 0 0.5rem;
}

@keyframes shrink {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

.notif-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ct-text);
  word-break: break-word;
}

.notif-body {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--ct-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.notif-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
}

/* 等权重的低调描边按钮：系统通知的按钮本身没有主次 */
.notif-action-btn {
  border: 0.0625rem solid var(--ct-border);
  border-radius: 0.375rem;
  padding: 0.3125rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--ct-text);
}
.notif-action-btn:hover {
  background: var(--ct-accent-softer);
  border-color: var(--ct-accent);
  color: var(--ct-accent-strong);
}
</style>
