<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  getUpdateSource,
  setUpdateSource,
  type UpdateSourceId,
} from '../api/tauri'

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
  (e: 'resize'): void
  (e: 'install', source: UpdateSourceId): void
}>()

const { t } = useI18n()
const source = ref<UpdateSourceId>('auto')
const latestNotesUrl = import.meta.env.DEV
  ? 'http://localhost:1420/website/latest/preview.html'
  : 'https://lanxiuyun.github.io/Catrace/latest/'
const isLocalNotesPreview = import.meta.env.DEV
const latestNotesBrowserUrl = 'https://lanxiuyun.github.io/Catrace/latest/'
const notesFrameVisible = ref(import.meta.env.DEV)
const notesFrameFailed = ref(false)
const notesFrameHeight = ref(160)
const notesFrameMaxHeight = 440
let notesFrameTimer: ReturnType<typeof setTimeout> | undefined

function onNotesMessage(event: MessageEvent) {
  const isTrustedOrigin = isLocalNotesPreview
    ? event.origin === 'http://localhost:1420'
    : event.origin === 'https://lanxiuyun.github.io'
  if (!isTrustedOrigin || event.source !== (document.querySelector('.release-notes-frame') as HTMLIFrameElement | null)?.contentWindow) return

  const payload = event.data as { type?: unknown; height?: unknown } | null
  if (!payload || payload.type !== 'catrace-release-notes-height' || typeof payload.height !== 'number') return
  notesFrameHeight.value = Math.max(120, Math.min(Math.ceil(payload.height), notesFrameMaxHeight))
}

function showLatestNotes() {
  notesFrameVisible.value = true
  notesFrameFailed.value = false
  if (notesFrameTimer) clearTimeout(notesFrameTimer)
  notesFrameTimer = setTimeout(() => {
    if (!notesFrameFailed.value) notesFrameFailed.value = true
  }, 8000)
}

function onNotesFrameLoad() {
  notesFrameFailed.value = false
  if (notesFrameTimer) clearTimeout(notesFrameTimer)
}

function openLatestNotes() {
  void openUrl(latestNotesBrowserUrl).catch((error) => console.error('Failed to open release notes:', error))
}

onMounted(() => window.addEventListener('message', onNotesMessage))

onUnmounted(() => {
  if (notesFrameTimer) clearTimeout(notesFrameTimer)
  window.removeEventListener('message', onNotesMessage)
})

const sourceOptions: { id: UpdateSourceId; labelKey: string }[] = [
  { id: 'auto', labelKey: 'settings.update.sourceAuto' },
  { id: 'ghfast', labelKey: 'settings.update.sourceGhfast' },
  { id: 'ghddlc', labelKey: 'settings.update.sourceGhddlc' },
  { id: 'ghproxy', labelKey: 'settings.update.sourceGhproxy' },
  { id: 'github', labelKey: 'settings.update.sourceGithub' },
]

onMounted(async () => {
  try {
    source.value = await getUpdateSource()
  } catch {
    source.value = 'auto'
  }
})

async function onSourceChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as UpdateSourceId
  const prev = source.value
  source.value = next
  try {
    await setUpdateSource(next)
  } catch (e) {
    source.value = prev
    console.error(e)
  }
}
</script>

<template>
  <div class="update-toast">
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot" />
        <h2 class="title">
          {{ t('settings.update.newVersion', { version }) }}
        </h2>
        <select
          class="source-select"
          :value="source"
          :disabled="!!updateInstalling"
          :aria-label="t('settings.update.source')"
          @change="onSourceChange"
        >
          <option v-for="opt in sourceOptions" :key="opt.id" :value="opt.id">
            {{ t(opt.labelKey) }}
          </option>
        </select>
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

    <section v-if="showUpdateBody" class="release-notes" aria-label="最新版本更新说明">
      <iframe
        v-if="notesFrameVisible && !notesFrameFailed"
        class="release-notes-frame"
        :src="latestNotesUrl"
        title="Catrace 最新版本更新说明"
        loading="eager"
        :sandbox="isLocalNotesPreview ? undefined : 'allow-same-origin allow-scripts'"
        referrerpolicy="no-referrer"
        :style="{ height: `${notesFrameHeight}px`, maxHeight: `${notesFrameMaxHeight}px` }"
        @load="onNotesFrameLoad"
      />
      <div v-if="notesFrameFailed" class="release-notes-fallback">
        <p>{{ updateBody || '暂时无法加载官网更新说明，请检查网络后重试。' }}</p>
      </div>
      <div v-if="!isLocalNotesPreview" class="release-notes-footer">
        <button v-if="!notesFrameVisible || notesFrameFailed" type="button" class="notes-link" @click="showLatestNotes">
          {{ notesFrameFailed ? '重试加载' : '加载官网最新说明' }}
        </button>
        <button type="button" class="notes-link" @click="openLatestNotes">浏览器打开 ↗</button>
      </div>
    </section>

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
      <button class="btn btn-primary" :disabled="!!updateInstalling" @click="emit('install', source)">
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
  flex: 1;
}

.pulse-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--ct-warning);
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
  color: var(--ct-warning);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.close-btn {
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--ct-text-subtle);
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--ct-warning-soft);
  color: var(--ct-warning);
}

.close-btn:active {
  transform: scale(0.95);
}

.release-notes {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  margin: 0.125rem 0 0.25rem;
  overflow: hidden;
  border: 1px solid var(--ct-warning-soft);
  border-radius: 0.375rem;
  background: var(--ct-warning-soft);
}

.release-notes-frame {
  display: block;
  width: 100%;
  height: 160px;
  min-height: 120px;
  max-height: 440px;
  border: 0;
  background: #11100f;
}

.release-notes-fallback {
  max-height: 8rem;
  overflow: auto;
  padding: 0.5rem 0.625rem;
  color: var(--ct-warning-strong);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.release-notes-fallback p {
  margin: 0;
}

.release-notes-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  color: var(--ct-warning-strong);
  font-size: 0.6875rem;
}


.notes-link {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
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
  background: var(--ct-surface-2);
  border-radius: 0.25rem;
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ct-warning), var(--ct-warning));
  border-radius: 0.25rem;
  transition: width 0.2s ease;
}

.update-progress-text {
  font-size: 0.75rem;
  color: var(--ct-warning);
  font-variant-numeric: tabular-nums;
  min-width: 2.5em;
  text-align: right;
}

.source-select {
  flex-shrink: 0;
  width: 7.5rem;
  height: 1.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--ct-warning-soft);
  background: var(--ct-warning-soft);
  color: var(--ct-warning);
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0 0.25rem;
  cursor: pointer;
}

.source-select:disabled {
  cursor: not-allowed;
  opacity: 0.7;
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
  background: var(--ct-warning-soft);
  color: var(--ct-warning);
}

.btn-secondary:hover {
  background: var(--ct-warning-soft);
}

.btn-primary {
  background: var(--ct-warning);
  color: var(--ct-on-accent);
}

.btn-primary:hover {
  background: var(--ct-warning);
}

.btn-primary:disabled {
  background: var(--ct-warning-soft);
  cursor: not-allowed;
}

.btn:active {
  transform: scale(0.97);
}
</style>
