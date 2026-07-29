/** Timer plugin settings — host Vue + naive-ui + SettingRow.
 * Uses get_plugin_config / set_plugin_config / publish_event / set_external_plugin_enabled.
 */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const ui = globalThis.__CATRACE_UI__ || {}
const { h, ref, computed, onMounted } = vue
const {
  NButton,
  NInput,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  NTag,
} = naive
const { SettingRow } = ui

if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NSwitch || !NInput || !NModal || !NPopconfirm || !NRadioGroup || !NTag) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!SettingRow) {
  throw new Error('Catrace plugin UI runtime missing (__CATRACE_UI__.SettingRow)')
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
.timer-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; min-height: 0; height: 100%;
  gap: 0.75rem;
  color: #2e1065;
}
.timer-settings *, .timer-settings *::before, .timer-settings *::after { box-sizing: border-box; }

/* top toolbar — outside cards */
.timer-settings .header-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; flex-wrap: wrap;
}
.timer-settings .header-title {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8b7aab;
  text-transform: uppercase;
  letter-spacing: 0.0312rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.timer-settings .header-actions {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
}

.timer-settings .group {
  position: relative;
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  padding: 1rem 1.25rem;
  box-sizing: border-box;
}
.timer-settings .group-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 0.75rem; flex-wrap: wrap;
  margin-bottom: 0.25rem;
}
.timer-settings .group-label {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #8b7aab;
  text-transform: uppercase;
  letter-spacing: 0.0312rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.timer-settings .group-actions {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
}
.timer-settings .divider {
  height: 0.0625rem;
  background: #f5f3ff;
  margin: 0;
}
.timer-settings .empty {
  padding: 1.75rem 1rem; text-align: center;
  color: #8b7aab; font-size: 0.875rem;
  background: #fff;
  border: 0.0625rem dashed #ebe6f2;
  border-radius: 0.875rem;
}
.timer-settings .list {
  display: flex; flex-direction: column; gap: 0.75rem;
}

/* one reminder = one card */
.timer-settings .rule {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 1rem 1.25rem;
  background: #fff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease, background-color 0.15s ease;
}
.timer-settings .rule:hover {
  border-color: #ddd6fe;
  box-shadow: 0 0.25rem 0.75rem rgba(124,58,237,0.08);
}
.timer-settings .rule-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
}
.timer-settings .rule-title-row {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  min-width: 0; flex: 1;
}
.timer-settings .rule-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #2e1065;
  line-height: 1.35;
}
.timer-settings .rule-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}
.timer-settings .rule-desc {
  margin: 0;
  font-size: 0.75rem;
  color: #8b7aab;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.timer-settings .rule-acts {
  display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;
}
.timer-settings .rule-acts .n-button {
  --n-border: 1px solid #ddd6fe;
  --n-border-hover: 1px solid #a78bfa;
  --n-border-pressed: 1px solid #7c3aed;
  --n-border-focus: 1px solid #a78bfa;
  --n-text-color: #7c3aed;
  --n-text-color-hover: #6d28d9;
  --n-text-color-pressed: #5b21b6;
  --n-text-color-focus: #6d28d9;
  --n-color: #fff;
  --n-color-hover: #faf8ff;
  --n-color-pressed: #f5f3ff;
  --n-color-focus: #fff;
  --n-ripple-color: #ddd6fe;
}
.timer-settings .rule-acts .n-button.n-button--error-type {
  --n-border: 1px solid #fecaca;
  --n-border-hover: 1px solid #f87171;
  --n-border-pressed: 1px solid #ef4444;
  --n-border-focus: 1px solid #f87171;
  --n-text-color: #dc2626;
  --n-text-color-hover: #b91c1c;
  --n-text-color-pressed: #991b1b;
  --n-text-color-focus: #b91c1c;
  --n-color: #fff;
  --n-color-hover: #fef2f2;
  --n-color-pressed: #fee2e2;
  --n-color-focus: #fff;
  --n-ripple-color: #fecaca;
}
.timer-settings .header-actions .n-button:not(.n-button--primary-type),
.timer-settings .group-head .n-button:not(.n-button--primary-type),
.timer-settings .time-add .n-button:not(.n-button--primary-type),
.timer-settings .n-card__footer .n-button:not(.n-button--primary-type) {
  --n-border: 1px solid #ddd6fe;
  --n-border-hover: 1px solid #a78bfa;
  --n-border-pressed: 1px solid #7c3aed;
  --n-border-focus: 1px solid #a78bfa;
  --n-text-color: #7c3aed;
  --n-text-color-hover: #6d28d9;
  --n-text-color-pressed: #5b21b6;
  --n-text-color-focus: #6d28d9;
  --n-color: #fff;
  --n-color-hover: #faf8ff;
  --n-color-pressed: #f5f3ff;
  --n-color-focus: #fff;
  --n-ripple-color: #ddd6fe;
}
.timer-settings .rule.is-off {
  gap: 0;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
  background: #f8f7fc;
  border-color: #ebe6f2;
  border-style: dashed;
  box-shadow: none;
  filter: grayscale(0.25);
}
.timer-settings .rule.is-off:hover {
  border-color: #ddd6fe;
  box-shadow: none;
  filter: grayscale(0.1);
}
.timer-settings .rule.is-off .rule-title {
  color: #8b7aab;
}
.timer-settings .rule.is-off .rule-title-row {
  opacity: 0.92;
}

.timer-settings .modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.25rem 0 0.25rem;
  max-height: min(70vh, 36rem);
  overflow-y: auto;
}
.timer-settings .mf-section {
  background: #faf8ff;
  border: 0.0625rem solid #ebe6f2;
  border-radius: 0.875rem;
  padding: 0.875rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}
.timer-settings .mf-section-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: #7c3aed;
  letter-spacing: 0.02em;
}
.timer-settings .mf {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.timer-settings .mf-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2e1065;
  line-height: 1.3;
}
.timer-settings .mf-hint {
  font-size: 0.75rem;
  color: #8b7aab;
  line-height: 1.45;
  margin-top: -0.125rem;
}
.timer-settings .mf-control {
  width: 100%;
}
.timer-settings .mf-mode {
  width: 100%;
  display: grid !important;
  grid-template-columns: 1fr 1fr;
}
.timer-settings .mf-mode .n-radio-button {
  text-align: center;
}
.timer-settings .mf-num {
  display: flex;
  align-items: stretch;
  width: 100%;
  max-width: 14rem;
  height: 2.25rem;
  border: 0.0625rem solid #ddd6fe;
  border-radius: 0.625rem;
  background: #fff;
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.timer-settings .mf-num:focus-within {
  border-color: #a78bfa;
  box-shadow: 0 0 0 0.1875rem rgba(124, 58, 237, 0.14);
}
.timer-settings .mf-num.is-disabled {
  opacity: 0.45;
  pointer-events: none;
  background: #f8f7fc;
}
.timer-settings .mf-num-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 0 0.75rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #2e1065;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}
.timer-settings .mf-num-input::-webkit-outer-spin-button,
.timer-settings .mf-num-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.timer-settings .mf-num-input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}
.timer-settings .mf-num-unit {
  display: flex;
  align-items: center;
  padding: 0 0.875rem;
  background: #f5f3ff;
  border-left: 0.0625rem solid #ebe6f2;
  color: #7c3aed;
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
  user-select: none;
}
.timer-settings .mf-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.125rem 0;
}
.timer-settings .mf-switch-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.timer-settings .mf-times {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  width: 100%;
}
.timer-settings .mf-time-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  min-height: 1.75rem;
  align-items: center;
}
.timer-settings .mf-time-empty {
  font-size: 0.8125rem;
  color: #a89bc4;
}
.timer-settings .mf-time-add {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.timer-settings .mf-time-input {
  width: 8rem;
  max-width: 40%;
}
.timer-settings .is-dimmed {
  opacity: 0.42;
  pointer-events: none;
}
.timer-settings .modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.625rem;
}

.timer-settings .log-list {
  max-height: 8.5rem; overflow-y: auto;
  margin: 0.25rem 0 0;
}
.timer-settings .log-empty {
  padding: 0.75rem 0; font-size: 0.75rem; color: #8b7aab;
}
.timer-settings .log-item {
  display: flex; align-items: flex-start; gap: 0.5rem;
  padding: 0.375rem 0;
  font-size: 0.75rem; line-height: 1.5;
}
.timer-settings .log-item + .log-item {
  border-top: 0.0625rem solid #f5f3ff;
}
.timer-settings .log-time {
  flex-shrink: 0; font-variant-numeric: tabular-nums;
  color: #a78bfa; font-size: 0.6875rem; padding-top: 0.0625rem;
}
.timer-settings .log-text { color: #2e1065; word-break: break-word; min-width: 0; }
.timer-settings .log-item.ok .log-text { color: #047857; }
.timer-settings .log-item.err .log-text { color: #b91c1c; }
.timer-settings .log-item.warn .log-text { color: #b45309; }
`


function ensureStyles() {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = CSS
}

function newRuleId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function normalizeMode(mode) {
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
  const hh = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(min) || hh > 23 || min > 59) return null
  return `${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}`
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

function iconSvg(paths, attrs = {}) {
  return h(
    'svg',
    {
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      ...attrs,
    },
    paths.map((d) => h('path', { d })),
  )
}

const ICONS = {
  bell: () =>
    iconSvg([
      'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9',
      'M10.3 21a1.94 1.94 0 0 0 3.4 0',
    ]),
  plus: () => iconSvg(['M5 12h14', 'M12 5v14']),
  timer: () =>
    h(
      'svg',
      {
        width: '14',
        height: '14',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      [
        h('circle', { cx: '12', cy: '13', r: '8' }),
        h('path', { d: 'M12 9v4l2 2' }),
        h('path', { d: 'M5 3 2 6' }),
        h('path', { d: 'm22 6-3-3' }),
        h('path', { d: 'M12 5V2' }),
      ],
    ),
  clock: () =>
    h(
      'svg',
      {
        width: '14',
        height: '14',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      [h('circle', { cx: '12', cy: '12', r: '10' }), h('path', { d: 'M12 6v6l4 2' })],
    ),
  file: () =>
    h(
      'svg',
      {
        width: '16',
        height: '16',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      [
        h('path', { d: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z' }),
        h('polyline', { points: '14 2 14 8 20 8' }),
      ],
    ),
  sliders: () =>
    h(
      'svg',
      {
        width: '16',
        height: '16',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      [
        h('line', { x1: '4', x2: '4', y1: '21', y2: '14' }),
        h('line', { x1: '4', x2: '4', y1: '10', y2: '3' }),
        h('line', { x1: '12', x2: '12', y1: '21', y2: '12' }),
        h('line', { x1: '12', x2: '12', y1: '8', y2: '3' }),
        h('line', { x1: '20', x2: '20', y1: '21', y2: '16' }),
        h('line', { x1: '20', x2: '20', y1: '12', y2: '3' }),
        h('line', { x1: '2', x2: '6', y1: '14', y2: '14' }),
        h('line', { x1: '10', x2: '14', y1: '8', y2: '8' }),
        h('line', { x1: '18', x2: '22', y1: '16', y2: '16' }),
      ],
    ),
  pointer: () =>
    iconSvg(['m9 9 5 12 1.8-5.2L21 14Z', 'M7.2 2.2 8 5.1', 'm5.1 8-2.9-.8', 'M14 4.1 12 6', 'm6 12-1.9 2'], {
      width: '16',
      height: '16',
    }),
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

function sectionLabel(label) {
      return h('div', { class: 'section-label' }, label)
    }

    function renderModalBody() {
      const isInterval = form.value.mode === 'interval'
      const sticky = !!form.value.sticky

      const field = (label, hint, control) =>
        h('div', { class: 'mf' }, [
          h('div', { class: 'mf-label' }, label),
          hint ? h('div', { class: 'mf-hint' }, hint) : null,
          h('div', { class: 'mf-control' }, [control]),
        ])

      const numberField = (value, onUpdate, unit, opts = {}) =>
        h('div', { class: ['mf-num', opts.disabled ? 'is-disabled' : ''] }, [
          h('input', {
            class: 'mf-num-input',
            type: 'number',
            value: String(value),
            disabled: !!opts.disabled,
            min: opts.min,
            max: opts.max,
            onInput: (e) => onUpdate(e.target.value),
          }),
          h('span', { class: 'mf-num-unit' }, unit),
        ])

      return h('div', { class: 'modal-body' }, [
        h('section', { class: 'mf-section' }, [
          h('div', { class: 'mf-section-title' }, '基本内容'),
          field(
            '提醒标题',
            null,
            h(NInput, {
              value: form.value.title,
              placeholder: '例如：护眼提醒',
              maxlength: 40,
              showCount: true,
              'onUpdate:value': (v) => {
                form.value = { ...form.value, title: v }
              },
            }),
          ),
          field(
            '提醒正文',
            '出现在通知卡片上的说明文字',
            h(NInput, {
              value: form.value.body,
              type: 'textarea',
              rows: 3,
              placeholder: '远眺一下，放松眼睛。',
              maxlength: 200,
              showCount: true,
              'onUpdate:value': (v) => {
                form.value = { ...form.value, body: v }
              },
            }),
          ),
        ]),

        h('section', { class: 'mf-section' }, [
          h('div', { class: 'mf-section-title' }, '触发调度'),
          field(
            '触发模式',
            null,
            h(
              NRadioGroup,
              {
                value: form.value.mode,
                size: 'medium',
                class: 'mf-mode',
                'onUpdate:value': (v) => {
                  form.value = { ...form.value, mode: v }
                },
              },
              {
                default: () => [
                  h(NRadioButton, { value: 'interval' }, { default: () => '时间间隔' }),
                  h(NRadioButton, { value: 'daily' }, { default: () => '每日定点' }),
                ],
              },
            ),
          ),
          isInterval
            ? field(
                '时间间隔',
                `每隔多少分钟提醒一次（${MIN_INTERVAL}–${MAX_INTERVAL}）`,
                numberField(
                  form.value.interval_minutes,
                  (v) => {
                    form.value = {
                      ...form.value,
                      interval_minutes: clamp(v, MIN_INTERVAL, MAX_INTERVAL),
                    }
                  },
                  '分钟',
                  { min: MIN_INTERVAL, max: MAX_INTERVAL },
                ),
              )
            : field(
                '时间点',
                '每天固定时刻触发，格式 HH:MM',
                h('div', { class: 'mf-times' }, [
                  h(
                    'div',
                    { class: 'mf-time-chips' },
                    (form.value.daily_times || []).length
                      ? (form.value.daily_times || []).map((t) =>
                          h(
                            NTag,
                            {
                              key: t,
                              size: 'medium',
                              round: true,
                              closable: true,
                              type: 'primary',
                              bordered: false,
                              onClose: () => removeDailyTime(t),
                            },
                            { default: () => t },
                          ),
                        )
                      : h('span', { class: 'mf-time-empty' }, '还没有时间点'),
                  ),
                  h('div', { class: 'mf-time-add' }, [
                    h(NInput, {
                      value: draftTime.value,
                      placeholder: '18:00',
                      class: 'mf-time-input',
                      'onUpdate:value': (v) => {
                        draftTime.value = v
                      },
                      onKeydown: (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addDailyTime()
                        }
                      },
                    }),
                    h(
                      NButton,
                      { type: 'primary', secondary: true, onClick: addDailyTime },
                      { default: () => '添加' },
                    ),
                  ]),
                ]),
              ),
          isInterval
            ? h('div', { class: 'mf-switch-row' }, [
                h('div', { class: 'mf-switch-copy' }, [
                  h('div', { class: 'mf-label' }, '休息时重置'),
                  h('div', { class: 'mf-hint' }, '无电脑操作时，从休息结束后重新计时'),
                ]),
                h(NSwitch, {
                  value: !!form.value.reset_on_rest,
                  'onUpdate:value': (v) => {
                    form.value = { ...form.value, reset_on_rest: !!v }
                  },
                }),
              ])
            : null,
        ]),

        h('section', { class: 'mf-section' }, [
          h('div', { class: 'mf-section-title' }, '通知卡片行为'),
          h('div', { class: 'mf-switch-row' }, [
            h('div', { class: 'mf-switch-copy' }, [
              h('div', { class: 'mf-label' }, '卡片常驻'),
              h('div', { class: 'mf-hint' }, '开启后不会自动消失，需手动关闭'),
            ]),
            h(NSwitch, {
              value: sticky,
              'onUpdate:value': (v) => {
                form.value = { ...form.value, sticky: !!v }
              },
            }),
          ]),
          h(
            'div',
            { class: sticky ? 'is-dimmed' : '' },
            [
              field(
                '停留时长',
                `自动消失前停留的秒数（${MIN_CARD_SEC}–${MAX_CARD_SEC}）`,
                numberField(
                  form.value.card_duration_sec,
                  (v) => {
                    form.value = {
                      ...form.value,
                      card_duration_sec: clamp(v, MIN_CARD_SEC, MAX_CARD_SEC),
                    }
                  },
                  '秒',
                  { disabled: sticky, min: MIN_CARD_SEC, max: MAX_CARD_SEC },
                ),
              ),
            ],
          ),
        ]),
      ])
    }

    return () => {
      const isEdit = !!editingId.value
      const pluginOn = !!settings.value.enabled
      const rules = [...(settings.value.rules || [])].sort((a, b) => {
        const ae = a.enabled !== false ? 1 : 0
        const be = b.enabled !== false ? 1 : 0
        return be - ae
      })

      const header = h('div', { class: 'header-row' }, [
        h('h3', { class: 'header-title' }, [
          '提醒列表',
          h(
            NTag,
            { size: 'tiny', round: true, bordered: false, type: 'primary' },
            { default: () => String(rules.length) },
          ),
        ]),
        h('div', { class: 'header-actions' }, [
          h(
            NButton,
            {
              size: 'small',
              type: 'primary',
              disabled: !pluginOn || rules.length >= MAX_RULES,
              onClick: openCreate,
            },
            {
              icon: () => ICONS.plus(),
              default: () => '新建提醒',
            },
          ),
        ]),
      ])

      const listChildren = []
      if (loading.value) {
        listChildren.push(h('div', { class: 'empty' }, '加载中…'))
      } else if (!rules.length) {
        listChildren.push(h('div', { class: 'empty' }, '还没有提醒，点击右上角「新建提醒」开始'))
      } else {
        rules.forEach((rule) => {
          const meta = ruleMetaParts(rule)
          const tags = [
            h(
              NTag,
              {
                size: 'small',
                round: true,
                bordered: false,
                type: meta.schedule.kind === 'daily' ? 'warning' : 'info',
              },
              {
                default: () =>
                  h('span', { style: 'display:inline-flex;align-items:center;gap:0.25rem' }, [
                    meta.schedule.kind === 'daily' ? ICONS.clock() : ICONS.timer(),
                    meta.schedule.label,
                  ]),
              },
            ),
            h(
              NTag,
              { size: 'small', round: true, bordered: false },
              { default: () => meta.stay },
            ),
          ]
          if (meta.restReset) {
            tags.push(
              h(
                NTag,
                { size: 'small', round: true, bordered: false, type: 'success' },
                { default: () => '休息重置' },
              ),
            )
          }

          const actBtns = [
            h(
              NButton,
              {
                size: 'small',
                disabled: !!testingId.value,
                loading: testingId.value === rule.id,
                onClick: () => sendTest(rule),
              },
              { default: () => (testingId.value === rule.id ? '…' : '测试') },
            ),
            h(
              NButton,
              {
                size: 'small',
                onClick: () => openEdit(rule),
              },
              { default: () => '编辑' },
            ),
          ]
          if (!rule.builtin) {
            actBtns.push(
              h(
                NPopconfirm,
                {
                  positiveText: '删除',
                  negativeText: '取消',
                  onPositiveClick: () => removeRule(rule.id),
                },
                {
                  trigger: () =>
                    h(
                      NButton,
                      {
                        size: 'small',
                        type: 'error',
                      },
                      { default: () => '删除' },
                    ),
                  default: () => `确认删除「${rule.title || '定时提醒'}」？此操作不可撤销。`,
                },
              ),
            )
          }

          const headerLeft = [
            h('div', { class: 'rule-title' }, rule.title || '定时提醒'),
            ...tags,
          ]

          const contentChildren = []
          if (rule.enabled && rule.body) {
            contentChildren.push(h('p', { class: 'rule-desc' }, rule.body))
          }

          listChildren.push(
            h('div', { key: rule.id, class: ['rule', rule.enabled ? '' : 'is-off'] }, [
              h('div', { class: 'rule-header' }, [
                h('div', { class: 'rule-title-row' }, headerLeft),
                h('div', { class: 'rule-acts' }, [
                  ...actBtns,
                  h(NSwitch, {
                    value: !!rule.enabled,
                    size: 'medium',
                    'onUpdate:value': (v) => toggleRule(rule.id, !!v),
                  }),
                ]),
              ]),
              contentChildren.length
                ? h('div', { class: 'rule-content' }, contentChildren)
                : null,
            ]),
          )
        })
      }

      const list = h('div', { class: 'list' }, listChildren)

      const logBody = logs.value.length
        ? logs.value
            .map((item, index) => [
              index > 0 ? h('div', { class: 'divider' }) : null,
              h('div', { key: item.id, class: ['log-item', item.type] }, [
                h('span', { class: 'log-time' }, item.time),
                h('span', { class: 'log-text' }, item.text),
              ]),
            ])
            .flat()
        : [h('div', { class: 'log-empty' }, '暂无日志')]

      const logCard = h('div', { class: 'group' }, [
        h('div', { class: 'group-head' }, [
          h('div', { class: 'group-label' }, '运行日志'),
          logs.value.length
            ? h(
                NButton,
                { size: 'small', onClick: clearLogs },
                { default: () => '清空' },
              )
            : null,
        ]),
        h('div', { class: 'log-list' }, logBody),
      ])

      const modal = h(
        NModal,
        {
          show: modalOpen.value,
          preset: 'card',
          class: 'timer-modal',
          style: { width: 'min(28rem, calc(100vw - 2rem))' },
          title: isEdit ? '编辑提醒' : '新建提醒',
          bordered: false,
          segmented: { content: 'soft', footer: 'soft' },
          maskClosable: true,
          closeOnEsc: true,
          'onUpdate:show': (v) => {
            if (!v) closeModal()
            else modalOpen.value = true
          },
        },
        {
          default: () => renderModalBody(),
          footer: () =>
            h('div', { class: 'modal-footer' }, [
              h(
                NButton,
                { onClick: closeModal },
                { default: () => '取消' },
              ),
              h(
                NButton,
                {
                  type: 'primary',
                  loading: saving.value,
                  onClick: saveModal,
                },
                { default: () => (isEdit ? '保存更改' : '保存') },
              ),
            ]),
        },
      )

      return h('div', { class: 'timer-settings' }, [header, list, logCard, modal])
    }
  },
}
