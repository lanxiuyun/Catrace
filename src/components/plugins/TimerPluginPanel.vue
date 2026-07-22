<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSwitch, NButton, NInput, NModal, useMessage } from 'naive-ui'
import {
  getTimerSettings,
  setTimerSettings,
  testTimerNotification,
  type TimerMode,
  type TimerRule,
  type TimerSettings,
} from '../../api/tauri'
import { useAutoSavedSetting } from '../../composables/useAutoSavedSetting'
import SliderControl from '../settings/SliderControl.vue'
import OverlayScrollbar from '../OverlayScrollbar.vue'

const { t } = useI18n()
const message = useMessage()

const MAX_RULES = 20
const MAX_DAILY_TIMES = 8

function newRuleId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function createRule(partial?: Partial<TimerRule>): TimerRule {
  return {
    id: newRuleId(),
    enabled: true,
    title: '',
    body: '',
    mode: 'interval',
    interval_minutes: 60,
    daily_times: [],
    last_fired_at: null,
    last_daily_keys: [],
    ...partial,
  }
}

const { value: settings, loading } = useAutoSavedSetting<TimerSettings>({
  initialValue: { enabled: true, rules: [] },
  load: async () => {
    const s = await getTimerSettings()
    return {
      enabled: s.enabled !== false,
      rules: Array.isArray(s.rules)
        ? s.rules.map((r) => ({
            id: r.id || newRuleId(),
            enabled: r.enabled !== false,
            title: r.title || '',
            body: r.body || '',
            mode: r.mode === 'daily' ? 'daily' : 'interval',
            interval_minutes: Number(r.interval_minutes) || 60,
            daily_times: Array.isArray(r.daily_times) ? [...r.daily_times] : [],
            last_fired_at: r.last_fired_at ?? null,
            last_daily_keys: Array.isArray(r.last_daily_keys) ? [...r.last_daily_keys] : [],
          }))
        : [],
    }
  },
  save: async (v) => {
    await setTimerSettings(v)
  },
  debounce: 500,
  onSuccess: () => message.success(t('settings.messages.saved')),
  onError: () => message.error(t('settings.messages.saveFailed')),
})

const draftTime = ref('')
const testingId = ref<string | null>(null)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  title: '',
  body: '',
  mode: 'interval' as TimerMode,
  interval_minutes: 20,
  daily_times: [] as string[],
})

const activeCount = computed(() => settings.value.rules.filter((r) => r.enabled).length)

type PresetKey = 'drink' | 'eye' | 'stand' | 'offwork'

type Preset = {
  key: PresetKey
  label: string
  hint: string
  icon: string
  rule: Omit<TimerRule, 'id' | 'last_fired_at' | 'last_daily_keys'>
}

const presets = computed(<() => Preset[]>(() => [
  {
    key: 'drink',
    label: t('plugins.timer.presetDrink'),
    hint: t('plugins.timer.presetDrinkHint'),
    icon: '💧',
    rule: {
      title: t('plugins.timer.presetDrink'),
      body: t('plugins.timer.presetDrinkBody'),
      mode: 'interval',
      interval_minutes: 20,
      daily_times: [],
      enabled: true,
    },
  },
  {
    key: 'eye',
    label: t('plugins.timer.presetEye'),
    hint: t('plugins.timer.presetEyeHint'),
    icon: '👁️',
    rule: {
      title: t('plugins.timer.presetEye'),
      body: t('plugins.timer.presetEyeBody'),
      mode: 'interval',
      interval_minutes: 45,
      daily_times: [],
      enabled: true,
    },
  },
  {
    key: 'stand',
    label: t('plugins.timer.presetStand'),
    hint: t('plugins.timer.presetStandHint'),
    icon: '🚶',
    rule: {
      title: t('plugins.timer.presetStand'),
      body: t('plugins.timer.presetStandBody'),
      mode: 'interval',
      interval_minutes: 60,
      daily_times: [],
      enabled: true,
    },
  },
  {
    key: 'offwork',
    label: t('plugins.timer.presetOffwork'),
    hint: t('plugins.timer.presetOffworkHint'),
    icon: '📝',
    rule: {
      title: t('plugins.timer.presetOffwork'),
      body: t('plugins.timer.presetOffworkBody'),
      mode: 'daily',
      interval_minutes: 60,
      daily_times: ['18:00'],
      enabled: true,
    },
  },
]))

function patchSettings(mutator: (s: TimerSettings) => void) {
  const next: TimerSettings = {
    enabled: settings.value.enabled,
    rules: settings.value.rules.map((r) => ({
      ...r,
      daily_times: [...r.daily_times],
      last_daily_keys: r.last_daily_keys ? [...r.last_daily_keys] : [],
    })),
  }
  mutator(next)
  settings.value = next
}

function setEnabled(v: boolean) {
  patchSettings((s) => {
    s.enabled = v
  })
}

type RuleIcon = 'water' | 'eye' | 'stand' | 'work' | 'default'

function ruleIconType(title: string): RuleIcon {
  if (/水|drink|water/i.test(title)) return 'water'
  if (/眼|eye|远眺/i.test(title)) return 'eye'
  if (/站|坐|stand|stretch/i.test(title)) return 'stand'
  if (/班|总结|log|off/i.test(title)) return 'work'
  return 'default'
}

function scheduleTag(rule: TimerRule): string {
  if (rule.mode === 'interval') {
    return t('plugins.timer.tagInterval', { n: rule.interval_minutes })
  }
  if (!rule.daily_times.length) return t('plugins.timer.dailyEmptyHint')
  if (rule.daily_times.length === 1) {
    return t('plugins.timer.tagDailyOne', { time: rule.daily_times[0] })
  }
  return t('plugins.timer.tagDailyMany', { times: rule.daily_times.join(', ') })
}

function openCreateModal() {
  if (settings.value.rules.length >= MAX_RULES) {
    message.warning(t('plugins.timer.maxRules', { n: MAX_RULES }))
    return
  }
  editingId.value = null
  form.value = {
    title: '',
    body: '',
    mode: 'interval',
    interval_minutes: 20,
    daily_times: [],
  }
  draftTime.value = ''
  modalOpen.value = true
}

function openEditModal(rule: TimerRule) {
  editingId.value = rule.id
  form.value = {
    title: rule.title,
    body: rule.body,
    mode: rule.mode,
    interval_minutes: rule.interval_minutes || 20,
    daily_times: [...rule.daily_times],
  }
  draftTime.value = ''
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
}

function setFormMode(mode: TimerMode) {
  form.value.mode = mode
}

function normalizeHhmm(raw: string): string | null {
  const s = raw.trim()
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function addDailyTime() {
  const norm = normalizeHhmm(draftTime.value)
  if (!norm) {
    message.error(t('plugins.timer.invalidTime'))
    return
  }
  if (form.value.daily_times.includes(norm)) {
    message.warning(t('plugins.timer.duplicateTime'))
    return
  }
  if (form.value.daily_times.length >= MAX_DAILY_TIMES) {
    message.warning(t('plugins.timer.maxTimes', { n: MAX_DAILY_TIMES }))
    return
  }
  form.value.daily_times = [...form.value.daily_times, norm].sort()
  draftTime.value = ''
}

function removeDailyTime(time: string) {
  form.value.daily_times = form.value.daily_times.filter((x) => x !== time)
}

function saveModal() {
  const title = form.value.title.trim() || t('plugins.timer.defaultRuleTitle')
  const body = form.value.body.trim()
  if (form.value.mode === 'daily' && !form.value.daily_times.length) {
    message.error(t('plugins.timer.dailyEmptyHint'))
    return
  }

  if (editingId.value) {
    const id = editingId.value
    patchSettings((s) => {
      const rule = s.rules.find((r) => r.id === id)
      if (!rule) return
      rule.title = title
      rule.body = body
      rule.mode = form.value.mode
      rule.interval_minutes = form.value.interval_minutes
      rule.daily_times = [...form.value.daily_times]
    })
  } else {
    if (settings.value.rules.length >= MAX_RULES) {
      message.warning(t('plugins.timer.maxRules', { n: MAX_RULES }))
      return
    }
    patchSettings((s) => {
      s.rules.unshift(
        createRule({
          title,
          body: body || t('plugins.timer.defaultRuleBody'),
          mode: form.value.mode,
          interval_minutes: form.value.interval_minutes,
          daily_times: [...form.value.daily_times],
          enabled: true,
        }),
      )
    })
  }
  closeModal()
}

function addPreset(key: PresetKey) {
  if (settings.value.rules.length >= MAX_RULES) {
    message.warning(t('plugins.timer.maxRules', { n: MAX_RULES }))
    return
  }
  const preset = presets.value.find((p) => p.key === key)
  if (!preset) return
  patchSettings((s) => {
    s.rules.unshift(createRule({ ...preset.rule }))
  })
  message.success(t('plugins.timer.presetAdded', { name: preset.rule.title }))
}

function toggleRule(id: string, enabled: boolean) {
  patchSettings((s) => {
    const rule = s.rules.find((r) => r.id === id)
    if (rule) rule.enabled = enabled
  })
}

function removeRule(id: string) {
  patchSettings((s) => {
    s.rules = s.rules.filter((r) => r.id !== id)
  })
}

async function sendTest(ruleId?: string) {
  if (testingId.value) return
  testingId.value = ruleId ?? '__global__'
  try {
    await testTimerNotification(ruleId)
    message.success(t('settings.messages.notifySent'))
    await new Promise<void>((r) => setTimeout(r, 1000))
  } catch {
    message.error(t('settings.messages.notifyFailed'))
  } finally {
    testingId.value = null
  }
}

async function previewModal() {
  const title = form.value.title.trim() || t('plugins.timer.defaultRuleTitle')
  const body = form.value.body.trim() || t('plugins.timer.bodyPlaceholder')
  // temporary local toast via message for modal preview when no rule id yet
  if (editingId.value) {
    await sendTest(editingId.value)
    return
  }
  message.info(`${title} · ${body}`, { duration: 3000 })
}

function focusNameInput() {
  void nextTick(() => {
    const el = document.getElementById('timer-rule-name') as HTMLInputElement | null
    el?.focus()
  })
}
</script>

<template>
  <div class="timer-panel" :class="{ 'is-disabled': !settings.enabled }">
    <header class="panel-header">
      <div class="header-left">
        <div class="icon-badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
            <path d="M16 2l2 2" />
            <path d="M8 2L6 4" />
          </svg>
        </div>
        <div class="header-text">
          <div class="title-row">
            <h2 class="panel-title">{{ t('plugins.timer.name') }}</h2>
            <span class="active-badge" :class="{ off: activeCount === 0 }">
              <span class="dot" />
              {{ t('plugins.timer.activeBadge', { n: activeCount }) }}
            </span>
          </div>
          <p class="panel-subtitle">{{ t('plugins.timer.subtitle') }}</p>
        </div>
      </div>

      <div class="header-actions">
        <div class="master-switch">
          <span class="master-label">{{ t('plugins.timer.pluginStatus') }}</span>
          <n-switch
            :value="settings.enabled"
            :loading="loading"
            :aria-label="t('plugins.timer.switchAria')"
            @update:value="setEnabled"
          />
        </div>
        <n-button type="primary" :disabled="!settings.enabled || settings.rules.length >= MAX_RULES" @click="openCreateModal">
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </template>
          {{ t('plugins.timer.addRule') }}
        </n-button>
      </div>
    </header>

    <div class="panel-content">
      <OverlayScrollbar>
        <div class="panel-body">
          <section class="preset-banner">
            <div class="preset-intro">
        <div class="preset-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 6.9 18.2 8.8 12.4 4 8.8h6.1L12 3z" />
          </svg>
        </div>
        <div>
          <h3 class="preset-title">{{ t('plugins.timer.presetTitle') }}</h3>
          <p class="preset-desc">{{ t('plugins.timer.presetDesc') }}</p>
        </div>
      </div>
      <div class="preset-chips">
        <button
          v-for="p in presets"
          :key="p.key"
          type="button"
          class="preset-chip"
          :disabled="!settings.enabled || settings.rules.length >= MAX_RULES"
          @click="addPreset(p.key)"
        >
          <span class="chip-icon" aria-hidden="true">{{ p.icon }}</span>
          <span class="chip-label">{{ p.label }}</span>
          <span class="chip-hint">{{ p.hint }}</span>
        </button>
      </div>
    </section>

    <section class="rules-section">
      <div class="section-head">
        <h3 class="section-title">
          {{ t('plugins.timer.rulesSection') }}
          <span class="count">({{ settings.rules.length }})</span>
        </h3>
        <span class="section-hint">{{ t('plugins.timer.listHint') }}</span>
      </div>

      <div v-if="!settings.rules.length" class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18.8 4A10 10 0 0 0 4 18.8" />
            <path d="M22 10a10 10 0 0 1-10 10" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
        </div>
        <h4>{{ t('plugins.timer.emptyTitle') }}</h4>
        <p>{{ t('plugins.timer.emptyHint') }}</p>
      </div>

      <div v-else class="rules-list">
        <article
          v-for="rule in settings.rules"
          :key="rule.id"
          class="rule-card"
          :class="{ muted: !settings.enabled || !rule.enabled }"
        >
          <div class="rule-main">
          <div class="rule-emoji" :class="`icon-${ruleIconType(rule.title)}`" aria-hidden="true">
            <svg v-if="ruleIconType(rule.title) === 'water'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
            <svg v-else-if="ruleIconType(rule.title) === 'eye'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else-if="ruleIconType(rule.title) === 'stand'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="2" />
              <path d="M10 10h4l2 6-3 8-3-8z" />
            </svg>
            <svg v-else-if="ruleIconType(rule.title) === 'work'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
              <line x1="10" x2="8" y1="9" y2="9" />
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
            <div class="rule-body">
              <div class="rule-name-row">
                <h4 class="rule-name">{{ rule.title || t('plugins.timer.untitled') }}</h4>
                <span class="tag" :class="rule.mode === 'interval' ? 'tag-interval' : 'tag-daily'">
                  {{ scheduleTag(rule) }}
                </span>
              </div>
              <p class="rule-msg">
                {{ rule.body || t('plugins.timer.defaultBodyFallback') }}
              </p>
            </div>
          </div>

          <div class="rule-ops">
            <n-switch
              :value="rule.enabled"
              size="small"
              :disabled="!settings.enabled"
              @update:value="toggleRule(rule.id, $event)"
            />
            <span class="ops-divider" />
            <button
              type="button"
              class="op-btn primary"
              :disabled="!settings.enabled || testingId === rule.id"
              @click="sendTest(rule.id)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {{ testingId === rule.id ? t('plugins.timer.testing') : t('plugins.timer.testRule') }}
            </button>
            <button
              type="button"
              class="op-icon"
              :title="t('plugins.timer.editRule')"
              :disabled="!settings.enabled"
              @click="openEditModal(rule)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              class="op-icon danger"
              :title="t('plugins.timer.removeRule')"
              :disabled="!settings.enabled"
              @click="removeRule(rule.id)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </article>
      </div>
          </section>
        </div>
      </OverlayScrollbar>
    </div>

    <n-modal
      v-model:show="modalOpen"
      preset="card"
      :title="editingId ? t('plugins.timer.editModalTitle') : t('plugins.timer.createModalTitle')"
      style="width: 28rem; max-width: 94vw;"
      :bordered="false"
      :segmented="{ content: true, footer: 'soft' }"
      @after-enter="focusNameInput"
    >
      <div class="modal-form">
        <label class="field">
          <span class="field-label">{{ t('plugins.timer.titlePlaceholder') }}</span>
          <n-input
            id="timer-rule-name"
            v-model:value="form.title"
            :placeholder="t('plugins.timer.titlePlaceholder')"
          />
        </label>

        <div class="field">
          <span class="field-label">{{ t('plugins.timer.modeTitle') }}</span>
          <div class="mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: form.mode === 'interval' }"
              :aria-selected="form.mode === 'interval'"
              @click="setFormMode('interval')"
            >
              {{ t('plugins.timer.modeInterval') }}
            </button>
            <button
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: form.mode === 'daily' }"
              :aria-selected="form.mode === 'daily'"
              @click="setFormMode('daily')"
            >
              {{ t('plugins.timer.modeDaily') }}
            </button>
          </div>
        </div>

        <div v-if="form.mode === 'interval'" class="config-box">
          <div class="config-head">
            <span>{{ t('plugins.timer.intervalTitle') }}</span>
            <strong>{{ form.interval_minutes }} {{ t('common.minutes') }}</strong>
          </div>
          <slider-control
            :model-value="form.interval_minutes"
            :min="1"
            :max="180"
            :step="1"
            :suffix="' ' + t('common.minutes')"
            @update:model-value="form.interval_minutes = $event"
          />
          <p class="config-hint">{{ t('plugins.timer.intervalDesc') }}</p>
        </div>

        <div v-else class="config-box">
          <span class="field-label">{{ t('plugins.timer.dailyTitle') }}</span>
          <p class="config-hint top">{{ t('plugins.timer.dailyDesc') }}</p>
          <div class="daily-tags">
            <span v-for="time in form.daily_times" :key="time" class="time-chip">
              {{ time }}
              <button type="button" class="time-x" @click="removeDailyTime(time)">×</button>
            </span>
            <span v-if="!form.daily_times.length" class="daily-empty">{{ t('plugins.timer.noTimes') }}</span>
          </div>
          <div class="daily-add">
            <n-input
              v-model:value="draftTime"
              placeholder="09:30"
              style="width: 6rem;"
              :disabled="form.daily_times.length >= MAX_DAILY_TIMES"
              @keyup.enter="addDailyTime"
            />
            <n-button size="small" :disabled="form.daily_times.length >= MAX_DAILY_TIMES" @click="addDailyTime">
              {{ t('plugins.timer.addTime') }}
            </n-button>
          </div>
        </div>

        <label class="field">
          <span class="field-label">{{ t('plugins.timer.bodyTitle') }}</span>
          <n-input
            v-model:value="form.body"
            type="textarea"
            :rows="2"
            :placeholder="t('plugins.timer.bodyPlaceholder')"
          />
        </label>
      </div>

      <template #footer>
        <div class="modal-footer">
          <n-button quaternary size="small" @click="previewModal">
            {{ t('plugins.timer.previewToast') }}
          </n-button>
          <div class="footer-right">
            <n-button @click="closeModal">{{ t('plugins.timer.cancel') }}</n-button>
            <n-button type="primary" @click="saveModal">{{ t('plugins.timer.saveRule') }}</n-button>
          </div>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.timer-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.timer-panel.is-disabled .rules-list,
.timer-panel.is-disabled .preset-banner {
  opacity: 0.72;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  flex: none;
  padding: 1rem 1.5rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}

.panel-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 64rem;
  min-height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 1.5rem 2rem 2rem;
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
  gap: 0.625rem;
  flex-wrap: wrap;
}

.panel-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #1e1b4b;
  line-height: 1.3;
}

.active-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: #d1fae5;
  color: #047857;
  font-size: 0.75rem;
  font-weight: 600;
}

.active-badge .dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
  animation: pulse-dot 1.6s ease infinite;
}

.active-badge.off {
  background: #f1f5f9;
  color: #64748b;
}

.active-badge.off .dot {
  background: #94a3b8;
  animation: none;
}

@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
  50% { box-shadow: 0 0 0 0.25rem rgba(16, 185, 129, 0); }
}

.panel-subtitle {
  margin: 0.3rem 0 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.4;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.master-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.7rem;
  background: #f1f5f9;
  border: 0.0625rem solid #e2e8f0;
  border-radius: 0.625rem;
  flex-shrink: 0;
}

.master-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  white-space: nowrap;
}

.empty-state {
  text-align: center;
  padding: 2.5rem 1rem;
  border-radius: 1.25rem;
  border: 0.0625rem dashed #e2e8f0;
  background: #fff;
}

.empty-icon {
  width: 2.5rem;
  height: 2.5rem;
  margin: 0 auto 0.75rem;
  border-radius: 50%;
  background: #f1f5f9;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
}

.empty-state h4 {
  margin: 0;
  font-size: 0.875rem;
  color: #334155;
}

.empty-state p {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.preset-banner {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1rem 1.1rem;
  border-radius: 0.875rem;
  border: 0.0625rem solid #ddd6fe;
  background: linear-gradient(90deg, rgba(139, 92, 246, 0.1), rgba(168, 85, 247, 0.05) 45%, transparent);
}

.preset-intro {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.preset-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: #fff;
  color: #7c3aed;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0.0625rem 0.125rem rgba(109, 40, 217, 0.08);
  flex-shrink: 0;
}

.preset-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 650;
  color: #1e1b4b;
}

.preset-desc {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: #64748b;
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.7rem;
  border-radius: 0.625rem;
  border: 0.0625rem solid #e2e8f0;
  background: #fff;
  color: #334155;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.chip-icon {
  font-size: 0.9rem;
  line-height: 1;
  margin-right: 0.1rem;
}

.preset-chip:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #c4b5fd;
}

.preset-chip:disabled {
  opacity: 0.55;
  cursor: default;
}

.chip-hint {
  color: #94a3b8;
  font-weight: 500;
}

.rules-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.section-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #475569;
  letter-spacing: 0.02rem;
}

.section-title .count {
  color: #94a3b8;
  font-weight: 600;
}

.section-hint {
  font-size: 0.75rem;
  color: #94a3b8;
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.rule-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
  border-radius: 0.875rem;
  border: 0.0625rem solid #e2e8f0;
  background: #fff;
  box-shadow: 0 0.0625rem 0.125rem rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease;
  flex-wrap: wrap;
}

.rule-card:hover {
  border-color: #ddd6fe;
}

.rule-card.muted {
  opacity: 0.62;
}

.rule-main {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  min-width: 0;
  flex: 1;
}

.rule-emoji {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  background: #f1f5f9;
  color: #64748b;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.rule-card:hover .rule-emoji {
  background: #ede9fe;
  color: #7c3aed;
}

.rule-emoji.icon-water { color: #3b82f6; }
.rule-card:hover .rule-emoji.icon-water { background: #dbeafe; color: #2563eb; }

.rule-emoji.icon-eye { color: #06b6d4; }
.rule-card:hover .rule-emoji.icon-eye { background: #cffafe; color: #0891b2; }

.rule-emoji.icon-stand { color: #f59e0b; }
.rule-card:hover .rule-emoji.icon-stand { background: #fef3c7; color: #d97706; }

.rule-emoji.icon-work { color: #8b5cf6; }
.rule-card:hover .rule-emoji.icon-work { background: #ede9fe; color: #7c3aed; }

.rule-body {
  min-width: 0;
}

.rule-name-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.rule-name {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: #1e1b4b;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.45rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 650;
  border: 0.0625rem solid transparent;
}

.tag-interval {
  background: #f5f3ff;
  color: #6d28d9;
  border-color: #ede9fe;
}

.tag-daily {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}

.rule-msg {
  margin: 0.3rem 0 0;
  font-size: 0.75rem;
  color: #64748b;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 36rem;
}

.rule-ops {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.ops-divider {
  width: 0.0625rem;
  height: 1rem;
  background: #e2e8f0;
  margin: 0 0.1rem;
}

.op-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border: none;
  background: transparent;
  color: #7c3aed;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.35rem;
  border-radius: 0.5rem;
  cursor: pointer;
}

.op-btn:hover:not(:disabled) {
  background: #f5f3ff;
}

.op-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  background: transparent;
  color: #94a3b8;
  border-radius: 0.5rem;
  cursor: pointer;
}

.op-icon:hover:not(:disabled) {
  background: #f1f5f9;
  color: #475569;
}

.op-icon.danger:hover:not(:disabled) {
  background: #fef2f2;
  color: #ef4444;
}

.op-icon:disabled {
  opacity: 0.45;
  cursor: default;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #334155;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem;
  padding: 0.25rem;
  background: #f1f5f9;
  border-radius: 0.625rem;
}

.mode-tab {
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.5rem 0.25rem;
  border-radius: 0.5rem;
  cursor: pointer;
}

.mode-tab.active {
  background: #fff;
  color: #1e1b4b;
  box-shadow: 0 0.0625rem 0.125rem rgba(15, 23, 42, 0.06);
}

.config-box {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.85rem;
  border-radius: 0.75rem;
  border: 0.0625rem solid #f1f5f9;
  background: #f8fafc;
}

.config-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #475569;
  font-weight: 600;
}

.config-head strong {
  color: #7c3aed;
}

.config-hint {
  margin: 0;
  font-size: 0.6875rem;
  color: #94a3b8;
  line-height: 1.4;
}

.config-hint.top {
  margin-top: -0.15rem;
}

.daily-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  min-height: 1.5rem;
  align-items: center;
}

.time-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.45rem;
  border-radius: 0.375rem;
  background: #ede9fe;
  color: #5b21b6;
  font-size: 0.75rem;
  font-weight: 600;
}

.time-x {
  border: none;
  background: transparent;
  color: #7c3aed;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
}

.daily-empty {
  font-size: 0.75rem;
  color: #94a3b8;
}

.daily-add {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
}

.footer-right {
  display: flex;
  gap: 0.5rem;
}

@media (max-width: 40rem) {
  .rule-card {
    align-items: stretch;
    flex-direction: column;
  }

  .rule-ops {
    justify-content: flex-end;
    padding-top: 0.5rem;
    border-top: 0.0625rem solid #f1f5f9;
  }

  .rule-msg {
    white-space: normal;
  }
}
</style>
