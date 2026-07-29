/** Timer plugin background — port of timer_plugin.rs minute-tick semantics. */
const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)

const MAX_RULES = 20
const MAX_DAILY_TIMES = 8
const MAX_DAILY_KEYS = 64
const MIN_INTERVAL = 1
const MAX_INTERVAL = 24 * 60
const MIN_CARD_SEC = 3
const MAX_CARD_SEC = 600
const DEFAULT_CARD_SEC = 8
const RUNTIME_KEY = 'runtime'

/** @type {Map<string, number>} ruleId -> snooze-until epoch ms */
const snoozeUntil = new Map()
/** @type {Map<string, number>} ruleId -> last-sent epoch ms (1s debounce) */
const lastSent = new Map()

function nowTs() {
  return Math.floor(Date.now() / 1000)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function localDateParts(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    hhmm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    ts: Math.floor(d.getTime() / 1000),
  }
}

function normalizeHhmm(s) {
  const m = String(s || '')
    .trim()
    .match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return `${pad2(h)}:${pad2(min)}`
}

function normalizeDailyTimes(times) {
  const out = []
  for (const t of times || []) {
    const norm = normalizeHhmm(t)
    if (norm && !out.includes(norm)) out.push(norm)
    if (out.length >= MAX_DAILY_TIMES) break
  }
  out.sort()
  return out
}

function normalizeMode(mode) {
  if (mode === 'daily') return 'daily'
  return 'interval'
}

function wantsResetOnRest(r) {
  return !!(r && r.reset_on_rest)
}

const BUILTIN_EYE_ID = '__builtin_eye__'

function builtinEyeRule() {
  return {
    id: BUILTIN_EYE_ID,
    enabled: true,
    title: '护眼提醒',
    body: '远眺一下，放松眼睛。',
    mode: 'interval',
    interval_minutes: 20,
    reset_on_rest: true,
    sticky: false,
    card_duration_sec: 25,
    daily_times: [],
    last_fired_at: null,
    last_daily_keys: [],
    builtin: 'eye',
  }
}

function ensureBuiltinEyeRule(settings) {
  if (!Array.isArray(settings.rules)) settings.rules = []
  if (settings.rules.some((r) => r.builtin === 'eye' || r.id === BUILTIN_EYE_ID)) {
    const eye = settings.rules.find((r) => r.id === BUILTIN_EYE_ID)
    if (eye && !eye.builtin) eye.builtin = 'eye'
    return
  }
  settings.rules.unshift(builtinEyeRule())
}

function sanitizeSettings(raw) {
  const s = {
    enabled: raw && raw.enabled !== false,
    rules: Array.isArray(raw && raw.rules) ? raw.rules.slice(0, MAX_RULES) : [],
  }
  s.rules = s.rules.map((r) => {
    const id = (r && r.id && String(r.id).trim()) || cryptoRandomId()
    let keys = Array.isArray(r.last_daily_keys) ? [...r.last_daily_keys] : []
    if (keys.length > MAX_DAILY_KEYS) keys = keys.slice(keys.length - MAX_DAILY_KEYS)
    return {
      id,
      enabled: r.enabled !== false,
      title: (r && r.title) || '',
      body: (r && r.body) || '',
      mode: normalizeMode(r && r.mode),
      interval_minutes: clamp(
        Number(r && r.interval_minutes) || 60,
        MIN_INTERVAL,
        MAX_INTERVAL,
      ),
      reset_on_rest: wantsResetOnRest(r),
      sticky: !!(r && r.sticky),
      card_duration_sec: clamp(
        Number(r && r.card_duration_sec) || DEFAULT_CARD_SEC,
        MIN_CARD_SEC,
        MAX_CARD_SEC,
      ),
      daily_times: normalizeDailyTimes((r && r.daily_times) || []),
      last_fired_at: r && r.last_fired_at != null ? Number(r.last_fired_at) : null,
      last_daily_keys: keys,
      builtin: (r && r.builtin) || null,
    }
  })
  ensureBuiltinEyeRule(s)
  return s
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function todayKey(date, hhmm) {
  return `${date}T${hhmm}`
}

function pruneDailyKeys(keys, keepPrefix) {
  const today = keys.filter((k) => k.startsWith(keepPrefix))
  let others = keys.filter((k) => !k.startsWith(keepPrefix))
  if (today.length >= MAX_DAILY_KEYS) {
    return today.slice(today.length - MAX_DAILY_KEYS)
  }
  const budget = MAX_DAILY_KEYS - today.length
  if (others.length > budget) others = others.slice(others.length - budget)
  return others.concat(today)
}

function defaultTitle(locale) {
  return locale === 'zh-CN' ? '定时提醒' : 'Timed Reminder'
}

function defaultBody(locale) {
  return locale === 'zh-CN' ? '该处理这件事了。' : "It's time for this reminder."
}

function actionLabel(locale, id) {
  const map = {
    'zh-CN': { ack: '知道了', snooze_5: '5 分钟后', skip: '跳过' },
    en: { ack: 'Got it', snooze_5: 'Snooze 5m', skip: 'Skip' },
  }
  const table = locale === 'zh-CN' ? map['zh-CN'] : map.en
  return table[id] || id
}

function ruleTitle(rule, locale) {
  const t = (rule.title || '').trim()
  return t || defaultTitle(locale)
}

function ruleBody(rule, locale) {
  const b = (rule.body || '').trim()
  return b || defaultBody(locale)
}

function isSnoozed(ruleId) {
  const until = snoozeUntil.get(ruleId)
  return until != null && until > Date.now()
}

function canSend(ruleId) {
  const last = lastSent.get(ruleId)
  return last == null || Date.now() - last >= 1000
}

function markSent(ruleId) {
  lastSent.set(ruleId, Date.now())
}

function clearSnooze(ruleId) {
  snoozeUntil.delete(ruleId)
}

function snooze(ruleId, minutes) {
  const m = clamp(Number(minutes) || 5, 1, MAX_INTERVAL)
  snoozeUntil.set(ruleId, Date.now() + m * 60_000)
}

async function loadConfig() {
  const raw = await invoke('plugin_config_get_all')
  return sanitizeSettings(raw || { enabled: true, rules: [] })
}

async function loadRuntime() {
  const raw = await invoke('plugin_storage_get', { key: RUNTIME_KEY })
  return raw && typeof raw === 'object' ? raw : {}
}

function applyRuntime(settings, runtime) {
  for (const rule of settings.rules) {
    const st = runtime[rule.id]
    if (!st) continue
    if (st.last_fired_at != null) rule.last_fired_at = Number(st.last_fired_at)
    if (Array.isArray(st.last_daily_keys)) rule.last_daily_keys = [...st.last_daily_keys]
  }
}

async function saveRuntime(settings) {
  const runtime = {}
  for (const rule of settings.rules) {
    runtime[rule.id] = {
      last_fired_at: rule.last_fired_at ?? null,
      last_daily_keys: rule.last_daily_keys || [],
    }
  }
  await invoke('plugin_storage_set', { key: RUNTIME_KEY, value: runtime })
}

async function getLocale() {
  // Prefer document lang; fall back to zh-CN.
  try {
    const lang = (document.documentElement.lang || '').trim()
    if (lang) return lang.startsWith('zh') ? 'zh-CN' : lang
  } catch {
    /* ignore */
  }
  return 'zh-CN'
}

async function publishDue(rule, locale) {
  const mode = rule.mode === 'daily' ? 'daily' : 'interval'
  const sticky = !!rule.sticky
  const cardSec = clamp(Number(rule.card_duration_sec) || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC)
  await invoke('plugin_publish_event', {
    event: {
      eventType: 'reminder.timer.due',
      kind: 'timer',
      title: ruleTitle(rule, locale),
      body: ruleBody(rule, locale),
      level: 'info',
      sticky,
      actions: [
        { id: 'ack', label: actionLabel(locale, 'ack') },
        { id: 'snooze_5', label: actionLabel(locale, 'snooze_5') },
        { id: 'skip', label: actionLabel(locale, 'skip') },
      ],
      payload: {
        rule_id: rule.id,
        mode,
        // Host ReminderToast reads these for per-card auto-hide.
        auto_hide_ms: sticky ? 0 : cardSec * 1000,
        card_duration_sec: cardSec,
      },
      dedupeKey: `reminder.timer.due:${rule.id}`,
    },
  })
}

async function onMinuteTick() {
  const settings = await loadConfig()
  if (!settings.enabled) return

  const runtime = await loadRuntime()
  applyRuntime(settings, runtime)

  let activity = { active: false }
  try {
    activity = await invoke('plugin_get_activity')
  } catch (e) {
    await invoke('plugin_log', {
      level: 'warn',
      message: 'plugin_get_activity failed',
      data: { error: String(e) },
    })
  }

  const { date, hhmm, ts } = localDateParts()
  const locale = await getLocale()
  let dirty = false

  for (const rule of settings.rules) {
    if (!rule.enabled) continue
    if (isSnoozed(rule.id) || !canSend(rule.id)) continue

    if (rule.mode === 'interval') {
      if (!activity.active) continue
      const interval = clamp(rule.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
      let overdue = false
      if (rule.last_fired_at == null) {
        // First anchor without fire — avoid burst on enable.
        rule.last_fired_at = ts
        dirty = true
      } else {
        let startTs = Number(rule.last_fired_at) || 0
        if (rule.reset_on_rest) {
          // If last real rest ended inside this round (after last fire), restart from rest end.
          let lastRest = null
          try {
            lastRest = await invoke('plugin_get_last_real_rest')
          } catch (e) {
            await invoke('plugin_log', {
              level: 'warn',
              message: 'plugin_get_last_real_rest failed',
              data: { ruleId: rule.id, error: String(e) },
            })
          }
          const restTs = lastRest != null ? Number(lastRest) : NaN
          if (Number.isFinite(restTs) && restTs > startTs) {
            startTs = restTs
            // Persist reset so next ticks don't re-query as "still in old round".
            rule.last_fired_at = restTs
            dirty = true
          }
        }
        overdue = ts - startTs >= interval * 60
      }
      if (overdue) {
        markSent(rule.id)
        rule.last_fired_at = ts
        dirty = true
        try {
          await publishDue(rule, locale)
        } catch (e) {
          await invoke('plugin_log', {
            level: 'error',
            message: 'publish due failed',
            data: { ruleId: rule.id, error: String(e) },
          })
        }
      }
    } else {
      const times = normalizeDailyTimes(rule.daily_times)
      if (!times.includes(hhmm)) continue
      const key = todayKey(date, hhmm)
      if ((rule.last_daily_keys || []).includes(key)) continue
      markSent(rule.id)
      rule.last_daily_keys = pruneDailyKeys([...(rule.last_daily_keys || []), key], date)
      dirty = true
      try {
        await publishDue(rule, locale)
      } catch (e) {
        await invoke('plugin_log', {
          level: 'error',
          message: 'publish due failed',
          data: { ruleId: rule.id, error: String(e) },
        })
      }
    }
  }

  if (dirty) {
    try {
      await saveRuntime(settings)
    } catch (e) {
      await invoke('plugin_log', {
        level: 'error',
        message: 'save runtime failed',
        data: { error: String(e) },
      })
    }
  }
}

async function handleResolved(detail) {
  if (!detail || detail.kind !== 'timer') return
  const actionId = detail.actionId || ''
  const payload = detail.payload || {}
  const ruleId = payload.rule_id || payload.ruleId
  if (!ruleId) return

  if (detail.resolutionKind === 'dismissed' && !actionId) {
    // Close without action — treat like skip for interval anchor stability.
    await applySkip(ruleId)
    return
  }

  if (detail.resolutionKind !== 'action' && !actionId) return

  if (actionId === 'ack') {
    await applyAck(ruleId)
  } else if (actionId === 'snooze_5') {
    clearSnooze(ruleId)
    snooze(ruleId, 5)
  } else if (actionId === 'skip') {
    await applySkip(ruleId)
  }
}

async function applyAck(ruleId) {
  clearSnooze(ruleId)
  const settings = await loadConfig()
  const runtime = await loadRuntime()
  applyRuntime(settings, runtime)
  const rule = settings.rules.find((r) => r.id === ruleId)
  if (!rule) return
  if (rule.mode === 'interval') {
    rule.last_fired_at = nowTs()
    await saveRuntime(settings)
  }
}

async function applySkip(ruleId) {
  clearSnooze(ruleId)
  const settings = await loadConfig()
  const runtime = await loadRuntime()
  applyRuntime(settings, runtime)
  const rule = settings.rules.find((r) => r.id === ruleId)
  if (!rule) return
  const { date, hhmm, ts } = localDateParts()
  if (rule.mode === 'interval') {
    rule.last_fired_at = ts
  } else {
    const key = todayKey(date, hhmm)
    if (!(rule.last_daily_keys || []).includes(key)) {
      rule.last_daily_keys = pruneDailyKeys([...(rule.last_daily_keys || []), key], date)
    }
  }
  await saveRuntime(settings)
}

function msUntilNextMinute() {
  const now = Date.now()
  return 60_000 - (now % 60_000) + 50
}

function scheduleMinuteLoop() {
  const run = () => {
    onMinuteTick().catch((e) => console.error('[timer] tick failed', e))
  }
  // Align to minute boundary, then every 60s.
  setTimeout(() => {
    run()
    setInterval(run, 60_000)
  }, msUntilNextMinute())
}

// Resolve bridge from PluginHost (CustomEvent).
window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  handleResolved(detail).catch((e) => console.error('[timer] resolve handler failed', e))
})

await invoke('plugin_log', { level: 'info', message: 'timer background loaded' })
scheduleMinuteLoop()
