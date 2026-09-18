<script setup lang="ts">
import type { EventAction, EventLevel, EventProgress } from '../types/event'

const props = defineProps<{
  title: string
  body: string
  level?: EventLevel | string
  isHovered?: boolean
  sticky?: boolean
  progress?: EventProgress | null
  actions?: EventAction[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', actionId: string): void
}>()

function levelClass(level?: string) {
  switch (level) {
    case 'success':
      return 'level-success'
    case 'warning':
      return 'level-warning'
    case 'error':
      return 'level-error'
    default:
      return 'level-info'
  }
}
</script>

<template>
  <div class="sdk-toast" :class="levelClass(props.level)">
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot" />
        <h2 class="title">{{ title }}</h2>
      </div>
      <button class="close-btn" aria-label="Close" @click="emit('close')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <div v-if="!sticky" class="progress-bar" :class="{ paused: isHovered }" />
    <p v-if="body" class="body-text">{{ body }}</p>
    <div v-if="progress && progress.total > 0" class="sdk-progress">
      <div class="sdk-progress-track">
        <div
          class="sdk-progress-fill"
          :style="{ width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }"
        />
      </div>
      <div class="sdk-progress-text">
        {{ progress.label || `${Math.round(progress.current)}/${Math.round(progress.total)}` }}
      </div>
    </div>
    <div v-if="actions && actions.length" class="actions">
      <button
        v-for="(a, idx) in actions"
        :key="a.id"
        class="btn"
        :class="idx === actions.length - 1 ? 'btn-primary' : 'btn-secondary'"
        @click="emit('action', a.id)"
      >
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sdk-toast {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  --accent: var(--ct-accent);
  --title: var(--ct-accent-strong);
  --body: var(--ct-accent-strong);
  --light-bg: var(--ct-accent-softer);
}
.sdk-toast.level-success { --accent: var(--ct-success); --title: var(--ct-success-strong); --body: var(--ct-success-strong); --light-bg: var(--ct-success-soft); }
.sdk-toast.level-warning { --accent: var(--ct-warning); --title: var(--ct-warning-strong); --body: var(--ct-warning-strong); --light-bg: var(--ct-warning-soft); }
.sdk-toast.level-error { --accent: var(--ct-error); --title: var(--ct-error-strong); --body: var(--ct-error-strong); --light-bg: var(--ct-error-soft); }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem; }
.header-left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.pulse-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--accent); animation: pulse 1.5s ease-in-out infinite; flex-shrink: 0; }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }
.title { margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--title); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close-btn { flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent; border-radius: 0.25rem; color: var(--ct-text-subtle); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.close-btn:hover { background: var(--light-bg); color: var(--accent); }
.progress-bar { height: 0.125rem; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--light-bg)); transform-origin: left center; animation: shrink var(--toast-auto-hide-ms, 8000ms) linear forwards; margin: 0.25rem 0 0.5rem; }
.progress-bar.paused { animation-play-state: paused; }
@keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.body-text { margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--body); white-space: pre-wrap; word-break: break-word; }
.sdk-progress { margin-top: 0.5rem; }
.sdk-progress-track { height: 0.375rem; border-radius: 999px; background: var(--light-bg); overflow: hidden; }
.sdk-progress-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.2s ease; }
.sdk-progress-text { margin-top: 0.25rem; font-size: 0.75rem; color: var(--body); }
.actions { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.btn { border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.btn-secondary { background: var(--light-bg); color: var(--title); }
.btn-primary { background: var(--accent); color: var(--ct-on-accent); }
.btn:hover { filter: brightness(0.97); }
</style>
