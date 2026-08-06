/** Bluetooth music plugin settings — connect/disconnect action modes. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NButton, NInput, NSelect, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NButton || !NInput || !NSelect || !useMessage) {
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
  display:flex; align-items:center; gap:0.75rem;
  padding-bottom:0.75rem; border-bottom:0.0625rem solid #f1f5f9;
}
.bt-settings .head-left { display:flex; align-items:center; gap:0.5rem; min-width:0; }
.bt-settings .icon {
  width:1.625rem; height:1.625rem; border-radius:0.5rem; flex:0 0 auto;
  display:flex; align-items:center; justify-content:center; font-size:0.8125rem;
}
.bt-settings .icon.green { background:#ecfdf5; color:#059669; }
.bt-settings .icon.blue { background:#eff6ff; color:#2563eb; }
.bt-settings h3 { margin:0; font-size:0.9375rem; font-weight:700; color:#0f172a; }
.bt-settings .field { display:flex; flex-direction:column; gap:0.375rem; min-width:0; }
.bt-settings .label { font-size:0.75rem; color:#64748b; font-weight:600; }
.bt-settings .hint { margin:0; color:#94a3b8; font-size:0.6875rem; line-height:1.4; }
.bt-settings .row { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row .n-input { flex:1; min-width:0; }
.bt-settings .row-inline { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row-inline .n-input { width:5.5rem; flex:0 0 auto; }
.bt-settings .unit { font-size:0.75rem; color:#64748b; }
.bt-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.bt-settings .action-block {
  display:flex; flex-direction:column; gap:0.5rem;
  padding:0.75rem; border:0.0625rem solid #f1f5f9; border-radius:0.75rem; background:#fafcff;
}
`

const CONNECT_OPTIONS = [
  { label: '不做任何动作', value: 'none' },
  { label: '显示通知', value: 'notify' },
  { label: '启动软件', value: 'launch' },
]

const DISCONNECT_OPTIONS = [
  { label: '不做任何动作', value: 'none' },
  { label: '暂停播放', value: 'pause' },
  { label: '关闭软件', value: 'close' },
]

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

function normalizeConnectAction(value, legacy = {}) {
  if (value === 'none' || value === 'notify' || value === 'launch') return value
  if (legacy.autoLaunchOnConnect === true) return 'launch'
  return 'notify'
}

function normalizeDisconnectAction(value, legacy = {}) {
  if (value === 'none' || value === 'pause' || value === 'close') return value
  // legacy: notify → none (disconnect no longer notifies); pause stays; close is new
  if (value === 'notify') return 'none'
  if (legacy.pauseOnDisconnect === true) return 'pause'
  if (legacy.notifyDisconnect === false) return 'none'
  return 'none'
}

const DEFAULT_CONFIG = {
  playerPath: '',
  playerArgs: '',
  connectAction: 'notify',
  disconnectAction: 'none',
  connectedAutoHideSec: 5,
  disconnectedAutoHideSec: 3,
}

export default {
  name: 'BtMusicSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const busy = ref('')
    const playerPath = ref(DEFAULT_CONFIG.playerPath)
    const playerArgs = ref(DEFAULT_CONFIG.playerArgs)
    const connectAction = ref(DEFAULT_CONFIG.connectAction)
    const disconnectAction = ref(DEFAULT_CONFIG.disconnectAction)
    const connectedAutoHideSec = ref(DEFAULT_CONFIG.connectedAutoHideSec)
    const disconnectedAutoHideSec = ref(DEFAULT_CONFIG.disconnectedAutoHideSec)
    let saveTimer = null

    function currentConfig() {
      return {
        listenEnabled: true,
        nameKeywords: [],
        playerPath: playerPath.value || '',
        playerArgs: splitArgs(playerArgs.value || ''),
        connectAction: normalizeConnectAction(connectAction.value),
        disconnectAction: normalizeDisconnectAction(disconnectAction.value),
        // Keep legacy mirrors for older sidecars / status dumps.
        autoLaunchOnConnect: connectAction.value === 'launch',
        notifyDisconnect: false,
        pauseOnDisconnect: disconnectAction.value === 'pause',
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
      if (typeof cfg.playerPath === 'string') playerPath.value = cfg.playerPath
      if (Array.isArray(cfg.playerArgs)) playerArgs.value = cfg.playerArgs.join(' ')
      else if (typeof cfg.playerArgs === 'string') playerArgs.value = cfg.playerArgs
      connectAction.value = normalizeConnectAction(cfg.connectAction, cfg)
      disconnectAction.value = normalizeDisconnectAction(cfg.disconnectAction, cfg)
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
      connectAction.value = cfg.connectAction
      disconnectAction.value = cfg.disconnectAction
      connectedAutoHideSec.value = cfg.connectedAutoHideSec
      disconnectedAutoHideSec.value = cfg.disconnectedAutoHideSec

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
        const result = await plugin.sidecar.request('openPlayer', {})
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
        let sampleName = '蓝牙耳机'
        try {
          const status = await plugin.sidecar.request('getStatus')
          const devices = status?.devices || status?.pairedDevices || []
          if (Array.isArray(devices) && devices[0]?.name) sampleName = devices[0].name
        } catch {
          /* ignore */
        }
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
          playerPath: playerPath.value || '',
          playerName: String(playerPath.value || '')
            .split(/[/\\]/)
            .pop()
            ?.replace(/\.exe$/i, '') || '',
        }
        if (!sticky) payload.auto_hide_ms = hideSec * 1000

        // Prefer sidecar status for icon if available.
        try {
          const status = await plugin.sidecar.request('getStatus')
          if (status?.playerIconDataUrl) payload.playerIconDataUrl = status.playerIconDataUrl
          if (status?.playerName) payload.playerName = status.playerName
          if (status?.playerPath) payload.playerPath = status.playerPath
        } catch {
          /* ignore */
        }

        await plugin.events.publish({
          eventType: 'bt-music.connected',
          kind: 'bt-music',
          title: '耳机已连接',
          body: sampleName,
          level: 'success',
          sticky,
          actions: [
            { id: 'open-player', label: '打开听歌' },
            { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
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

    const card = (iconClass, icon, title, children) =>
      h('section', { class: 'card' }, [
        h('div', { class: 'head' }, [
          h('div', { class: 'head-left' }, [
            h('span', { class: `icon ${iconClass}` }, icon),
            h('h3', title),
          ]),
        ]),
        ...children,
      ])

    return () =>
      h('div', { class: 'bt-settings' }, [
        h('div', { class: 'grid' }, [
          card('green', '♪', '听歌程序', [
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
            h('div', { class: 'actions' }, [
              button('测试启动', 'open', testOpenPlayer),
              button('测试通知', 'toast', testNotification),
            ]),
          ]),

          card('blue', '⚡', '连接 / 断开动作', [
            h('div', { class: 'action-block' }, [
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '耳机连上时'),
                h(NSelect, {
                  value: connectAction.value,
                  options: CONNECT_OPTIONS,
                  'onUpdate:value': (v) => {
                    connectAction.value = normalizeConnectAction(v)
                    scheduleSave()
                  },
                }),
                h(
                  'p',
                  { class: 'hint' },
                  connectAction.value === 'launch'
                    ? '连接后直接启动听歌软件'
                    : connectAction.value === 'none'
                      ? '连接时不处理'
                      : '弹出连接通知，可手动打开听歌',
                ),
              ]),
              connectAction.value === 'notify'
                ? h('div', { class: 'field' }, [
                    h('span', { class: 'label' }, '连接通知驻留'),
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
                  ])
                : null,
            ]),
            h('div', { class: 'action-block' }, [
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '耳机断开时'),
                h(NSelect, {
                  value: disconnectAction.value,
                  options: DISCONNECT_OPTIONS,
                  'onUpdate:value': (v) => {
                    disconnectAction.value = normalizeDisconnectAction(v)
                    scheduleSave()
                  },
                }),
                h(
                  'p',
                  { class: 'hint' },
                  disconnectAction.value === 'pause'
                    ? '断开后向系统发送暂停键'
                    : disconnectAction.value === 'close'
                      ? '断开后关闭已配置的听歌软件'
                      : '断开时不处理',
                ),
              ]),
            ]),
          ]),
        ]),
      ])
  },
}
