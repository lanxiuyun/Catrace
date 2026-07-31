/** Timer plugin settings — host Vue + naive-ui; inline card editor.
 * Uses injected `plugin` facade (config / events / setEnabled).
 */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted } = vue
const {
  NButton,
  NInput,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  NTag,
  NTooltip,
} = naive

if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NSwitch || !NInput || !NPopconfirm || !NRadioGroup || !NTag || !NTooltip) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events || !plugin.setEnabled) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

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

.timer-settings .rule.is-editing {
  border-color: #c4b5fd;
  box-shadow: 0 0.25rem 1rem rgba(124, 58, 237, 0.1);
}
.timer-settings .rule.is-editing:hover {
  border-color: #a78bfa;
  box-shadow: 0 0.25rem 1rem rgba(124, 58, 237, 0.12);
}
.timer-settings .rule-editor {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.15rem;
  padding-top: 0.65rem;
  border-top: 0.0625rem solid #f5f3ff;
}
.timer-settings .ed-line {
  display: grid;
  grid-template-columns: 4.75rem minmax(0, 1fr);
  gap: 0.75rem 0.875rem;
  align-items: center;
}
.timer-settings .ed-line.is-top {
  align-items: flex-start;
}
.timer-settings .ed-line.is-top .ed-lab {
  padding-top: 0.45rem;
}
.timer-settings .ed-lab {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #2e1065;
  line-height: 1.3;
  white-space: nowrap;
}
.timer-settings .ed-lab-tip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.timer-settings .ed-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 999px;
  border: 0.0625rem solid #ddd6fe;
  color: #a78bfa;
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  user-select: none;
}
.timer-settings .ed-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-start;
}
.timer-settings .ed-main.grow > .n-input {
  flex: 1;
  min-width: 0;
  width: 100%;
}
.timer-settings .ed-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
  font-size: 0.8125rem;
  color: #64748b;
}
.timer-settings .ed-num {
  width: 6.5rem;
}
.timer-settings .ed-unit {
  font-size: 0.75rem;
  font-weight: 600;
  color: #8b7aab;
}
.timer-settings .ed-times {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  min-width: 0;
}
.timer-settings .ed-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
  min-height: 1.5rem;
}
.timer-settings .ed-empty {
  font-size: 0.75rem;
  color: #a89bc4;
}
.timer-settings .ed-add {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.timer-settings .ed-hm {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.timer-settings .ed-hm-input {
  width: 3.75rem;
}
.timer-settings .ed-hm-sep {
  color: #8b7aab;
  font-weight: 700;
  padding: 0 0.1rem;
}
.timer-settings .ed-hm-unit {
  font-size: 0.75rem;
  color: #8b7aab;
  font-weight: 600;
  margin-right: 0.15rem;
}
.timer-settings .ed-switch-pair {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  color: #475569;
  font-weight: 500;
}
.timer-settings .ed-readonly {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2e1065;
  line-height: 2rem;
}
.timer-settings .ed-readonly-hint {
  font-size: 0.75rem;
  color: #a89bc4;
}
.timer-settings .ed-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.55rem;
  margin-top: 0.15rem;
  border-top: 0.0625rem solid #f5f3ff;
}
.timer-settings .create-card {
  border-style: solid;
  border-color: #c4b5fd;
  background: linear-gradient(180deg, #ffffff 0%, #faf8ff 100%);
  box-shadow: 0 0.25rem 1rem rgba(124, 58, 237, 0.08);
}
.timer-settings .create-card .rule-header {
  margin-bottom: 0;
}
.timer-settings .create-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: #2e1065;
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
  return !!(r && r.reset_on_rest)
}

const BUILTIN_EYE_ID = '__builtin_eye__'
const EYE_FIXED = {
  title: '护眼提醒',
  mode: 'interval',
  interval_minutes: 20,
  reset_on_rest: true,
  daily_times: [],
}

function isEyeRule(r) {
  return !!(r && (r.builtin === 'eye' || r.id === BUILTIN_EYE_ID))
}

function applyEyeFixed(rule) {
  if (!rule) return rule
  rule.id = BUILTIN_EYE_ID
  rule.builtin = 'eye'
  rule.title = EYE_FIXED.title
  rule.mode = EYE_FIXED.mode
  // interval_minutes is user-tunable for the eye sample
  rule.reset_on_rest = EYE_FIXED.reset_on_rest
  rule.daily_times = []
  if (rule.interval_minutes == null || !Number.isFinite(Number(rule.interval_minutes))) {
    rule.interval_minutes = EYE_FIXED.interval_minutes
  } else {
    rule.interval_minutes = clamp(rule.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
  }
  return rule
}

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
  return applyEyeFixed(
    createRule({
      enabled: true,
      body: '远眺一下，放松眼睛。',
      sticky: false,
      card_duration_sec: 25,
    }),
  )
}

function ensureBuiltinEyeRule(settings) {
  if (!Array.isArray(settings.rules)) settings.rules = []
  const eyes = settings.rules.filter((r) => isEyeRule(r))
  const others = settings.rules.filter((r) => !isEyeRule(r))
  let eye
  if (eyes.length) {
    eye = eyes[0]
    applyEyeFixed(eye)
    if (eye.body == null || eye.body === '') eye.body = '远眺一下，放松眼睛。'
    if (eye.card_duration_sec == null) eye.card_duration_sec = 25
    if (eye.sticky == null) eye.sticky = false
    if (eye.enabled == null) eye.enabled = true
  } else {
    eye = builtinEyeRule()
  }
  settings.rules = [eye, ...others]
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
    rules: (settings.rules || []).slice(0, MAX_RULES).map((r) => {
      const eye = isEyeRule(r)
      return {
        id: eye ? BUILTIN_EYE_ID : r.id || newRuleId(),
        enabled: r.enabled !== false,
        title: eye ? EYE_FIXED.title : r.title || '',
        body: r.body || '',
        mode: eye ? EYE_FIXED.mode : normalizeMode(r.mode),
        interval_minutes: clamp(
          eye ? (r.interval_minutes || EYE_FIXED.interval_minutes) : (r.interval_minutes || 60),
          MIN_INTERVAL,
          MAX_INTERVAL,
        ),
        reset_on_rest: eye ? EYE_FIXED.reset_on_rest : wantsResetOnRest(r),
        sticky: !!r.sticky,
        card_duration_sec: clamp(r.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC),
        daily_times: eye
          ? []
          : (r.daily_times || [])
              .map(normalizeHhmm)
              .filter(Boolean)
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort()
              .slice(0, MAX_DAILY_TIMES),
        builtin: eye ? 'eye' : r.builtin || null,
        last_fired_at: null,
        last_daily_keys: [],
      }
    }),
  }
}


function earliestDailyMinutes(rule) {
  const times = Array.isArray(rule.daily_times) ? rule.daily_times : []
  let min = Number.POSITIVE_INFINITY
  for (const t of times) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{1,2})$/)
    if (!m) continue
    const mins = Number(m[1]) * 60 + Number(m[2])
    if (Number.isFinite(mins) && mins < min) min = mins
  }
  return min
}

function compareRules(a, b) {
  // 1) enabled first
  const ae = a.enabled !== false ? 1 : 0
  const be = b.enabled !== false ? 1 : 0
  if (ae !== be) return be - ae

  // 2) interval before daily
  const am = normalizeMode(a.mode) === 'daily' ? 1 : 0
  const bm = normalizeMode(b.mode) === 'daily' ? 1 : 0
  if (am !== bm) return am - bm

  // 3) interval: by minutes asc; daily: by earliest time asc
  if (am === 0) {
    const ai = clamp(a.interval_minutes || 0, MIN_INTERVAL, MAX_INTERVAL)
    const bi = clamp(b.interval_minutes || 0, MIN_INTERVAL, MAX_INTERVAL)
    if (ai !== bi) return ai - bi
  } else {
    const at = earliestDailyMinutes(a)
    const bt = earliestDailyMinutes(b)
    if (at !== bt) return at - bt
  }

  // stable-ish fallback: title
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh')
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
    const editingId = ref(null)
    const draftHour = ref(9)
    const draftMinute = ref(0)
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
        const raw = await plugin.config.get()
        const s = raw && typeof raw === 'object' ? raw : { enabled: true, rules: [] }
        const next = {
          enabled: s.enabled !== false,
          rules: Array.isArray(s.rules)
            ? s.rules.map((r) => {
                const rule = createRule({
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
                })
                if (isEyeRule(rule)) applyEyeFixed(rule)
                return rule
              })
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
        await plugin.config.set(portableSettings(next))
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
        await plugin.setEnabled(val)
        await plugin.config.set(portableSettings({ ...settings.value, enabled: val }))
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
      editingId.value = '__new__'
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
      draftHour.value = 9
      draftMinute.value = 0
    }

    function openEdit(rule) {
      editingId.value = rule.id
      const eye = isEyeRule(rule)
      form.value = {
        title: eye ? EYE_FIXED.title : rule.title || '',
        body: rule.body || '',
        mode: eye ? EYE_FIXED.mode : normalizeMode(rule.mode),
        interval_minutes: eye
          ? clamp(rule.interval_minutes || EYE_FIXED.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
          : rule.interval_minutes || 20,
        reset_on_rest: eye ? EYE_FIXED.reset_on_rest : wantsResetOnRest(rule),
        sticky: !!rule.sticky,
        card_duration_sec: rule.card_duration_sec || DEFAULT_CARD_SEC,
        daily_times: eye ? [] : [...(rule.daily_times || [])],
      }
      draftHour.value = 9
      draftMinute.value = 0
    }

    function closeEditor() {
      editingId.value = null
      draftHour.value = 9
      draftMinute.value = 0
    }

    function addDailyTime() {
      const hh = clamp(draftHour.value, 0, 23)
      const mm = clamp(draftMinute.value, 0, 59)
      draftHour.value = hh
      draftMinute.value = mm
      const norm = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
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
    }

    function removeDailyTime(time) {
      form.value = {
        ...form.value,
        daily_times: form.value.daily_times.filter((t) => t !== time),
      }
    }

    function saveEditor() {
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
      if (editingId.value && editingId.value !== '__new__') {
        const id = editingId.value
        const editingRule = settings.value.rules.find((r) => r.id === id)
        patch((s) => {
          const rule = s.rules.find((r) => r.id === id)
          if (!rule) return
          const eye = isEyeRule(editingRule) || isEyeRule(rule)
          rule.body = body
          rule.sticky = sticky
          rule.card_duration_sec = cardSec
          if (eye) {
            rule.interval_minutes = clamp(form.value.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
            applyEyeFixed(rule)
          } else {
            rule.title = title
            rule.mode = mode
            rule.interval_minutes = clamp(form.value.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
            rule.reset_on_rest = resetOnRest
            rule.daily_times = [...form.value.daily_times]
          }
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
      closeEditor()
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
        await plugin.events.publish({
          eventType: 'reminder.timer.due',
          kind: 'timer',
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
          dedupeKey: `reminder.timer.due:${r.id}`,
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

    function renderEditor() {
      const editingRule =
        editingId.value && editingId.value !== '__new__'
          ? settings.value.rules.find((r) => r.id === editingId.value)
          : null
      const eyeLocked = isEyeRule(editingRule)
      const isInterval = eyeLocked ? true : form.value.mode === 'interval'
      const sticky = !!form.value.sticky
      const isCreate = editingId.value === '__new__'

      const tip = (text) =>
        h(
          NTooltip,
          { trigger: 'hover', placement: 'top' },
          {
            trigger: () => h('span', { class: 'ed-tip' }, '?'),
            default: () => text,
          },
        )

      const lab = (text) => h('div', { class: 'ed-lab' }, text)

      const num = (value, onUpdate, unit, opts = {}) =>
        h(
          NInput,
          {
            value: String(value),
            size: 'small',
            class: 'ed-num',
            disabled: !!opts.disabled,
            'onUpdate:value': onUpdate,
          },
          { suffix: () => h('span', { class: 'ed-unit' }, unit) },
        )

      const triggerRight = isInterval
        ? h('div', { class: 'ed-main' }, [
            h(
              NRadioGroup,
              {
                value: form.value.mode,
                size: 'small',
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
            h('span', { class: 'ed-inline' }, [
              '每',
              num(
                form.value.interval_minutes,
                (v) => {
                  form.value = {
                    ...form.value,
                    interval_minutes: clamp(v, MIN_INTERVAL, MAX_INTERVAL),
                  }
                },
                '分钟',
              ),
            ]),
            h('span', { class: 'ed-switch-pair' }, [
              h(NSwitch, {
                value: !!form.value.reset_on_rest,
                size: 'small',
                'onUpdate:value': (v) => {
                  form.value = { ...form.value, reset_on_rest: !!v }
                },
              }),
              h('span', { class: 'ed-lab-tip' }, [
                '休息重置',
                tip('无电脑操作时，从休息结束后重新计时'),
              ]),
            ]),
          ])
        : h('div', { class: 'ed-main grow' }, [
            h(
              NRadioGroup,
              {
                value: form.value.mode,
                size: 'small',
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
            h('div', { class: 'ed-times' }, [
              h(
                'div',
                { class: 'ed-chips' },
                (form.value.daily_times || []).length
                  ? (form.value.daily_times || []).map((t) =>
                      h(
                        NTag,
                        {
                          key: t,
                          size: 'small',
                          closable: true,
                          round: true,
                          onClose: () => removeDailyTime(t),
                        },
                        { default: () => t },
                      ),
                    )
                  : h('span', { class: 'ed-empty' }, '尚未添加时间点'),
              ),
              h('div', { class: 'ed-add' }, [
                h('div', { class: 'ed-hm' }, [
                  h(NInput, {
                    value: String(draftHour.value),
                    size: 'small',
                    class: 'ed-hm-input',
                    placeholder: '9',
                    'onUpdate:value': (v) => {
                      draftHour.value = clamp(v, 0, 23)
                    },
                    onKeydown: (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addDailyTime()
                      }
                    },
                  }),
                  h('span', { class: 'ed-hm-unit' }, '时'),
                  h('span', { class: 'ed-hm-sep' }, ':'),
                  h(NInput, {
                    value: String(draftMinute.value),
                    size: 'small',
                    class: 'ed-hm-input',
                    placeholder: '0',
                    'onUpdate:value': (v) => {
                      draftMinute.value = clamp(v, 0, 59)
                    },
                    onKeydown: (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addDailyTime()
                      }
                    },
                  }),
                  h('span', { class: 'ed-hm-unit' }, '分'),
                ]),
                h(NButton, { size: 'small', onClick: addDailyTime }, { default: () => '添加' }),
              ]),
            ]),
          ])

      const notifyRight = h('div', { class: 'ed-main' }, [
        h('span', { class: 'ed-switch-pair' }, [
          h(NSwitch, {
            value: sticky,
            size: 'small',
            'onUpdate:value': (v) => {
              form.value = { ...form.value, sticky: !!v }
            },
          }),
          '卡片常驻',
        ]),
        sticky
          ? null
          : h('span', { class: 'ed-inline' }, [
              '停留',
              num(
                form.value.card_duration_sec,
                (v) => {
                  form.value = {
                    ...form.value,
                    card_duration_sec: clamp(v, MIN_CARD_SEC, MAX_CARD_SEC),
                  }
                },
                '秒',
              ),
            ]),
      ])

      return h('div', { class: 'rule-editor' }, [
        h('div', { class: 'ed-line' }, [
          lab('标题'),
          h('div', { class: 'ed-main grow' }, [
            eyeLocked
              ? h('div', { class: 'ed-readonly' }, EYE_FIXED.title)
              : h(NInput, {
                  value: form.value.title,
                  size: 'small',
                  placeholder: '例如：护眼提醒',
                  'onUpdate:value': (v) => {
                    form.value = { ...form.value, title: v }
                  },
                }),
          ]),
        ]),
        h('div', { class: 'ed-line is-top' }, [
          lab('正文'),
          h('div', { class: 'ed-main grow' }, [
            h(NInput, {
              value: form.value.body,
              type: 'textarea',
              size: 'small',
              rows: 2,
              placeholder: '远眺一下，放松眼睛。',
              'onUpdate:value': (v) => {
                form.value = { ...form.value, body: v }
              },
            }),
          ]),
        ]),
        h('div', { class: 'ed-line is-top' }, [
          lab('触发'),
          eyeLocked
            ? h('div', { class: 'ed-main' }, [
                h(
                  NTag,
                  { size: 'small', round: true, bordered: false, type: 'info' },
                  { default: () => '时间间隔' },
                ),
                h('span', { class: 'ed-inline' }, [
                  '每',
                  num(
                    form.value.interval_minutes,
                    (v) => {
                      form.value = {
                        ...form.value,
                        interval_minutes: clamp(v, MIN_INTERVAL, MAX_INTERVAL),
                      }
                    },
                    '分钟',
                  ),
                ]),
                h(
                  NTag,
                  { size: 'small', round: true, bordered: false, type: 'success' },
                  { default: () => '休息重置' },
                ),
              ])
            : triggerRight,
        ]),
        h('div', { class: 'ed-line' }, [lab('通知'), notifyRight]),
        h('div', { class: 'ed-foot' }, [
          h(NButton, { size: 'small', onClick: closeEditor }, { default: () => '取消' }),
          h(
            NButton,
            {
              size: 'small',
              type: 'primary',
              loading: saving.value,
              onClick: saveEditor,
            },
            { default: () => (isCreate ? '创建' : '保存') },
          ),
        ]),
      ])
    }

    return () => {
      const pluginOn = !!settings.value.enabled
      const isCreating = editingId.value === '__new__'
      const rules = [...(settings.value.rules || [])].sort(compareRules)

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
              disabled: !pluginOn || isCreating || rules.length >= MAX_RULES,
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
      if (isCreating) {
        listChildren.push(
          h('div', { key: '__new__', class: 'rule create-card is-editing' }, [
            h('div', { class: 'rule-header' }, [
              h('div', { class: 'create-title' }, '新建提醒'),
              h('div', { class: 'rule-acts' }, [
                h(NButton, { size: 'small', onClick: closeEditor }, { default: () => '取消' }),
              ]),
            ]),
            renderEditor(),
          ]),
        )
      }

      if (loading.value) {
        listChildren.push(h('div', { class: 'empty' }, '加载中…'))
      } else if (!rules.length && !isCreating) {
        listChildren.push(h('div', { class: 'empty' }, '还没有提醒，点击右上角「新建提醒」开始'))
      } else {
        rules.forEach((rule) => {
          const editing = editingId.value === rule.id
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

          const actBtns = []
          if (!editing) {
            actBtns.push(
              h(
                NButton,
                {
                  size: 'small',
                  disabled: !!testingId.value || isCreating,
                  loading: testingId.value === rule.id,
                  onClick: () => sendTest(rule),
                },
                { default: () => (testingId.value === rule.id ? '…' : '测试') },
              ),
              h(
                NButton,
                {
                  size: 'small',
                  disabled: isCreating,
                  onClick: () => openEdit(rule),
                },
                { default: () => '编辑' },
              ),
            )
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
                        { size: 'small', type: 'error', disabled: isCreating },
                        { default: () => '删除' },
                      ),
                    default: () => `确认删除「${rule.title || '定时提醒'}」？此操作不可撤销。`,
                  },
                ),
              )
            }
          } else {
            actBtns.push(
              h(NButton, { size: 'small', onClick: closeEditor }, { default: () => '收起' }),
            )
          }

          const contentChildren = []
          if (editing) {
            contentChildren.push(renderEditor())
          } else if (rule.enabled && rule.body) {
            contentChildren.push(h('p', { class: 'rule-desc' }, rule.body))
          }

          listChildren.push(
            h(
              'div',
              {
                key: rule.id,
                class: ['rule', rule.enabled ? '' : 'is-off', editing ? 'is-editing' : '']
                  .filter(Boolean)
                  .join(' '),
              },
              [
                h('div', { class: 'rule-header' }, [
                  h('div', { class: 'rule-title-row' }, [
                    h('div', { class: 'rule-title' }, rule.title || '定时提醒'),
                    ...(editing ? [] : tags),
                  ]),
                  h('div', { class: 'rule-acts' }, [
                    ...actBtns,
                    h(NSwitch, {
                      value: !!rule.enabled,
                      size: 'medium',
                      disabled: editing || isCreating,
                      'onUpdate:value': (v) => toggleRule(rule.id, !!v),
                    }),
                  ]),
                ]),
                contentChildren.length
                  ? h('div', { class: 'rule-content' }, contentChildren)
                  : null,
              ],
            ),
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

      return h('div', { class: 'timer-settings' }, [header, list, logCard])
    }

  },
}
