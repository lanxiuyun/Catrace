/** Bluetooth music plugin settings — clean grid cards. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted, computed } = vue
const { NButton, NInput, NSwitch, NSelect, NTag, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NButton || !NInput || !NSwitch || !NSelect || !NTag || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing')
}
if (!plugin || !plugin.config || !plugin.sidecar) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const STYLE_ID = 'catrace-plugin-bt-music-settings-css'
const CSS = `
.bt-settings { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#0f172a; }
.bt-settings * { box-sizing:border-box; }
.bt-settings .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(18rem,1fr)); gap:0.75rem; }
.bt-settings .card {
  min-width:0; padding:1.125rem 1.25rem 1.25rem; border:0.0625rem solid #e8eef7;
  border-radius:1rem; background:#fff;
  box-shadow:0 0.0625rem 0.125rem rgba(15,23,42,0.03);
  display:flex; flex-direction:column; gap:0.875rem;
}
.bt-settings .head {
  display:flex; align-items:center; justify-content:space-between; gap:0.75rem;
  padding-bottom:0.75rem; border-bottom:0.0625rem solid #f1f5f9;
}
.bt-settings .head-left { display:flex; align-items:center; gap:0.5rem; min-width:0; }
.bt-settings .icon {
  width:1.625rem; height:1.625rem; border-radius:0.5rem; flex:0 0 auto;
  display:flex; align-items:center; justify-content:center; font-size:0.8125rem;
}
.bt-settings .icon.blue { background:#eff6ff; color:#2563eb; }
.bt-settings .icon.green { background:#ecfdf5; color:#059669; }
.bt-settings .icon.violet { background:#f5f3ff; color:#7c3aed; }
.bt-settings h3 { margin:0; font-size:0.9375rem; font-weight:700; color:#0f172a; }
.bt-settings .cols {
  display:grid; grid-template-columns:repeat(auto-fit,minmax(11rem,1fr)); gap:0.75rem 1rem;
}
.bt-settings .field { display:flex; flex-direction:column; gap:0.375rem; min-width:0; }
.bt-settings .label { font-size:0.75rem; color:#64748b; font-weight:600; }
.bt-settings .hint { margin:0; color:#94a3b8; font-size:0.6875rem; line-height:1.4; }
.bt-settings .row { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row .n-input { flex:1; min-width:0; }
.bt-settings .row-inline { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row-inline .n-input { width:5.5rem; flex:0 0 auto; }
.bt-settings .unit { font-size:0.75rem; color:#64748b; }
.bt-settings .switch-row {
  display:flex; align-items:center; justify-content:space-between; gap:0.75rem; min-height:1.75rem;
}
.bt-settings .switch-label { font-size:0.8125rem; color:#334155; font-weight:500; }
.bt-settings .keywords { display:flex; flex-wrap:wrap; gap:0.375rem; align-items:center; min-height:0; }
.bt-settings .keyword-add { display:flex; gap:0.5rem; align-items:center; }
.bt-settings .keyword-add .n-input { flex:1; min-width:0; }
.bt-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
`

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function splitArgs(value) {
  return (
    value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) =>
      part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part,
    ) || []
  )
}

function clampAutoHideSec(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded <= 0) return 0
  return Math.min(600, Math.max(3, rounded))
}

function normalizeKeywords(list) {
  const out = []
  const seen = new Set()
  for (const item of list || []) {
    const s = String(item || '').trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 20) break
  }
  return out
}

const DELAY_OPTIONS = [
  { label: '立即启动', value: 0 },
  { label: '延迟 0.5 秒', value: 500 },
  { label: '延迟 1 秒', value: 1000 },
  { label: '延迟 1.5 秒（推荐）', value: 1500 },
  { label: '延迟 2 秒', value: 2000 },
  { label: '延迟 3 秒', value: 3000 },
]

const DEFAULT_CONFIG = {
  listenEnabled: true,
  nameKeywords: [],
  playerPath: '',
  playerArgs: '',
  notifyDisconnect: true,
  autoLaunchOnConnect: false,
  pauseOnDisconnect: false,
  launchDelayMs: 1500,
  connectedAutoHideSec: 5,
  disconnectedAutoHideSec: 3,
}

export default {
  name: 'BtMusicSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const busy = ref('')
    const listenEnabled = ref(DEFAULT_CONFIG.listenEnabled)
    const nameKeywords = ref([...DEFAULT_CONFIG.nameKeywords])
    const keywordDraft = ref('')
    const pairedOptions = ref([])
    const pairedPick = ref(null)
    const playerPath = ref(DEFAULT_CONFIG.playerPath)
    const playerArgs = ref(DEFAULT_CONFIG.playerArgs)
    const notifyDisconnect = ref(DEFAULT_CONFIG.notifyDisconnect)
    const autoLaunchOnConnect = ref(DEFAULT_CONFIG.autoLaunchOnConnect)
    const pauseOnDisconnect = ref(DEFAULT_CONFIG.pauseOnDisconnect)
    const launchDelayMs = ref(DEFAULT_CONFIG.launchDelayMs)
    const connectedAutoHideSec = ref(DEFAULT_CONFIG.connectedAutoHideSec)
    const disconnectedAutoHideSec = ref(DEFAULT_CONFIG.disconnectedAutoHideSec)
    let saveTimer = null

    const pairedSelectOptions = computed(() =>
      (pairedOptions.value || []).map((d) => ({
        label: d.name,
        value: d.name,
      })),
    )

    function currentConfig() {
      return {
        listenEnabled: !!listenEnabled.value,
        nameKeywords: normalizeKeywords(nameKeywords.value),
        playerPath: playerPath.value || '',
        playerArgs: splitArgs(playerArgs.value || ''),
        notifyDisconnect: !!notifyDisconnect.value,
        autoLaunchOnConnect: !!autoLaunchOnConnect.value,
        pauseOnDisconnect: !!pauseOnDisconnect.value,
        launchDelayMs: Number(launchDelayMs.value) || 0,
        connectedAutoHideSec: clampAutoHideSec(
          connectedAutoHideSec.value,
          DEFAULT_CONFIG.connectedAutoHideSec,
        ),
        disconnectedAutoHideSec: clampAutoHideSec(
          disconnectedAutoHideSec.value,
          DEFAULT_CONFIG.disconnectedAutoHideSec,
        ),
      }
    }

    function applyConfig(cfg = {}) {
      if (typeof cfg.listenEnabled === 'boolean') listenEnabled.value = cfg.listenEnabled
      if (Array.isArray(cfg.nameKeywords)) {
        nameKeywords.value = normalizeKeywords(cfg.nameKeywords)
      } else if (typeof cfg.nameFilter === 'string' && cfg.nameFilter.trim()) {
        nameKeywords.value = normalizeKeywords([cfg.nameFilter])
      }
      if (typeof cfg.playerPath === 'string') playerPath.value = cfg.playerPath
      if (Array.isArray(cfg.playerArgs)) playerArgs.value = cfg.playerArgs.join(' ')
      else if (typeof cfg.playerArgs === 'string') playerArgs.value = cfg.playerArgs
      if (typeof cfg.notifyDisconnect === 'boolean') notifyDisconnect.value = cfg.notifyDisconnect
      if (typeof cfg.autoLaunchOnConnect === 'boolean') {
        autoLaunchOnConnect.value = cfg.autoLaunchOnConnect
      }
      if (typeof cfg.pauseOnDisconnect === 'boolean') {
        pauseOnDisconnect.value = cfg.pauseOnDisconnect
      }
      if (typeof cfg.launchDelayMs === 'number') launchDelayMs.value = cfg.launchDelayMs
      if (typeof cfg.connectedAutoHideSec === 'number') {
        connectedAutoHideSec.value = clampAutoHideSec(
          cfg.connectedAutoHideSec,
          DEFAULT_CONFIG.connectedAutoHideSec,
        )
      }
      if (typeof cfg.disconnectedAutoHideSec === 'number') {
        disconnectedAutoHideSec.value = clampAutoHideSec(
          cfg.disconnectedAutoHideSec,
          DEFAULT_CONFIG.disconnectedAutoHideSec,
        )
      }
    }

    async function run(key, task) {
      busy.value = key
      try {
        await task()
      } catch (error) {
        message.error(errorText(error))
      } finally {
        busy.value = ''
      }
    }

    async function persistAndSync({ quiet = false } = {}) {
      const cfg = currentConfig()
      nameKeywords.value = cfg.nameKeywords
      connectedAutoHideSec.value = cfg.connectedAutoHideSec
      disconnectedAutoHideSec.value = cfg.disconnectedAutoHideSec
      launchDelayMs.value = cfg.launchDelayMs

      await plugin.config.set(cfg)
      try {
        await plugin.sidecar.request('setConfig', cfg)
        if (!quiet) message.success('已保存')
        await plugin.log.info('bt-music config auto-saved', { cfg })
      } catch (error) {
        if (!quiet) message.warning('已保存（启用插件后生效）')
        await plugin.log.warn('bt-music config saved without runtime', { error: errorText(error) })
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        persistAndSync({ quiet: true }).catch((error) => {
          message.error(errorText(error))
        })
      }, 400)
    }

    function addKeyword(raw) {
      const text = String(raw || keywordDraft.value || '').trim()
      if (!text) return
      nameKeywords.value = normalizeKeywords([...nameKeywords.value, text])
      keywordDraft.value = ''
      pairedPick.value = null
      scheduleSave()
    }

    function removeKeyword(word) {
      nameKeywords.value = nameKeywords.value.filter((k) => k !== word)
      scheduleSave()
    }

    function onPairedPick(value) {
      pairedPick.value = value
      if (value) addKeyword(value)
    }

    async function loadPaired() {
      try {
        const result = await plugin.sidecar.request('listPairedDevices')
        pairedOptions.value = Array.isArray(result?.devices) ? result.devices : []
      } catch {
        pairedOptions.value = []
      }
    }

    async function pickPlayer() {
      await run('pick', async () => {
        const path = await plugin.dialog.pickFile()
        if (path) {
          playerPath.value = path
          scheduleSave()
        }
      })
    }

    async function testOpenPlayer() {
      await run('open', async () => {
        await persistAndSync({ quiet: true })
        const result = await plugin.sidecar.request('openPlayer', { delayed: false })
        // Host may return the RPC body directly, or wrap it.
        const body = result && typeof result === 'object' && 'result' in result ? result.result : result
        const ok = body?.ok === true || (body && body.pid && body.path)
        if (ok) {
          const name = String(body.path || playerPath.value || '').split(/[/\\]/).pop() || '程序'
          message.success(`已启动 ${name}${body.pid ? ` (PID ${body.pid})` : ''}`)
        } else {
          message.error(body?.error || result?.error || '启动失败')
        }
      })
    }

    async function testNotification() {
      await run('toast', async () => {
        await persistAndSync({ quiet: true })
        const sampleName =
          (nameKeywords.value && nameKeywords.value[0]) ||
          (pairedOptions.value && pairedOptions.value[0]?.name) ||
          '测试耳机'
        const hideSec = clampAutoHideSec(
          connectedAutoHideSec.value,
          DEFAULT_CONFIG.connectedAutoHideSec,
        )
        const sticky = hideSec <= 0
        const payload = {
          deviceId: 'bt-music:test',
          deviceName: sampleName,
          source: 'settings-test',
          reason: 'manual-test',
          publishedAt: new Date().toISOString(),
        }
        if (!sticky) payload.auto_hide_ms = hideSec * 1000

        await plugin.events.publish({
          eventType: 'bt-music.connected',
          kind: 'bt-music',
          title: '耳机已连接',
          body: sampleName,
          level: 'success',
          sticky,
          actions: sticky
            ? [
                { id: 'open-player', label: '打开听歌' },
                { id: 'dismiss', label: '知道了' },
              ]
            : [
                { id: 'open-player', label: '打开听歌' },
                { id: 'dismiss', label: '关闭' },
              ],
          payload,
          dedupeKey: `bt-music:connected:test:${Date.now()}`,
        })
        message.success('已发送测试通知')
      })
    }

    onMounted(() => {
      run('boot', async () => {
        const saved = await plugin.config.get()
        if (saved && typeof saved === 'object') applyConfig(saved)
        await persistAndSync({ quiet: true })
        await loadPaired()
      })
    })

    const button = (label, key, onClick, props = {}) =>
      h(
        NButton,
        {
          size: 'small',
          type: 'primary',
          secondary: true,
          loading: busy.value === key,
          disabled: !!busy.value && busy.value !== key,
          onClick,
          ...props,
        },
        { default: () => label },
      )

    const card = (iconClass, icon, title, headExtra, children) =>
      h('section', { class: 'card' }, [
        h('div', { class: 'head' }, [
          h('div', { class: 'head-left' }, [
            h('span', { class: `icon ${iconClass}` }, icon),
            h('h3', title),
          ]),
          headExtra || null,
        ]),
        ...children,
      ])

    return () =>
      h('div', { class: 'bt-settings' }, [
        h('div', { class: 'grid' }, [
          card(
            'blue',
            '🎧',
            '触发设备与监听',
            h(NSwitch, {
              value: listenEnabled.value,
              'onUpdate:value': (v) => {
                listenEnabled.value = v
                scheduleSave()
              },
            }),
            [
              h('div', { class: 'cols' }, [
                h('div', { class: 'field' }, [
                  h('span', { class: 'label' }, '匹配设备名称关键词'),
                  h('div', { class: 'keywords' }, [
                    ...(nameKeywords.value || []).map((word) =>
                      h(
                        NTag,
                        {
                          size: 'small',
                          closable: true,
                          onClose: () => removeKeyword(word),
                        },
                        { default: () => word },
                      ),
                    ),
                  ]),
                  h('div', { class: 'keyword-add' }, [
                    h(NInput, {
                      value: keywordDraft.value,
                      'onUpdate:value': (v) => {
                        keywordDraft.value = v
                      },
                      placeholder: '例如 XM5 或 AirPods',
                      clearable: true,
                      onKeydown: (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addKeyword()
                        }
                      },
                    }),
                    button('添加', 'add-kw', () => addKeyword()),
                  ]),
                ]),
                h('div', { class: 'field' }, [
                  h('span', { class: 'label' }, '已配对设备快速选择'),
                  h(NSelect, {
                    value: pairedPick.value,
                    options: pairedSelectOptions.value,
                    placeholder: pairedSelectOptions.value.length ? '点选加入关键词' : '暂无设备',
                    clearable: true,
                    filterable: true,
                    'onUpdate:value': onPairedPick,
                  }),
                ]),
              ]),
              h('div', { class: 'switch-row' }, [
                h('span', { class: 'switch-label' }, '耳机断开连接时也显示提醒'),
                h(NSwitch, {
                  value: notifyDisconnect.value,
                  'onUpdate:value': (v) => {
                    notifyDisconnect.value = v
                    scheduleSave()
                  },
                }),
              ]),
            ],
          ),

          card('green', '♪', '绑定听歌程序与自动化', null, [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '音乐软件路径'),
              h('div', { class: 'row' }, [
                h(NInput, {
                  value: playerPath.value,
                  'onUpdate:value': (v) => {
                    playerPath.value = v
                    scheduleSave()
                  },
                  placeholder: '选择音乐软件可执行文件',
                }),
                button('浏览', 'pick', pickPlayer),
              ]),
            ]),
            h('div', { class: 'cols' }, [
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '启动参数（可选）'),
                h(NInput, {
                  value: playerArgs.value,
                  'onUpdate:value': (v) => {
                    playerArgs.value = v
                    scheduleSave()
                  },
                  placeholder: '例如 --autoplay',
                }),
              ]),
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '音频建立延迟缓冲'),
                h(NSelect, {
                  value: launchDelayMs.value,
                  options: DELAY_OPTIONS,
                  'onUpdate:value': (v) => {
                    launchDelayMs.value = Number(v) || 0
                    scheduleSave()
                  },
                }),
              ]),
            ]),
            h('div', { class: 'switch-row' }, [
              h('span', { class: 'switch-label' }, '自动静默启动软件'),
              h(NSwitch, {
                value: autoLaunchOnConnect.value,
                'onUpdate:value': (v) => {
                  autoLaunchOnConnect.value = v
                  scheduleSave()
                },
              }),
            ]),
            h('div', { class: 'switch-row' }, [
              h('span', { class: 'switch-label' }, '耳机断开连接时自动暂停媒体'),
              h(NSwitch, {
                value: pauseOnDisconnect.value,
                'onUpdate:value': (v) => {
                  pauseOnDisconnect.value = v
                  scheduleSave()
                },
              }),
            ]),
            h('div', { class: 'actions' }, [
              button('测试启动', 'open', testOpenPlayer),
              button('测试通知', 'toast', testNotification),
            ]),
          ]),

          card('violet', '⏱', '弹窗偏好', null, [
            h('div', { class: 'cols' }, [
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '连接弹窗驻留'),
                h('div', { class: 'row-inline' }, [
                  h(NInput, {
                    value: String(connectedAutoHideSec.value ?? 5),
                    'onUpdate:value': (v) => {
                      connectedAutoHideSec.value = clampAutoHideSec(
                        v,
                        DEFAULT_CONFIG.connectedAutoHideSec,
                      )
                      scheduleSave()
                    },
                    placeholder: '5',
                  }),
                  h('span', { class: 'unit' }, '秒'),
                ]),
                h('p', { class: 'hint' }, '0 表示不自动消失'),
              ]),
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '断开弹窗驻留'),
                h('div', { class: 'row-inline' }, [
                  h(NInput, {
                    value: String(disconnectedAutoHideSec.value ?? 3),
                    'onUpdate:value': (v) => {
                      disconnectedAutoHideSec.value = clampAutoHideSec(
                        v,
                        DEFAULT_CONFIG.disconnectedAutoHideSec,
                      )
                      scheduleSave()
                    },
                    placeholder: '3',
                  }),
                  h('span', { class: 'unit' }, '秒'),
                ]),
              ]),
            ]),
          ]),
        ]),
      ])
  },
}
