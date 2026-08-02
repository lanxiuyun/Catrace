/** Bluetooth music plugin settings — product-facing grid cards. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NButton, NInput, NSwitch, NTag, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NButton || !NInput || !NSwitch || !NTag || !useMessage) {
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
  min-width:0; padding:1rem 1.125rem; border:0.0625rem solid #e2e8f0; border-radius:0.875rem;
  background:#fff; display:flex; flex-direction:column; gap:0.625rem;
}
.bt-settings .head { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.bt-settings h3 { margin:0; font-size:0.875rem; color:#0f172a; }
.bt-settings .desc { margin:0; color:#64748b; font-size:0.75rem; line-height:1.5; }
.bt-settings .field { display:flex; flex-direction:column; gap:0.375rem; }
.bt-settings .label { font-size:0.75rem; color:#475569; font-weight:600; }
.bt-settings .hint { margin:0; color:#94a3b8; font-size:0.6875rem; line-height:1.4; }
.bt-settings .row { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row .n-input { flex:1; min-width:0; }
.bt-settings .row-inline { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
.bt-settings .row-inline .n-input { width:5.5rem; flex:0 0 auto; }
.bt-settings .unit { font-size:0.75rem; color:#64748b; }
.bt-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.bt-settings .switch-row { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; }
.bt-settings .save-hint { margin:0; color:#94a3b8; font-size:0.6875rem; }
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

/** 0 = sticky until dismiss; otherwise auto-hide seconds (host clamps 3s–10min). */
function clampAutoHideSec(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded <= 0) return 0
  return Math.min(600, Math.max(3, rounded))
}

const DEFAULT_CONFIG = {
  nameFilter: '',
  playerPath: '',
  playerArgs: '',
  notifyDisconnect: true,
  connectedAutoHideSec: 5,
  disconnectedAutoHideSec: 3,
}

export default {
  name: 'BtMusicSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const busy = ref('')
    const nameFilter = ref(DEFAULT_CONFIG.nameFilter)
    const playerPath = ref(DEFAULT_CONFIG.playerPath)
    const playerArgs = ref(DEFAULT_CONFIG.playerArgs)
    const notifyDisconnect = ref(DEFAULT_CONFIG.notifyDisconnect)
    const connectedAutoHideSec = ref(DEFAULT_CONFIG.connectedAutoHideSec)
    const disconnectedAutoHideSec = ref(DEFAULT_CONFIG.disconnectedAutoHideSec)
    const saveHint = ref('')
    let saveTimer = null

    function currentConfig() {
      return {
        nameFilter: nameFilter.value || '',
        playerPath: playerPath.value || '',
        playerArgs: splitArgs(playerArgs.value || ''),
        notifyDisconnect: !!notifyDisconnect.value,
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
      if (typeof cfg.nameFilter === 'string') nameFilter.value = cfg.nameFilter
      if (typeof cfg.playerPath === 'string') playerPath.value = cfg.playerPath
      if (Array.isArray(cfg.playerArgs)) playerArgs.value = cfg.playerArgs.join(' ')
      else if (typeof cfg.playerArgs === 'string') playerArgs.value = cfg.playerArgs
      if (typeof cfg.notifyDisconnect === 'boolean') notifyDisconnect.value = cfg.notifyDisconnect
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
      connectedAutoHideSec.value = cfg.connectedAutoHideSec
      disconnectedAutoHideSec.value = cfg.disconnectedAutoHideSec

      await plugin.config.set(cfg)
      try {
        await plugin.sidecar.request('setConfig', cfg)
        saveHint.value = '已自动保存'
        if (!quiet) message.success('已保存')
        await plugin.log.info('bt-music config auto-saved', { cfg })
      } catch (error) {
        saveHint.value = '已保存（启用插件后生效）'
        if (!quiet) message.warning(saveHint.value)
        await plugin.log.warn('bt-music config saved without runtime', { error: errorText(error) })
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveHint.value = '保存中…'
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
        if (result?.ok) message.success('已启动听歌程序')
        else message.error(result?.error || '启动失败')
      })
    }

    onMounted(() => {
      run('boot', async () => {
        const saved = await plugin.config.get()
        if (saved && typeof saved === 'object') applyConfig(saved)
        await persistAndSync({ quiet: true })
      })
    })

    const card = (title, tag, description, children) =>
      h('section', { class: 'card' }, [
        h('div', { class: 'head' }, [
          h('h3', title),
          h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => tag }),
        ]),
        description ? h('p', { class: 'desc' }, description) : null,
        ...children,
      ])

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

    return () =>
      h('div', { class: 'bt-settings' }, [
        h('div', { class: 'grid' }, [
          card('触发条件', '监听', '名称过滤可缩小范围；空表示全部蓝牙耳机。', [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '名称包含（可选）'),
              h(NInput, {
                value: nameFilter.value,
                'onUpdate:value': (v) => {
                  nameFilter.value = v
                  scheduleSave()
                },
                placeholder: '例如 XM5 / AirPods / 耳机',
                clearable: true,
              }),
            ]),
            h('div', { class: 'switch-row' }, [
              h('span', { class: 'label' }, '断开时也提醒'),
              h(NSwitch, {
                value: notifyDisconnect.value,
                'onUpdate:value': (v) => {
                  notifyDisconnect.value = v
                  scheduleSave()
                },
              }),
            ]),
            saveHint.value ? h('p', { class: 'save-hint' }, saveHint.value) : null,
          ]),

          card('听歌程序', '启动', '连接弹窗点「打开听歌」时启动。', [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '目标程序'),
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
                placeholder: '例如 --mini',
              }),
            ]),
            h('div', { class: 'actions' }, [button('测试启动', 'open', testOpenPlayer)]),
          ]),

          card('弹窗偏好', '驻留', '填 0 表示不自动消失，需手动关闭。', [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '连接弹窗驻留'),
              h('div', { class: 'row-inline' }, [
                h(NInput, {
                  value: String(connectedAutoHideSec.value ?? 5),
                  'onUpdate:value': (v) => {
                    connectedAutoHideSec.value = clampAutoHideSec(v, DEFAULT_CONFIG.connectedAutoHideSec)
                    scheduleSave()
                  },
                  placeholder: '5',
                }),
                h('span', { class: 'unit' }, '秒'),
              ]),
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
      ])
  },
}
