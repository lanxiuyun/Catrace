<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openAgentSession } from '../api/tauri'

const { t } = useI18n()

export interface AgentEntry {
  event: string
  sessionId?: string
  cwd?: string
  prompt?: string
  summary?: string
}

const props = defineProps<{
  entries: AgentEntry[]
  sticky: boolean
  remainingMs: number
  lastStartAt: number
  totalMs: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'dismissAll'): void
  /** 仅销掉某一会话条目（多会话聚合卡用）；payload 为 sessionId */
  (e: 'dismissEntry', sessionId: string): void
}>()

// 聚合卡默认展开，用户一眼看到全部待办会话
const expanded = ref(true)
const navigating = ref<number | null>(null)

const EVENT_TITLE_KEYS: Record<string, string> = {
  SessionStart: 'agent.titleIdle',
  UserPromptSubmit: 'agent.titleThinking',
  Stop: 'agent.titleAttention',
  StopFailure: 'agent.titleError',
  Notification: 'agent.titleNotification',
  PermissionRequest: 'agent.titlePermission',
}

const EVENT_BODY_KEYS: Record<string, string> = {
  SessionStart: 'agent.bodyIdle',
  UserPromptSubmit: 'agent.bodyThinking',
  Stop: 'agent.bodyAttention',
  StopFailure: 'agent.bodyError',
  Notification: 'agent.bodyNotification',
  PermissionRequest: 'agent.bodyPermission',
}

interface EventTheme {
  accent: string
  title: string
  body: string
  bg: string
  lightBg: string
  border: string
}

const EVENT_THEMES: Record<string, EventTheme> = {
  PermissionRequest: {
    accent: '#F59E0B',
    title: '#92400E',
    body: '#B45309',
    bg: '#FFFBEB',
    lightBg: '#FEF3C7',
    border: '#FDE68A',
  },
  StopFailure: {
    accent: '#EF4444',
    title: '#991B1B',
    body: '#B91C1C',
    bg: '#FEE2E2',
    lightBg: '#FECACA',
    border: '#FECACA',
  },
  Stop: {
    accent: '#06B6D4',
    title: '#155E75',
    body: '#0E7490',
    bg: '#ECFEFF',
    lightBg: '#CFFAFE',
    border: '#A5F3FC',
  },
  Notification: {
    accent: '#8B5CF6',
    title: '#5B21B6',
    body: '#7C3AED',
    bg: '#F3E8FF',
    lightBg: '#E9D5FF',
    border: '#DDD6FE',
  },
  SessionStart: {
    accent: '#10B981',
    title: '#065F46',
    body: '#047857',
    bg: '#D1FAE5',
    lightBg: '#A7F3D0',
    border: '#6EE7B7',
  },
  UserPromptSubmit: {
    accent: '#6B7280',
    title: '#374151',
    body: '#4B5563',
    bg: '#F3F4F6',
    lightBg: '#E5E7EB',
    border: '#D1D5DB',
  },
}

const EVENT_PRIORITY: Record<string, number> = {
  PermissionRequest: 6,
  StopFailure: 5,
  Stop: 4,
  Notification: 3,
  SessionStart: 2,
  UserPromptSubmit: 1,
}

const DEFAULT_THEME = EVENT_THEMES.Stop

function getTheme(event: string): EventTheme {
  return EVENT_THEMES[event] || DEFAULT_THEME
}

function projectName(cwd?: string): string {
  if (!cwd) return ''
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

function entryTitle(entry: AgentEntry): string {
  return t(EVENT_TITLE_KEYS[entry.event] || 'agent.titleDefault')
}

function entryBody(entry: AgentEntry): string {
  if (entry.summary) return entry.summary
  if (entry.event === 'UserPromptSubmit' && entry.prompt) return entry.prompt
  return t(EVENT_BODY_KEYS[entry.event] || 'agent.bodyDefault')
}

const isMulti = computed(() => props.entries.length > 1)
const first = computed(() => props.entries[0])
const restCount = computed(() => Math.max(0, props.entries.length - 1))

const dominantEvent = computed(() => {
  return props.entries.reduce((best, entry) => {
    const score = EVENT_PRIORITY[entry.event] || 0
    return score > (EVENT_PRIORITY[best] || 0) ? entry.event : best
  }, props.entries[0]?.event || 'Stop')
})

const theme = computed(() => getTheme(dominantEvent.value))

function entryTheme(entry: AgentEntry) {
  return getTheme(entry.event)
}

const headerTitle = computed(() => {
  if (isMulti.value) return t('agent.titlePending', { n: props.entries.length })
  const proj = projectName(first.value?.cwd)
  const base = entryTitle(first.value)
  return proj ? `${proj} — ${base}` : base
})

async function gotoSession(entry: AgentEntry, index: number) {
  if (!entry.sessionId || entry.sessionId === 'unknown') return
  navigating.value = index
  try {
    await openAgentSession(entry.cwd || '', entry.sessionId)
    // 多会话聚合：只销当前条目，其余仍待处理；单条则整卡关闭
    if (isMulti.value) {
      emit('dismissEntry', entry.sessionId)
    } else {
      emit('close')
    }
  } catch {
    // ignore：终端打开失败时保留卡片让用户重试
  } finally {
    navigating.value = null
  }
}

function onCardClick() {
  if (isMulti.value) {
    expanded.value = !expanded.value
  } else {
    gotoSession(first.value, 0)
  }
}
</script>

<template>
  <div
    class="agent-toast"
    :style="{
      '--accent': theme.accent,
      '--title': theme.title,
      '--body': theme.body,
      '--bg': theme.bg,
      '--light-bg': theme.lightBg,
      '--border': theme.border,
    }"
  >
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot" />
        <h2 class="title">{{ headerTitle }}</h2>
      </div>
      <button class="close-btn" @click.stop="emit('close')" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div v-if="!sticky" class="progress-bar" />

    <div class="card-body" @click="onCardClick">
      <!-- 单条 -->
      <template v-if="!isMulti">
        <p class="body-text">{{ entryBody(first) }}</p>
        <div class="hint-row">
          <span class="goto-hint">{{ t('agent.gotoSession') }}</span>
        </div>
      </template>

      <!-- 聚合：折叠显示第一条 + 展开列表 -->
      <template v-else>
        <div class="entry-row">
          <div class="entry-text">
            <div class="entry-meta">
              <span
                class="event-dot"
                :style="{ background: entryTheme(first).accent }"
              />
              <span class="entry-project">{{ projectName(first.cwd) || t('agent.unknownProject') }}</span>
            </div>
            <span class="entry-summary">{{ entryBody(first) }}</span>
          </div>
          <button
            class="goto-btn"
            :disabled="navigating === 0"
            @click.stop="gotoSession(first, 0)"
          >
            {{ t('agent.goto') }}
          </button>
        </div>

        <template v-if="expanded">
          <div
            v-for="(entry, i) in entries.slice(1)"
            :key="i"
            class="entry-row"
            :style="{
              '--accent': entryTheme(entry).accent,
              '--title': entryTheme(entry).title,
              '--body': entryTheme(entry).body,
              '--bg': entryTheme(entry).bg,
              '--light-bg': entryTheme(entry).lightBg,
              '--border': entryTheme(entry).border,
            }"
          >
            <div class="entry-text">
              <div class="entry-meta">
                <span
                  class="event-dot"
                  :style="{ background: entryTheme(entry).accent }"
                />
                <span class="entry-project">{{ projectName(entry.cwd) || t('agent.unknownProject') }}</span>
              </div>
              <span class="entry-summary">{{ entryBody(entry) }}</span>
            </div>
            <button
              class="goto-btn"
              :disabled="navigating === i + 1"
              @click.stop="gotoSession(entry, i + 1)"
            >
              {{ t('agent.goto') }}
            </button>
          </div>
          <button class="dismiss-all-btn" @click.stop="emit('dismissAll')">
            {{ t('agent.dismissAll') }}
          </button>
        </template>

        <div v-else class="expand-hint">
          {{ t('agent.moreCount', { n: restCount }) }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.agent-toast {
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
  background: var(--accent);
  animation: pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

.title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--title);
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
  color: #9C8DB5;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--light-bg);
  color: var(--accent);
}

.close-btn:active {
  transform: scale(0.95);
}

.progress-bar {
  width: 100%;
  height: 0.125rem;
  background: linear-gradient(90deg, var(--accent), var(--light-bg));
  border-radius: 0.0625rem;
  margin: 0.375rem 0 0.5rem;
  animation: progress-shrink 8000ms linear forwards;
}

@keyframes progress-shrink {
  from { width: 100%; }
  to { width: 0%; }
}

.card-body {
  cursor: pointer;
  flex: 1 1 auto;
  min-height: 0;
}

.body-text {
  font-size: 0.8125rem;
  color: var(--body);
  line-height: 1.5;
  margin: 0 0 0.5rem 0;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hint-row {
  display: flex;
  justify-content: flex-end;
}

.goto-hint {
  font-size: 0.6875rem;
  color: var(--accent);
  opacity: 0.8;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0;
  border-bottom: 1px solid var(--border);
}

.entry-row:last-of-type {
  border-bottom: none;
}

.entry-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.entry-meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.event-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.entry-project {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--title);
}

.entry-summary {
  font-size: 0.75rem;
  color: var(--body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.goto-btn {
  flex-shrink: 0;
  height: 1.5rem;
  padding: 0 0.625rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: var(--accent);
  color: #ffffff;
  transition: all 0.2s ease;
}

.goto-btn:hover:not(:disabled) {
  filter: brightness(0.92);
}

.goto-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.expand-hint {
  font-size: 0.6875rem;
  color: var(--accent);
  text-align: center;
  padding: 0.25rem 0;
  opacity: 0.8;
}

.dismiss-all-btn {
  width: 100%;
  height: 1.625rem;
  margin-top: 0.375rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: var(--light-bg);
  color: var(--accent);
  transition: all 0.2s ease;
}

.dismiss-all-btn:hover {
  filter: brightness(0.95);
}
</style>
