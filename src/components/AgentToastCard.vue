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
  /** Claude 侧栏会话名（transcript ai-title） */
  sessionTitle?: string
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
  /** 内容高度可能变化（展开/收起），请父级重算 toast 窗口 */
  (e: 'layout'): void
}>()

// 聚合卡默认展开，用户一眼看到全部待办会话
const expanded = ref(true)
const navigating = ref<number | null>(null)

/** 事件 → 设置页同款短标签（任务完成 / 出错…） */
const EVENT_LABEL_KEYS: Record<string, string> = {
  SessionStart: 'settings.agent.eventSessionStart',
  UserPromptSubmit: 'settings.agent.eventUserPromptSubmit',
  Stop: 'settings.agent.eventStop',
  StopFailure: 'settings.agent.eventStopFailure',
  Notification: 'settings.agent.eventNotification',
}

const EVENT_BODY_KEYS: Record<string, string> = {
  SessionStart: 'agent.bodyIdle',
  UserPromptSubmit: 'agent.bodyThinking',
  Stop: 'agent.bodyAttention',
  StopFailure: 'agent.bodyError',
  Notification: 'agent.bodyNotification',
}

interface EventTheme {
  accent: string
  title: string
  body: string
  bg: string
  lightBg: string
  border: string
  badgeBg: string
  badgeFg: string
}

const EVENT_THEMES: Record<string, EventTheme> = {
  StopFailure: {
    accent: '#EF4444',
    title: '#991B1B',
    body: '#B91C1C',
    bg: '#FEE2E2',
    lightBg: '#FECACA',
    border: '#FECACA',
    badgeBg: '#FEE2E2',
    badgeFg: '#B91C1C',
  },
  Stop: {
    accent: '#06B6D4',
    title: '#0F172A',
    body: '#475569',
    bg: '#ECFEFF',
    lightBg: '#CFFAFE',
    border: '#A5F3FC',
    badgeBg: '#CFFAFE',
    badgeFg: '#0E7490',
  },
  Notification: {
    accent: '#8B5CF6',
    title: '#0F172A',
    body: '#475569',
    bg: '#F3E8FF',
    lightBg: '#E9D5FF',
    border: '#DDD6FE',
    badgeBg: '#EDE9FE',
    badgeFg: '#6D28D9',
  },
  SessionStart: {
    accent: '#10B981',
    title: '#0F172A',
    body: '#475569',
    bg: '#D1FAE5',
    lightBg: '#A7F3D0',
    border: '#6EE7B7',
    badgeBg: '#D1FAE5',
    badgeFg: '#047857',
  },
  UserPromptSubmit: {
    accent: '#6B7280',
    title: '#0F172A',
    body: '#475569',
    bg: '#F3F4F6',
    lightBg: '#E5E7EB',
    border: '#D1D5DB',
    badgeBg: '#F3F4F6',
    badgeFg: '#4B5563',
  },
}

const EVENT_PRIORITY: Record<string, number> = {
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

/** 项目名 = cwd 最后一段 */
function projectName(cwd?: string): string {
  if (!cwd) return ''
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/** 会话 title：Claude 侧栏名；没有则空（不拿项目名顶替，避免和项目重复） */
function sessionTitleOf(entry?: AgentEntry): string {
  return entry?.sessionTitle?.trim() || ''
}

function eventLabel(event: string): string {
  const key = EVENT_LABEL_KEYS[event]
  return key ? t(key) : event || t('agent.titleDefault')
}

function entryBody(entry: AgentEntry): string {
  if (entry.summary) return entry.summary
  if (entry.event === 'UserPromptSubmit' && entry.prompt) return entry.prompt
  return t(EVENT_BODY_KEYS[entry.event] || 'agent.bodyDefault')
}

/** 主标题行：优先会话 title，否则项目名，再否则通用「AI 助手」 */
function mainTitle(entry?: AgentEntry): string {
  if (!entry) return t('agent.titleDefault')
  return sessionTitleOf(entry) || projectName(entry.cwd) || t('agent.titleDefault')
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
  return mainTitle(first.value)
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
    // 展开/折叠条目数变化 → 通知父级重算窗口高度
    emit('layout')
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
      '--badge-bg': theme.badgeBg,
      '--badge-fg': theme.badgeFg,
    }"
  >
    <!-- 顶栏：title 直接顶格 + 关闭；无呼吸点 -->
    <div class="header">
      <h2 class="title" :title="headerTitle">{{ headerTitle }}</h2>
      <button class="close-btn" @click.stop="emit('close')" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div v-if="!sticky" class="progress-bar" />

    <div class="card-body" @click="onCardClick">
      <!-- 单条：项目 · 事件 chip + 摘要 -->
      <template v-if="!isMulti">
        <div class="meta-row">
          <span v-if="projectName(first.cwd)" class="chip project-chip" :title="first.cwd">
            {{ projectName(first.cwd) }}
          </span>
          <span v-else class="chip project-chip muted">{{ t('agent.unknownProject') }}</span>
          <span class="chip event-chip">{{ eventLabel(first.event) }}</span>
        </div>

        <p class="body-text">{{ entryBody(first) }}</p>

        <div class="hint-row">
          <span class="goto-hint">{{ t('agent.gotoSession') }}</span>
        </div>
      </template>

      <!-- 聚合：每条展示 项目 + 事件 + title -->
      <template v-else>
        <div
          v-for="(entry, i) in (expanded ? entries : entries.slice(0, 1))"
          :key="entry.sessionId || i"
          class="entry-row"
          :style="{
            '--accent': entryTheme(entry).accent,
            '--title': entryTheme(entry).title,
            '--body': entryTheme(entry).body,
            '--bg': entryTheme(entry).bg,
            '--light-bg': entryTheme(entry).lightBg,
            '--border': entryTheme(entry).border,
            '--badge-bg': entryTheme(entry).badgeBg,
            '--badge-fg': entryTheme(entry).badgeFg,
          }"
        >
          <div class="entry-text">
            <div class="meta-row compact">
              <span class="chip project-chip">
                {{ projectName(entry.cwd) || t('agent.unknownProject') }}
              </span>
              <span class="chip event-chip">{{ eventLabel(entry.event) }}</span>
            </div>
            <span class="entry-session" :title="mainTitle(entry)">{{ mainTitle(entry) }}</span>
            <span class="entry-summary">{{ entryBody(entry) }}</span>
          </div>
          <button
            class="goto-btn"
            :disabled="navigating === i"
            @click.stop="gotoSession(entry, i)"
          >
            {{ t('agent.goto') }}
          </button>
        </div>

        <template v-if="expanded && entries.length > 1">
          <button class="dismiss-all-btn" @click.stop="emit('dismissAll')">
            {{ t('agent.dismissAll') }}
          </button>
        </template>

        <div v-else-if="!expanded && restCount > 0" class="expand-hint">
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
  min-height: 1.25rem;
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--title);
  margin: 0;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
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
  margin: 0.25rem 0 0.5rem;
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

/* —— 分层信息 —— */
.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.375rem;
}

.meta-row.compact {
  margin-bottom: 0.2rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  height: 1.25rem;
  padding: 0 0.4375rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-chip {
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  border: 0.0625rem solid rgba(15, 23, 42, 0.08);
}

.project-chip.muted {
  color: #94a3b8;
  font-weight: 500;
}

.event-chip {
  background: var(--badge-bg);
  color: var(--badge-fg);
  border: 0.0625rem solid var(--border);
}

.body-text {
  font-size: 0.75rem;
  color: var(--body);
  line-height: 1.45;
  margin: 0 0 0.5rem 0;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
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
  opacity: 0.85;
  font-weight: 600;
}

/* —— 多会话条目 —— */
.entry-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.entry-row:first-of-type {
  padding-top: 0.125rem;
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

.entry-session {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-summary {
  font-size: 0.6875rem;
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
