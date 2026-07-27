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

const STYLE_ID = 'catrace-plugin-timer-settings-css'
const CSS = `
/* Host Plugins.vue .plugin-detail owns max-width / padding — panel is business only. */
.timer-settings {
  width: 100%; box-sizing: border-box;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
  color: #0f172a;
}
.timer-settings .toolbar {
  display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
  margin-bottom: 1rem;
}
.timer-settings .btn {
  border: none; border-radius: 0.5rem; padding: 0.5rem 0.9rem;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
}
.timer-settings .btn:disabled { opacity: 0.55; cursor: default; }
.timer-settings .btn-primary { background: #7c3aed; color: #fff; }
.timer-settings .btn-primary:hover:not(:disabled) { background: #6d28d9; }
.timer-settings .btn-ghost {
  background: #fff; color: #4c1d95; border: 0.0625rem solid #e2e8f0;
}
.timer-settings .btn-ghost:hover:not(:disabled) { background: #f8fafc; }
.timer-settings .btn-danger { background: #fef2f2; color: #b91c1c; }
.timer-settings .presets {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 0.5rem; margin-bottom: 1.25rem;
}
.timer-settings .preset {
  text-align: left; padding: 0.75rem; border-radius: 0.75rem;
  border: 0.0625rem solid #e2e8f0; background: #fff; cursor: pointer;
}
.timer-settings .preset:hover { border-color: #c4b5fd; background: #f5f3ff; }
.timer-settings .preset .p-title { font-size: 0.875rem; font-weight: 600; color: #4c1d95; }
.timer-settings .preset .p-hint { margin-top: 0.25rem; font-size: 0.75rem; color: #64748b; }
.timer-settings .empty {
  padding: 2rem 1rem; text-align: center; border-radius: 0.875rem;
  border: 0.0625rem dashed #e2e8f0; background: #fff; color: #94a3b8; font-size: 0.875rem;
}
.timer-settings .list { display: flex; flex-direction: column; gap: 0.75rem; }
.timer-settings .rule {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 1rem; border-radius: 0.875rem; border: 0.0625rem solid #e2e8f0; background: #fff;
}
.timer-settings .rule.is-off { opacity: 0.6; }
.timer-settings .rule-main { flex: 1; min-width: 0; }
.timer-settings .rule-title {
  margin: 0; font-size: 0.9375rem; font-weight: 600; color: #0f172a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.timer-settings .rule-body {
  margin: 0.25rem 0 0; font-size: 0.8125rem; color: #64748b;
  white-space: pre-wrap; word-break: break-word;
}
.timer-settings .tag {
  display: inline-block; margin-top: 0.5rem; padding: 0.125rem 0.5rem;
  border-radius: 999px; background: #f5f3ff; color: #6d28d9;
  font-size: 0.75rem; font-weight: 600;
}
.timer-settings .rule-acts { display: flex; flex-direction: column; gap: 0.375rem; flex-shrink: 0; }
.timer-settings .switch {
  position: relative; width: 2.25rem; height: 1.25rem; border-radius: 999px;
  border: none; background: #cbd5e1; cursor: pointer; padding: 0;
}
.timer-settings .switch.on { background: #7c3aed; }
.timer-settings .switch .knob {
  position: absolute; top: 0.125rem; left: 0.125rem;
  width: 1rem; height: 1rem; border-radius: 999px; background: #fff;
  transition: transform 0.15s ease;
}
.timer-settings .switch.on .knob { transform: translateX(1rem); }
.timer-settings .modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35);
  display: flex; align-items: center; justify-content: center; z-index: 50;
  padding: 1rem;
}
.timer-settings .modal {
  width: min(28rem, 100%); background: #fff; border-radius: 0.875rem;
  border: 0.0625rem solid #e2e8f0; padding: 1.25rem; box-shadow: 0 1rem 2.5rem rgba(15,23,42,0.12);
}
.timer-settings .modal h3 { margin: 0 0 1rem; font-size: 1rem; color: #0f172a; }
.timer-settings .field { margin-bottom: 0.875rem; }
.timer-settings .field label {
  display: block; margin-bottom: 0.35rem; font-size: 0.75rem; font-weight: 600; color: #64748b;
}
.timer-settings .field input, .timer-settings .field textarea {
  width: 100%; box-sizing: border-box; border: 0.0625rem solid #e2e8f0;
  border-radius: 0.5rem; padding: 0.5rem 0.625rem; font-size: 0.875rem;
  font-family: inherit; color: #0f172a; background: #fff;
}
.timer-settings .field textarea { min-height: 4rem; resize: vertical; }
.timer-settings .mode-row { display: flex; gap: 0.5rem; }
.timer-settings .mode-row button {
  flex: 1; border: 0.0625rem solid #e2e8f0; background: #f8fafc; border-radius: 0.5rem;
  padding: 0.5rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer; color: #475569;
}
.timer-settings .mode-row button.active {
  border-color: #c4b5fd; background: #f5f3ff; color: #6d28d9;
}
.timer-settings .times { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.5rem; }
.timer-settings .chip {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.2rem 0.5rem; border-radius: 999px; background: #f1f5f9;
  font-size: 0.75rem; color: #334155;
}
.timer-settings .chip button {
  border: none; background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.875rem; line-height: 1;
}
.timer-settings .time-add { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.timer-settings .modal-acts {
  display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;
}
.timer-settings .toast-msg {
  margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; border-radius: 0.5rem;
  font-size: 0.8125rem;
}
.timer-settings .toast-msg.ok { background: #ecfdf5; color: #047857; }
.timer-settings .toast-msg.err { background: #fef2f2; color: #b91c1c; }
.timer-settings .toast-msg.warn { background: #fffbeb; color: #b45309; }
@media (max-width: 56.25rem) {
  .timer-settings { padding: 1.25rem; }
}
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

function createRule(partial = {}) {
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
      mode: r.mode === 'daily' ? 'daily' : 'interval',
      interval_minutes: clamp(r.interval_minutes || 60, MIN_INTERVAL, MAX_INTERVAL),
      daily_times: (r.daily_times || [])
        .map(normalizeHhmm)
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort()
        .slice(0, MAX_DAILY_TIMES),
      // runtime fields stripped from portable config
      last_fired_at: null,
      last_daily_keys: [],
    })),
  }
}

function scheduleTag(rule) {
  if (rule.mode === 'interval') return `每 ${rule.interval_minutes} 分钟`
  if (!rule.daily_times || !rule.daily_times.length) return '未设置时间点'
  if (rule.daily_times.length === 1) return `每天 ${rule.daily_times[0]}`
  return `每天 ${rule.daily_times.join(', ')}`
}

const PRESETS = [
  {
    key: 'drink',
    title: '喝水',
    hint: '每 20 分钟',
    rule: { title: '喝水', body: '起来喝一杯水吧。', mode: 'interval', interval_minutes: 20 },
  },
  {
    key: 'eye',
    title: '护眼',
    hint: '每 45 分钟',
    rule: { title: '护眼', body: '远眺一下，放松眼睛。', mode: 'interval', interval_minutes: 45 },
  },
  {
    key: 'stand',
    title: '站立活动',
    hint: '每 60 分钟',
    rule: { title: '站立活动', body: '站起来活动一下。', mode: 'interval', interval_minutes: 60 },
  },
  {
    key: 'offwork',
    title: '下班总结',
    hint: '每天 18:00',
    rule: {
      title: '下班总结',
      body: '记录今天的工作成果。',
      mode: 'daily',
      interval_minutes: 60,
      daily_times: ['18:00'],
    },
  },
]

export default {
  name: 'TimerSettings',
  setup(_props, { expose }) {
    ensureStyles()

    const settings = ref({ enabled: true, rules: [] })
    const loading = ref(true)
    const saving = ref(false)
    const headerLoading = ref(false)
    const testingId = ref(null)
    const toast = ref(null)
    const modalOpen = ref(false)
    const editingId = ref(null)
    const draftTime = ref('')
    const form = ref({
      title: '',
      body: '',
      mode: 'interval',
      interval_minutes: 20,
      daily_times: [],
    })

    let saveTimer = null

    function showToast(type, text) {
      toast.value = { type, text }
      setTimeout(() => {
        if (toast.value && toast.value.text === text) toast.value = null
      }, 2200)
    }

    async function load() {
      loading.value = true
      try {
        const raw = await invoke('get_plugin_config', { pluginId: PLUGIN_ID })
        const s = raw && typeof raw === 'object' ? raw : { enabled: true, rules: [] }
        settings.value = {
          enabled: s.enabled !== false,
          rules: Array.isArray(s.rules)
            ? s.rules.map((r) =>
                createRule({
                  id: r.id || newRuleId(),
                  enabled: r.enabled !== false,
                  title: r.title || '',
                  body: r.body || '',
                  mode: r.mode === 'daily' ? 'daily' : 'interval',
                  interval_minutes: Number(r.interval_minutes) || 60,
                  daily_times: Array.isArray(r.daily_times) ? [...r.daily_times] : [],
                  last_fired_at: r.last_fired_at ?? null,
                  last_daily_keys: Array.isArray(r.last_daily_keys) ? [...r.last_daily_keys] : [],
                }),
              )
            : [],
        }
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
        showToast('ok', '已保存')
      } catch (e) {
        console.warn('[timer settings] save failed', e)
        showToast('err', '保存失败')
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
        showToast('ok', '已保存')
      } catch (e) {
        settings.value = { ...settings.value, enabled: previous }
        showToast('err', '保存失败')
      } finally {
        headerLoading.value = false
      }
    }

    function openCreate() {
      if (settings.value.rules.length >= MAX_RULES) {
        showToast('warn', `最多 ${MAX_RULES} 条规则`)
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

    function openEdit(rule) {
      editingId.value = rule.id
      form.value = {
        title: rule.title || '',
        body: rule.body || '',
        mode: rule.mode === 'daily' ? 'daily' : 'interval',
        interval_minutes: rule.interval_minutes || 20,
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
      if (editingId.value) {
        const id = editingId.value
        patch((s) => {
          const rule = s.rules.find((r) => r.id === id)
          if (!rule) return
          rule.title = title
          rule.body = body
          rule.mode = form.value.mode
          rule.interval_minutes = clamp(form.value.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
          rule.daily_times = [...form.value.daily_times]
        })
      } else {
        if (settings.value.rules.length >= MAX_RULES) {
          showToast('warn', `最多 ${MAX_RULES} 条规则`)
          return
        }
        patch((s) => {
          s.rules.unshift(
            createRule({
              title,
              body: body || '该处理这件事了。',
              mode: form.value.mode,
              interval_minutes: clamp(form.value.interval_minutes, MIN_INTERVAL, MAX_INTERVAL),
              daily_times: [...form.value.daily_times],
              enabled: true,
            }),
          )
        })
      }
      closeModal()
    }

    function addPreset(key) {
      if (settings.value.rules.length >= MAX_RULES) {
        showToast('warn', `最多 ${MAX_RULES} 条规则`)
        return
      }
      const preset = PRESETS.find((p) => p.key === key)
      if (!preset) return
      patch((s) => {
        s.rules.unshift(createRule({ ...preset.rule, enabled: true }))
      })
      showToast('ok', `已添加「${preset.title}」`)
    }

    function toggleRule(id, enabled) {
      patch((s) => {
        const rule = s.rules.find((r) => r.id === id)
        if (rule) rule.enabled = enabled
      })
    }

    function removeRule(id) {
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
            sticky: false,
            actions: [
              { id: 'ack', label: '知道了' },
              { id: 'snooze_5', label: '5 分钟后' },
              { id: 'skip', label: '跳过' },
            ],
            payload: { rule_id: r.id, mode: r.mode === 'daily' ? 'daily' : 'interval' },
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
      const children = []

      if (toast.value) {
        children.push(
          h('div', { class: ['toast-msg', toast.value.type] }, toast.value.text),
        )
      }

      children.push(
        h('div', { class: 'toolbar' }, [
          h(
            'button',
            {
              type: 'button',
              class: ['btn', 'btn-primary'],
              disabled: !settings.value.enabled || settings.value.rules.length >= MAX_RULES,
              onClick: openCreate,
            },
            '新建规则',
          ),
          h(
            'button',
            {
              type: 'button',
              class: ['btn', 'btn-ghost'],
              disabled: !settings.value.enabled || !!testingId.value,
              onClick: () => sendTest(null),
            },
            testingId.value === '__global__' ? '发送中…' : '测试通知',
          ),
        ]),
      )

      children.push(
        h(
          'div',
          { class: 'presets' },
          PRESETS.map((p) =>
            h(
              'button',
              {
                key: p.key,
                type: 'button',
                class: 'preset',
                disabled: !settings.value.enabled || settings.value.rules.length >= MAX_RULES,
                onClick: () => addPreset(p.key),
              },
              [
                h('div', { class: 'p-title' }, p.title),
                h('div', { class: 'p-hint' }, p.hint),
              ],
            ),
          ),
        ),
      )

      if (loading.value) {
        children.push(h('div', { class: 'empty' }, '加载中…'))
      } else if (!settings.value.rules.length) {
        children.push(h('div', { class: 'empty' }, '还没有规则，点上方预设或「新建规则」开始'))
      } else {
        children.push(
          h(
            'div',
            { class: 'list' },
            settings.value.rules.map((rule) =>
              h('div', { key: rule.id, class: ['rule', rule.enabled ? '' : 'is-off'] }, [
                h('div', { class: 'rule-main' }, [
                  h('h4', { class: 'rule-title' }, rule.title || '定时提醒'),
                  rule.body
                    ? h('p', { class: 'rule-body' }, rule.body)
                    : null,
                  h('span', { class: 'tag' }, scheduleTag(rule)),
                ]),
                h('div', { class: 'rule-acts' }, [
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['switch', rule.enabled ? 'on' : ''],
                      'aria-label': '启用规则',
                      onClick: () => toggleRule(rule.id, !rule.enabled),
                    },
                    [h('span', { class: 'knob' })],
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['btn', 'btn-ghost'],
                      disabled: !!testingId.value,
                      onClick: () => sendTest(rule),
                    },
                    testingId.value === rule.id ? '…' : '测试',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['btn', 'btn-ghost'],
                      onClick: () => openEdit(rule),
                    },
                    '编辑',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['btn', 'btn-danger'],
                      onClick: () => removeRule(rule.id),
                    },
                    '删除',
                  ),
                ]),
              ]),
            ),
          ),
        )
      }

      if (modalOpen.value) {
        children.push(
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
                h('h3', null, editingId.value ? '编辑规则' : '新建规则'),
                h('div', { class: 'field' }, [
                  h('label', null, '标题'),
                  h('input', {
                    value: form.value.title,
                    placeholder: '定时提醒',
                    onInput: (e) => {
                      form.value = { ...form.value, title: e.target.value }
                    },
                  }),
                ]),
                h('div', { class: 'field' }, [
                  h('label', null, '正文'),
                  h('textarea', {
                    value: form.value.body,
                    placeholder: '该处理这件事了。',
                    onInput: (e) => {
                      form.value = { ...form.value, body: e.target.value }
                    },
                  }),
                ]),
                h('div', { class: 'field' }, [
                  h('label', null, '模式'),
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
                      '间隔',
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
                      h('label', null, `间隔（分钟，${MIN_INTERVAL}–${MAX_INTERVAL}）`),
                      h('input', {
                        type: 'number',
                        min: MIN_INTERVAL,
                        max: MAX_INTERVAL,
                        value: form.value.interval_minutes,
                        onInput: (e) => {
                          form.value = {
                            ...form.value,
                            interval_minutes: clamp(e.target.value, MIN_INTERVAL, MAX_INTERVAL),
                          }
                        },
                      }),
                    ])
                  : h('div', { class: 'field' }, [
                      h('label', null, '时间点（HH:MM）'),
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
                h('div', { class: 'modal-acts' }, [
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
                    '保存',
                  ),
                ]),
              ]),
            ],
          ),
        )
      }

      return h('div', { class: 'timer-settings' }, children)
    }
  },
}
