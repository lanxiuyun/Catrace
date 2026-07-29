/** Timer plugin settings panel — main-window ESM via __CATRACE_VUE__.
 * Uses get_plugin_config / set_plugin_config / publish_event / set_external_plugin_enabled.
 */
const vue = globalThis.__CATRACE_VUE__ || {}
const { h, ref, computed, onMounted, watch } = vue
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)

const PLUGIN_ID = 'timer'
const MAX_RULES = 20
const MAX_DAILY_TIMES = 8
const MIN_INTERVAL = 1
const MAX_INTERVAL = 24 * 60
const MIN_CARD_SEC = 3
const MAX_CARD_SEC = 600
const DEFAULT_CARD_SEC = 8

const STYLE_ID = 'catrace-plugin-timer-settings-css'
const CSS = `
/* Host Plugins.vue .plugin-detail owns max-width / padding — panel is business only. */
.timer-settings {
  width: 100%; box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #0f172a;
  display: flex; flex-direction: column; min-height: 0; height: 100%;
}
.timer-settings *, .timer-settings *::before, .timer-settings *::after { box-sizing: border-box; }

.timer-settings .header-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1rem; gap: 0.75rem; flex-wrap: wrap;
}
.timer-settings .header-title {
  display: flex; align-items: center; gap: 0.5rem;
  margin: 0; font-size: 0.875rem; font-weight: 700; color: #1e293b;
  letter-spacing: -0.01em;
}
.timer-settings .count-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 1.25rem; height: 1.25rem; padding: 0 0.5rem;
  border-radius: 999px; background: rgba(226,232,240,0.6); color: #64748b;
  font-size: 0.75rem; font-weight: 600;
}
.timer-settings .header-actions {
  display: flex; align-items: center; gap: 0.5rem;
}
.timer-settings .btn {
  border: none; border-radius: 0.5rem; padding: 0.375rem 0.75rem;
  font-size: 0.75rem; font-weight: 500; cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.375rem;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  line-height: 1.25; font-family: inherit;
}
.timer-settings .btn:disabled { opacity: 0.55; cursor: default; }
.timer-settings .btn-primary {
  background: #7c3aed; color: #fff;
  box-shadow: 0 0.0625rem 0.125rem rgba(124,58,237,0.2);
}
.timer-settings .btn-primary:hover:not(:disabled) { background: #6d28d9; }
.timer-settings .btn-ghost {
  background: #fff; color: #475569; border: 0.0625rem solid #e2e8f0;
  box-shadow: 0 0.0625rem 0.125rem rgba(15,23,42,0.04);
}
.timer-settings .btn-ghost:hover:not(:disabled) {
  background: #f8fafc; border-color: #cbd5e1;
}
.timer-settings .btn > span {
  display: inline-flex; align-items: center; justify-content: center;
  line-height: 0; flex-shrink: 0;
}
.timer-settings .btn svg {
  width: 0.875rem; height: 0.875rem; display: block; flex-shrink: 0;
}
.timer-settings .btn-ghost svg { color: #64748b; }
.timer-settings .btn-danger {
  background: transparent; color: #b91c1c; border: none; box-shadow: none;
  padding: 0.25rem 0.625rem;
}
.timer-settings .btn-danger:hover:not(:disabled) { background: #fff; color: #991b1b; }
.timer-settings .btn-add {
  background: #7c3aed; color: #fff;
  box-shadow: 0 0.0625rem 0.125rem rgba(124,58,237,0.2);
  line-height: 1; align-items: center;
}
.timer-settings .btn-add:hover:not(:disabled) { background: #6d28d9; }
.timer-settings .empty {
  padding: 2rem 1rem; text-align: center; border-radius: 0.75rem;
  border: 0.0625rem dashed #e2e8f0; background: #fff; color: #94a3b8; font-size: 0.875rem;
}
.timer-settings .list { display: flex; flex-direction: column; gap: 0.75rem; }

/* Rule cards — mockup layout */
.timer-settings .rule {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
  padding: 1rem; border-radius: 0.75rem;
  border: 0.0625rem solid rgba(226,232,240,0.9); background: #fff;
  box-shadow: 0 0.0625rem 0.125rem rgba(15,23,42,0.04);
  transition: box-shadow 0.15s ease, opacity 0.15s ease;
}
.timer-settings .rule:hover { box-shadow: 0 0.25rem 0.75rem rgba(15,23,42,0.06); }
.timer-settings .rule.is-off { opacity: 0.75; }
.timer-settings .rule.is-off:hover { opacity: 1; }
.timer-settings .rule-main {
  flex: 1; min-width: 0; max-width: 36rem;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.timer-settings .rule-title-row {
  display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap;
}
.timer-settings .rule-title {
  margin: 0; font-size: 1rem; font-weight: 700; color: #0f172a;
  transition: color 0.15s ease;
}
.timer-settings .rule:hover .rule-title { color: #7c3aed; }
.timer-settings .rule-meta {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  font-size: 0.75rem; font-weight: 500; color: #64748b;
}
.timer-settings .meta-dot {
  width: 0.25rem; height: 0.25rem; border-radius: 999px; background: #cbd5e1; flex-shrink: 0;
}
.timer-settings .meta-chip {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.125rem 0.5rem; border-radius: 0.25rem;
  background: #f8fafc; color: #334155;
  border: 0.0625rem solid #f1f5f9;
  white-space: nowrap;
}
.timer-settings .meta-chip svg {
  width: 0.75rem; height: 0.75rem; color: #8b5cf6; flex-shrink: 0;
}
.timer-settings .meta-chip.daily svg { color: #f59e0b; }
.timer-settings .meta-text { color: #475569; white-space: nowrap; }
.timer-settings .meta-text.muted { color: #64748b; }
.timer-settings .rule-body {
  margin: 0; font-size: 0.75rem; color: #64748b; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.timer-settings .rule-acts {
  display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0;
}
.timer-settings .act-group {
  display: flex; align-items: center; gap: 0.125rem;
  padding: 0.25rem; border-radius: 0.5rem;
  background: #f8fafc; border: 0.0625rem solid #f1f5f9;
}
.timer-settings .act-group .btn {
  padding: 0.25rem 0.625rem; font-size: 0.75rem; font-weight: 500;
  background: transparent; border: none; box-shadow: none; color: #475569;
}
.timer-settings .act-group .btn:hover:not(:disabled) {
  background: #fff; color: #7c3aed;
  box-shadow: 0 0.0625rem 0.125rem rgba(15,23,42,0.05);
}
.timer-settings .switch {
  position: relative; width: 2.75rem; height: 1.5rem; border-radius: 999px;
  border: none; background: #e2e8f0; cursor: pointer; padding: 0.125rem; flex-shrink: 0;
  transition: background 0.2s ease;
}
.timer-settings .switch.on { background: #7c3aed; }
.timer-settings .switch .knob {
  position: absolute; top: 0.125rem; left: 0.125rem;
  width: 1.25rem; height: 1.25rem; border-radius: 999px; background: #fff;
  box-shadow: 0 0.0625rem 0.1875rem rgba(15,23,42,0.15);
  transition: transform 0.2s ease;
}
.timer-settings .switch.on .knob { transform: translateX(1.25rem); }
.timer-settings .switch.sm { width: 2.5rem; height: 1.375rem; }
.timer-settings .switch.sm .knob { width: 1.125rem; height: 1.125rem; }
.timer-settings .switch.sm.on .knob { transform: translateX(1.125rem); }

/* Modal — sectioned layout */
.timer-settings .modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(0.125rem);
  display: flex; align-items: center; justify-content: center; z-index: 50;
  padding: 1rem;
}
.timer-settings .modal {
  width: min(36rem, 100%); background: #fff; border-radius: 1rem;
  border: 0.0625rem solid #e2e8f0;
  box-shadow: 0 1.5rem 3rem rgba(15,23,42,0.16);
  display: flex; flex-direction: column; max-height: 90vh; overflow: hidden;
  padding: 0;
}
.timer-settings .modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.5rem; border-bottom: 0.0625rem solid #f1f5f9;
  background: rgba(248,250,252,0.5); flex-shrink: 0;
}
.timer-settings .modal-head-left {
  display: flex; align-items: center; gap: 0.5rem;
}
.timer-settings .modal-head-icon {
  width: 1.75rem; height: 1.75rem; border-radius: 0.5rem;
  background: #ede9fe; color: #7c3aed;
  display: inline-flex; align-items: center; justify-content: center;
}
.timer-settings .modal-head-icon svg { width: 1rem; height: 1rem; }
.timer-settings .modal-head h3 {
  margin: 0; font-size: 1rem; font-weight: 700; color: #0f172a;
}
.timer-settings .modal-close {
  border: none; background: transparent; color: #94a3b8; cursor: pointer;
  padding: 0.375rem; border-radius: 0.5rem; display: inline-flex;
  transition: background 0.15s ease, color 0.15s ease;
}
.timer-settings .modal-close:hover { background: rgba(226,232,240,0.5); color: #475569; }
.timer-settings .modal-close svg { width: 1rem; height: 1rem; }
.timer-settings .modal-body {
  padding: 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.5rem;
}
.timer-settings .section { display: flex; flex-direction: column; gap: 0.75rem; }
.timer-settings .section-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding-bottom: 0.375rem; border-bottom: 0.0625rem solid #f1f5f9;
}
.timer-settings .section-head svg { width: 1rem; height: 1rem; color: #7c3aed; flex-shrink: 0; }
.timer-settings .section-head span {
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: #64748b;
}
.timer-settings .section-card {
  background: rgba(248,250,252,0.7); border: 0.0625rem solid rgba(226,232,240,0.6);
  border-radius: 0.75rem; padding: 0.875rem; display: flex; flex-direction: column; gap: 0.75rem;
}
.timer-settings .field { margin: 0; }
.timer-settings .field label,
.timer-settings .field-label {
  display: block; margin-bottom: 0.25rem;
  font-size: 0.75rem; font-weight: 600; color: #334155;
}
.timer-settings .field-label .req { color: #ef4444; }
.timer-settings .field input,
.timer-settings .field textarea {
  width: 100%; border: 0.0625rem solid #e2e8f0;
  border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.75rem;
  font-family: inherit; color: #0f172a; background: #fff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.timer-settings .field input:focus,
.timer-settings .field textarea:focus {
  outline: none; border-color: #8b5cf6;
  box-shadow: 0 0 0 0.1875rem rgba(139,92,246,0.15);
}
.timer-settings .field textarea { min-height: 3.5rem; resize: none; }
.timer-settings .field-hint {
  margin: 0.25rem 0 0; font-size: 0.6875rem; color: #94a3b8;
}
.timer-settings .input-unit {
  position: relative; display: flex; align-items: center;
}
.timer-settings .input-unit input { padding-right: 3rem; }
.timer-settings .input-unit .unit {
  position: absolute; right: 0.75rem; font-size: 0.75rem;
  color: #94a3b8; font-weight: 500; pointer-events: none;
}
.timer-settings .mode-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem;
  background: rgba(226,232,240,0.6); padding: 0.25rem; border-radius: 0.5rem;
}
.timer-settings .mode-row button {
  border: none; background: transparent; border-radius: 0.375rem;
  padding: 0.375rem; font-size: 0.75rem; font-weight: 500; cursor: pointer;
  color: #475569; font-family: inherit; transition: all 0.15s ease;
}
.timer-settings .mode-row button:hover { color: #0f172a; }
.timer-settings .mode-row button.active {
  background: #fff; color: #7c3aed; font-weight: 600;
  box-shadow: 0 0.0625rem 0.125rem rgba(15,23,42,0.06);
}
.timer-settings .toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
}
.timer-settings .toggle-row + .toggle-row,
.timer-settings .section-card .field + .toggle-row,
.timer-settings .toggle-row + .field,
.timer-settings .section-divider {
  border-top: 0.0625rem solid rgba(226,232,240,0.6); padding-top: 0.75rem;
}
.timer-settings .toggle-copy { min-width: 0; }
.timer-settings .toggle-copy .t {
  display: block; font-size: 0.75rem; font-weight: 600; color: #334155;
}
.timer-settings .toggle-copy .d {
  display: block; font-size: 0.6875rem; color: #94a3b8; margin-top: 0.125rem;
}
.timer-settings .dimmed { opacity: 0.4; pointer-events: none; }
.timer-settings .times { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.5rem; }
.timer-settings .chip {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.2rem 0.5rem; border-radius: 999px; background: #f1f5f9;
  font-size: 0.75rem; color: #334155;
}
.timer-settings .chip button {
  border: none; background: transparent; color: #94a3b8; cursor: pointer;
  font-size: 0.875rem; line-height: 1; padding: 0;
}
.timer-settings .time-add { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.timer-settings .time-add input { flex: 1; }
.timer-settings .modal-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem;
  padding: 0.875rem 1.5rem; border-top: 0.0625rem solid #f1f5f9;
  background: #f8fafc; flex-shrink: 0;
}
.timer-settings .modal-foot .btn-ghost {
  background: transparent; border: none; box-shadow: none; color: #475569;
}
.timer-settings .modal-foot .btn-ghost:hover:not(:disabled) {
  background: rgba(226,232,240,0.6); color: #1e293b;
}
.timer-settings .modal-foot .btn-primary { padding: 0.5rem 1.25rem; font-weight: 600; }
.timer-settings .panel-main {
  flex: 1 1 auto; min-height: 0;
}
.timer-settings .log-panel {
  margin-top: 1rem; flex-shrink: 0;
  border: 0.0625rem solid #e2e8f0; border-radius: 0.75rem;
  background: #f8fafc; overflow: hidden;
}
.timer-settings .log-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 0.75rem; border-bottom: 0.0625rem solid #e2e8f0;
}
.timer-settings .log-title {
  margin: 0; font-size: 0.75rem; font-weight: 700; color: #64748b;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.timer-settings .log-clear {
  border: none; background: transparent; color: #94a3b8; cursor: pointer;
  font-size: 0.6875rem; font-weight: 500; padding: 0.125rem 0.375rem;
  border-radius: 0.25rem; font-family: inherit;
}
.timer-settings .log-clear:hover { background: #e2e8f0; color: #475569; }
.timer-settings .log-list {
  max-height: 7.5rem; overflow-y: auto; padding: 0.375rem 0;
}
.timer-settings .log-empty {
  padding: 0.625rem 0.75rem; font-size: 0.75rem; color: #94a3b8;
}
.timer-settings .log-item {
  display: flex; align-items: flex-start; gap: 0.5rem;
  padding: 0.25rem 0.75rem; font-size: 0.75rem; line-height: 1.4;
}
.timer-settings .log-time {
  flex-shrink: 0; font-variant-numeric: tabular-nums;
  color: #94a3b8; font-size: 0.6875rem; padding-top: 0.0625rem;
}
.timer-settings .log-text { color: #334155; word-break: break-word; min-width: 0; }
.timer-settings .log-item.ok .log-text { color: #047857; }
.timer-settings .log-item.err .log-text { color: #b91c1c; }
.timer-settings .log-item.warn .log-text { color: #b45309; }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function newRuleId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function normalizeMode(mode) {
  // legacy one-session 'active' → interval
  if (mode === 'daily') return 'daily'
  return 'interval'
}

function wantsResetOnRest(r) {
  if (r && r.mode === 'active') return true
  return !!(r && r.reset_on_rest)
}

const BUILTIN_EYE_ID = '__builtin_eye__'

function createRule(partial = {}) {
  return {
    id: newRuleId(),
    enabled: true,
    title: '',
    body: '',
    mode: 'interval',
    interval_minutes: 60,
    reset_on_rest: false,
    sticky: false,
    card_duration_sec: DEFAULT_CARD_SEC,
    daily_times: [],
    last_fired_at: null,
    last_daily_keys: [],
    builtin: null,
    ...partial,
  }
}

function builtinEyeRule() {
  return createRule({
    id: BUILTIN_EYE_ID,
    enabled: true,
    title: '护眼提醒',
    body: '远眺一下，放松眼睛。',
    mode: 'interval',
    interval_minutes: 20,
    reset_on_rest: true,
    sticky: false,
    card_duration_sec: 25,
    builtin: 'eye',
  })
}

function ensureBuiltinEyeRule(settings) {
  if (!Array.isArray(settings.rules)) settings.rules = []
  if (settings.rules.some((r) => r.builtin === 'eye' || r.id === BUILTIN_EYE_ID)) {
    // Mark legacy eye look-alike as builtin if exactly the builtin id exists without flag.
    const legacy = settings.rules.find((r) => r.id === BUILTIN_EYE_ID)
    if (legacy && !legacy.builtin) legacy.builtin = 'eye'
    return
  }
  settings.rules.unshift(builtinEyeRule())
}

function normalizeHhmm(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Number(n) || min))
}

function portableSettings(settings) {
  return {
    enabled: settings.enabled !== false,
    rules: (settings.rules || []).slice(0, MAX_RULES).map((r) => ({
      id: r.id || newRuleId(),
      enabled: r.enabled !== false,
      title: r.title || '',
      body: r.body || '',
      mode: normalizeMode(r.mode),
      interval_minutes: clamp(r.interval_minutes || 60, MIN_INTERVAL, MAX_INTERVAL),
      reset_on_rest: wantsResetOnRest(r),
      sticky: !!r.sticky,
      card_duration_sec: clamp(r.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC),
      daily_times: (r.daily_times || [])
        .map(normalizeHhmm)
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort()
        .slice(0, MAX_DAILY_TIMES),
      builtin: r.builtin || null,
      // runtime fields stripped from portable config
      last_fired_at: null,
      last_daily_keys: [],
    })),
  }
}



function ruleMetaParts(rule) {
  const stayLabel = rule.sticky
    ? '卡片常驻'
    : `停留 ${clamp(rule.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC)}s`
  let schedule = { kind: 'interval', label: '未设置时间点' }
  if (rule.mode === 'interval') {
    schedule = { kind: 'interval', label: `每 ${rule.interval_minutes} 分钟` }
  } else if (rule.daily_times && rule.daily_times.length) {
    schedule = {
      kind: 'daily',
      label:
        rule.daily_times.length === 1
          ? `定点 ${rule.daily_times[0]}`
          : `定点 ${rule.daily_times.join(', ')}`,
    }
  } else {
    schedule = { kind: 'daily', label: '未设置时间点' }
  }
  return {
    schedule,
    stay: stayLabel,
    restReset: rule.mode === 'interval' && !!rule.reset_on_rest,
  }
}

const ICONS = {
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  timer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M12 5V2"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>`,
  pointer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
}


export default {
  name: 'TimerSettings',
  setup(_props, { expose }) {
    ensureStyles()

    const settings = ref({ enabled: true, rules: [] })
    const loading = ref(true)
    const saving = ref(false)
    const headerLoading = ref(false)
    const testingId = ref(null)
    const logs = ref([])
    const modalOpen = ref(false)
    const editingId = ref(null)
    const draftTime = ref('')
    const form = ref({
      title: '',
      body: '',
      mode: 'interval',
      interval_minutes: 20,
      reset_on_rest: false,
      sticky: false,
      card_duration_sec: DEFAULT_CARD_SEC,
      daily_times: [],
    })

    let saveTimer = null
    const MAX_LOGS = 50

    function formatLogTime(d = new Date()) {
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    function pushLog(type, text) {
      const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: type || 'ok',
        text: String(text || ''),
        time: formatLogTime(),
      }
      logs.value = [entry, ...logs.value].slice(0, MAX_LOGS)
    }

    function clearLogs() {
      logs.value = []
    }

    // Keep name showToast for call sites — appends to bottom log panel.
    function showToast(type, text) {
      pushLog(type, text)
    }

    async function load() {
      loading.value = true
      try {
        const raw = await invoke('get_plugin_config', { pluginId: PLUGIN_ID })
        const s = raw && typeof raw === 'object' ? raw : { enabled: true, rules: [] }
        const next = {
          enabled: s.enabled !== false,
          rules: Array.isArray(s.rules)
            ? s.rules.map((r) =>
                createRule({
                  id: r.id || newRuleId(),
                  enabled: r.enabled !== false,
                  title: r.title || '',
                  body: r.body || '',
                  mode: normalizeMode(r.mode),
                  interval_minutes: Number(r.interval_minutes) || 60,
                  reset_on_rest: wantsResetOnRest(r),
                  sticky: !!r.sticky,
                  card_duration_sec: Number(r.card_duration_sec) || DEFAULT_CARD_SEC,
                  daily_times: Array.isArray(r.daily_times) ? [...r.daily_times] : [],
                  last_fired_at: r.last_fired_at ?? null,
                  last_daily_keys: Array.isArray(r.last_daily_keys) ? [...r.last_daily_keys] : [],
                  builtin: r.builtin || null,
                }),
              )
            : [],
        }
        ensureBuiltinEyeRule(next)
        settings.value = next
      } catch (e) {
        console.warn('[timer settings] load failed', e)
        showToast('err', '加载失败')
      } finally {
        loading.value = false
      }
    }

    async function persist(next) {
      saving.value = true
      try {
        await invoke('set_plugin_config', {
          pluginId: PLUGIN_ID,
          value: portableSettings(next),
        })
      } catch (e) {
        console.warn('[timer settings] save failed', e)
        throw e
      } finally {
        saving.value = false
      }
    }

    function scheduleSave(next) {
      settings.value = next
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        persist(settings.value).catch(() => {})
      }, 400)
    }

    function patch(mutator) {
      const next = {
        enabled: settings.value.enabled,
        rules: settings.value.rules.map((r) => ({
          ...r,
          daily_times: [...(r.daily_times || [])],
          last_daily_keys: [...(r.last_daily_keys || [])],
        })),
      }
      mutator(next)
      scheduleSave(next)
    }

    const headerEnabled = computed(() => settings.value.enabled !== false)

    async function toggleEnabled(val) {
      const previous = settings.value.enabled
      settings.value = { ...settings.value, enabled: val }
      headerLoading.value = true
      try {
        // Header = external plugin enabled (and keep config.enabled in sync).
        await invoke('set_external_plugin_enabled', { id: PLUGIN_ID, enabled: val })
        await invoke('set_plugin_config', {
          pluginId: PLUGIN_ID,
          value: portableSettings({ ...settings.value, enabled: val }),
        })
        window.dispatchEvent(
          new CustomEvent('catrace:plugin-enabled-changed', {
            detail: { id: PLUGIN_ID, enabled: val },
          }),
        )
      } catch (e) {
        settings.value = { ...settings.value, enabled: previous }
      } finally {
        headerLoading.value = false
      }
    }

    function openCreate() {
      if (settings.value.rules.length >= MAX_RULES) {
        showToast('warn', `最多 ${MAX_RULES} 条提醒`)
        return
      }
      editingId.value = null
      form.value = {
        title: '',
        body: '',
        mode: 'interval',
        interval_minutes: 20,
        reset_on_rest: false,
        sticky: false,
        card_duration_sec: DEFAULT_CARD_SEC,
        daily_times: [],
      }
      draftTime.value = ''
      modalOpen.value = true
    }

    function openEdit(rule) {
      editingId.value = rule.id
      form.value = {
        title: rule.title || '',
        body: rule.body || '',
        mode: normalizeMode(rule.mode),
        interval_minutes: rule.interval_minutes || 20,
        reset_on_rest: wantsResetOnRest(rule),
        sticky: !!rule.sticky,
        card_duration_sec: rule.card_duration_sec || DEFAULT_CARD_SEC,
        daily_times: [...(rule.daily_times || [])],
      }
      draftTime.value = ''
      modalOpen.value = true
    }

    function closeModal() {
      modalOpen.value = false
      editingId.value = null
    }

    function addDailyTime() {
      const norm = normalizeHhmm(draftTime.value)
      if (!norm) {
        showToast('err', '时间格式应为 HH:MM')
        return
      }
      if (form.value.daily_times.includes(norm)) {
        showToast('warn', '时间点已存在')
        return
      }
      if (form.value.daily_times.length >= MAX_DAILY_TIMES) {
        showToast('warn', `最多 ${MAX_DAILY_TIMES} 个时间点`)
        return
      }
      form.value = {
        ...form.value,
        daily_times: [...form.value.daily_times, norm].sort(),
      }
      draftTime.value = ''
    }

    function removeDailyTime(time) {
      form.value = {
        ...form.value,
        daily_times: form.value.daily_times.filter((t) => t !== time),
      }
    }

    function saveModal() {
      const title = (form.value.title || '').trim() || '定时提醒'
      const body = (form.value.body || '').trim()
      if (form.value.mode === 'daily' && !form.value.daily_times.length) {
        showToast('err', '请至少添加一个时间点')
        return
      }
      const mode = normalizeMode(form.value.mode)
      const resetOnRest = mode === 'interval' && !!form.value.reset_on_rest
      const sticky = !!form.value.sticky
      const cardSec = clamp(form.value.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC)
      if (editingId.value) {
        const id = editingId.value
        const editingRule = settings.value.rules.find((r) => r.id === id)
        patch((s) => {
          const rule = s.rules.find((r) => r.id === id)
          if (!rule) return
          rule.title = title
          rule.body = body
          rule.mode = mode
          rule.interval_minutes = clamp(form.value.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
          rule.reset_on_rest = resetOnRest
          rule.sticky = sticky
          rule.card_duration_sec = cardSec
          rule.daily_times = [...form.value.daily_times]
          // Preserve builtin flag when editing.
          if (editingRule && editingRule.builtin) rule.builtin = editingRule.builtin
        })
      } else {
        if (settings.value.rules.length >= MAX_RULES) {
          showToast('warn', `最多 ${MAX_RULES} 条提醒`)
          return
        }
        patch((s) => {
          s.rules.unshift(
            createRule({
              title,
              body: body || '该处理这件事了。',
              mode,
              interval_minutes: clamp(form.value.interval_minutes, MIN_INTERVAL, MAX_INTERVAL),
              reset_on_rest: resetOnRest,
              sticky,
              card_duration_sec: cardSec,
              daily_times: [...form.value.daily_times],
              enabled: true,
            }),
          )
        })
      }
      closeModal()
    }

    function toggleRule(id, enabled) {
      patch((s) => {
        const rule = s.rules.find((r) => r.id === id)
        if (rule) rule.enabled = enabled
      })
    }

    function removeRule(id) {
      const rule = settings.value.rules.find((r) => r.id === id)
      if (rule && rule.builtin) {
        showToast('warn', '内置提醒不可删除')
        return
      }
      patch((s) => {
        s.rules = s.rules.filter((r) => r.id !== id)
      })
    }

    async function sendTest(rule) {
      if (testingId.value) return
      testingId.value = rule ? rule.id : '__global__'
      try {
        const r =
          rule ||
          settings.value.rules[0] ||
          createRule({
            id: 'test',
            title: '定时提醒',
            body: '这是一条测试通知。',
          })
        await invoke('publish_event', {
          event: {
            id: '',
            event_type: 'reminder.timer.due',
            kind: 'timer',
            source: { type: 'plugin', name: PLUGIN_ID },
            display_mode: 'toast',
            level: 'info',
            title: (r.title || '').trim() || '定时提醒',
            body: (r.body || '').trim() || '该处理这件事了。',
            sticky: !!r.sticky,
            actions: [
              { id: 'ack', label: '知道了' },
              { id: 'snooze_5', label: '5 分钟后' },
              { id: 'skip', label: '跳过' },
            ],
            payload: {
              rule_id: r.id,
              mode: normalizeMode(r.mode),
              // Host ReminderToast reads these for per-card auto-hide.
              auto_hide_ms: r.sticky
                ? 0
                : clamp(r.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC) * 1000,
              card_duration_sec: clamp(
                r.card_duration_sec || DEFAULT_CARD_SEC,
                MIN_CARD_SEC,
                MAX_CARD_SEC,
              ),
            },
            dedupe_key: `reminder.timer.due:${r.id}`,
          },
        })
        showToast('ok', '已发送测试通知')
        await new Promise((res) => setTimeout(res, 1000))
      } catch (e) {
        console.warn('[timer settings] test failed', e)
        showToast('err', '发送失败')
      } finally {
        testingId.value = null
      }
    }

    onMounted(() => {
      load()
    })

    expose({
      headerEnabled,
      headerLoading,
      toggleEnabled,
    })

    return () => {
      const mainChildren = []

      mainChildren.push(
        h('div', { class: 'header-row' }, [
          h('h3', { class: 'header-title' }, [
            '提醒列表',
            h('span', { class: 'count-badge' }, String(settings.value.rules.length)),
          ]),
          h('div', { class: 'header-actions' }, [
            h(
              'button',
              {
                type: 'button',
                class: ['btn', 'btn-ghost'],
                disabled: !settings.value.enabled || !!testingId.value,
                onClick: () => sendTest(null),
              },
              [
                h('span', { innerHTML: ICONS.bell }),
                testingId.value === '__global__' ? '发送中…' : '测试全局通知',
              ],
            ),
            h(
              'button',
              {
                type: 'button',
                class: ['btn', 'btn-add'],
                disabled: !settings.value.enabled || settings.value.rules.length >= MAX_RULES,
                onClick: openCreate,
              },
              [h('span', { innerHTML: ICONS.plus }), '新建提醒'],
            ),
          ]),
        ]),
      )

      if (loading.value) {
        mainChildren.push(h('div', { class: 'empty' }, '加载中…'))
      } else if (!settings.value.rules.length) {
        mainChildren.push(h('div', { class: 'empty' }, '还没有提醒，点击右上角「新建提醒」开始'))
      } else {
        mainChildren.push(
          h(
            'div',
            { class: 'list' },
            settings.value.rules.map((rule) => {
              const meta = ruleMetaParts(rule)
              const metaNodes = [
                h(
                  'span',
                  { class: ['meta-chip', meta.schedule.kind === 'daily' ? 'daily' : ''] },
                  [
                    h('span', {
                      innerHTML: meta.schedule.kind === 'daily' ? ICONS.clock : ICONS.timer,
                    }),
                    meta.schedule.label,
                  ],
                ),
                h('span', { class: 'meta-dot' }),
                h(
                  'span',
                  { class: ['meta-text', rule.sticky ? 'muted' : ''] },
                  meta.stay,
                ),
              ]
              if (meta.restReset) {
                metaNodes.push(h('span', { class: 'meta-dot' }))
                metaNodes.push(h('span', { class: 'meta-text muted' }, '休息重置'))
              }

              const actBtns = [
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    disabled: !!testingId.value,
                    onClick: () => sendTest(rule),
                  },
                  testingId.value === rule.id ? '…' : '测试',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    onClick: () => openEdit(rule),
                  },
                  '编辑',
                ),
              ]
              if (!rule.builtin) {
                actBtns.push(
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['btn', 'btn-danger'],
                      onClick: () => removeRule(rule.id),
                    },
                    '删除',
                  ),
                )
              }

              return h('div', { key: rule.id, class: ['rule', rule.enabled ? '' : 'is-off'] }, [
                h('div', { class: 'rule-main' }, [
                  h('div', { class: 'rule-title-row' }, [
                    h('h4', { class: 'rule-title' }, rule.title || '定时提醒'),
                    h('div', { class: 'rule-meta' }, metaNodes),
                  ]),
                  rule.body ? h('p', { class: 'rule-body' }, `“${rule.body}”`) : null,
                ]),
                h('div', { class: 'rule-acts' }, [
                  h('div', { class: 'act-group' }, actBtns),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['switch', rule.enabled ? 'on' : ''],
                      'aria-label': '启用提醒',
                      onClick: () => toggleRule(rule.id, !rule.enabled),
                    },
                    [h('span', { class: 'knob' })],
                  ),
                ]),
              ])
            }),
          ),
        )
      }

      if (modalOpen.value) {
        const isEdit = !!editingId.value
        mainChildren.push(
          h(
            'div',
            {
              class: 'modal-mask',
              onClick: (e) => {
                if (e.target === e.currentTarget) closeModal()
              },
            },
            [
              h('div', { class: 'modal' }, [
                h('div', { class: 'modal-head' }, [
                  h('div', { class: 'modal-head-left' }, [
                    h('div', { class: 'modal-head-icon', innerHTML: ICONS.sliders }),
                    h('h3', null, isEdit ? '编辑提醒' : '新建提醒'),
                  ]),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'modal-close',
                      'aria-label': '关闭',
                      onClick: closeModal,
                    },
                    [h('span', { innerHTML: ICONS.x })],
                  ),
                ]),
                h('div', { class: 'modal-body' }, [
                  h('div', { class: 'section' }, [
                    h('div', { class: 'section-head' }, [
                      h('span', { innerHTML: ICONS.file }),
                      h('span', null, '基本内容'),
                    ]),
                    h('div', { class: 'field' }, [
                      h('label', { class: 'field-label' }, [
                        '提醒标题 ',
                        h('span', { class: 'req' }, '*'),
                      ]),
                      h('input', {
                        value: form.value.title,
                        placeholder: '给提醒起个名字，如：护眼提醒',
                        onInput: (e) => {
                          form.value = { ...form.value, title: e.target.value }
                        },
                      }),
                    ]),
                    h('div', { class: 'field' }, [
                      h('label', { class: 'field-label' }, '提醒正文'),
                      h('textarea', {
                        value: form.value.body,
                        placeholder: '弹出通知卡片时显示的提示文字...',
                        rows: 2,
                        onInput: (e) => {
                          form.value = { ...form.value, body: e.target.value }
                        },
                      }),
                    ]),
                  ]),

                  h('div', { class: 'section' }, [
                    h('div', { class: 'section-head' }, [
                      h('span', { innerHTML: ICONS.clock }),
                      h('span', null, '触发调度'),
                    ]),
                    h('div', { class: 'section-card' }, [
                      h('div', { class: 'field' }, [
                        h('label', { class: 'field-label' }, '触发模式'),
                        h('div', { class: 'mode-row' }, [
                          h(
                            'button',
                            {
                              type: 'button',
                              class: form.value.mode === 'interval' ? 'active' : '',
                              onClick: () => {
                                form.value = { ...form.value, mode: 'interval' }
                              },
                            },
                            '时间间隔',
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              class: form.value.mode === 'daily' ? 'active' : '',
                              onClick: () => {
                                form.value = { ...form.value, mode: 'daily' }
                              },
                            },
                            '每日定点',
                          ),
                        ]),
                      ]),
                      form.value.mode === 'interval'
                        ? h('div', { class: 'field' }, [
                            h('label', { class: 'field-label' }, '时间间隔'),
                            h('div', { class: 'input-unit' }, [
                              h('input', {
                                type: 'number',
                                min: MIN_INTERVAL,
                                max: MAX_INTERVAL,
                                value: form.value.interval_minutes,
                                onInput: (e) => {
                                  form.value = {
                                    ...form.value,
                                    interval_minutes: clamp(
                                      e.target.value,
                                      MIN_INTERVAL,
                                      MAX_INTERVAL,
                                    ),
                                  }
                                },
                              }),
                              h('span', { class: 'unit' }, '分钟'),
                            ]),
                            h(
                              'p',
                              { class: 'field-hint' },
                              `有效范围: ${MIN_INTERVAL} - ${MAX_INTERVAL} 分钟`,
                            ),
                          ])
                        : h('div', { class: 'field' }, [
                            h('label', { class: 'field-label' }, '时间点（HH:MM）'),
                            h('div', { class: 'times' }, [
                              ...(form.value.daily_times || []).map((t) =>
                                h('span', { key: t, class: 'chip' }, [
                                  t,
                                  h(
                                    'button',
                                    { type: 'button', onClick: () => removeDailyTime(t) },
                                    '×',
                                  ),
                                ]),
                              ),
                            ]),
                            h('div', { class: 'time-add' }, [
                              h('input', {
                                value: draftTime.value,
                                placeholder: '18:00',
                                onInput: (e) => {
                                  draftTime.value = e.target.value
                                },
                                onKeydown: (e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    addDailyTime()
                                  }
                                },
                              }),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  class: ['btn', 'btn-ghost'],
                                  onClick: addDailyTime,
                                },
                                '添加',
                              ),
                            ]),
                          ]),
                      form.value.mode === 'interval'
                        ? h('div', { class: 'toggle-row section-divider' }, [
                            h('div', { class: 'toggle-copy' }, [
                              h('span', { class: 't' }, '休息时重置'),
                              h('span', { class: 'd' }, '无电脑操作时自动重新计算间隔'),
                            ]),
                            h(
                              'button',
                              {
                                type: 'button',
                                class: ['switch', 'sm', form.value.reset_on_rest ? 'on' : ''],
                                'aria-label': '休息时重置',
                                onClick: () => {
                                  form.value = {
                                    ...form.value,
                                    reset_on_rest: !form.value.reset_on_rest,
                                  }
                                },
                              },
                              [h('span', { class: 'knob' })],
                            ),
                          ])
                        : null,
                    ]),
                  ]),

                  h('div', { class: 'section' }, [
                    h('div', { class: 'section-head' }, [
                      h('span', { innerHTML: ICONS.pointer }),
                      h('span', null, '通知卡片行为'),
                    ]),
                    h('div', { class: 'section-card' }, [
                      h('div', { class: 'toggle-row' }, [
                        h('div', { class: 'toggle-copy' }, [
                          h('span', { class: 't' }, '卡片常驻'),
                          h('span', { class: 'd' }, '开启后卡片不会自动消失，需手动点击关闭'),
                        ]),
                        h(
                          'button',
                          {
                            type: 'button',
                            class: ['switch', 'sm', form.value.sticky ? 'on' : ''],
                            'aria-label': '卡片常驻',
                            onClick: () => {
                              form.value = {
                                ...form.value,
                                sticky: !form.value.sticky,
                              }
                            },
                          },
                          [h('span', { class: 'knob' })],
                        ),
                      ]),
                      h(
                        'div',
                        {
                          class: [
                            'field',
                            'section-divider',
                            form.value.sticky ? 'dimmed' : '',
                          ],
                        },
                        [
                          h('label', { class: 'field-label' }, '停留时长'),
                          h('div', { class: 'input-unit' }, [
                            h('input', {
                              type: 'number',
                              min: MIN_CARD_SEC,
                              max: MAX_CARD_SEC,
                              disabled: !!form.value.sticky,
                              value: form.value.card_duration_sec,
                              onInput: (e) => {
                                form.value = {
                                  ...form.value,
                                  card_duration_sec: clamp(
                                    e.target.value,
                                    MIN_CARD_SEC,
                                    MAX_CARD_SEC,
                                  ),
                                }
                              },
                            }),
                            h('span', { class: 'unit' }, '秒'),
                          ]),
                          h(
                            'p',
                            { class: 'field-hint' },
                            `有效范围: ${MIN_CARD_SEC} - ${MAX_CARD_SEC} 秒`,
                          ),
                        ],
                      ),
                    ]),
                  ]),
                ]),
                h('div', { class: 'modal-foot' }, [
                  h(
                    'button',
                    { type: 'button', class: ['btn', 'btn-ghost'], onClick: closeModal },
                    '取消',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['btn', 'btn-primary'],
                      onClick: saveModal,
                    },
                    isEdit ? '保存更改' : '保存',
                  ),
                ]),
              ]),
            ],
          ),
        )
      }

      const logChildren = [
        h('div', { class: 'log-head' }, [
          h('h4', { class: 'log-title' }, '运行日志'),
          logs.value.length
            ? h(
                'button',
                { type: 'button', class: 'log-clear', onClick: clearLogs },
                '清空',
              )
            : null,
        ]),
        h(
          'div',
          { class: 'log-list' },
          logs.value.length
            ? logs.value.map((item) =>
                h('div', { key: item.id, class: ['log-item', item.type] }, [
                  h('span', { class: 'log-time' }, item.time),
                  h('span', { class: 'log-text' }, item.text),
                ]),
              )
            : [h('div', { class: 'log-empty' }, '暂无日志')],
        ),
      ]

      return h('div', { class: 'timer-settings' }, [
        h('div', { class: 'panel-main' }, mainChildren),
        h('div', { class: 'log-panel' }, logChildren),
      ])

    }
  },
}
