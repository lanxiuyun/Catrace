/** Bluetooth music plugin settings — filter, player path, simulate connect. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NAlert, NButton, NInput, NSwitch, NTag, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NButton || !NInput || !NSwitch || !NAlert || !NTag || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing')
}
if (!plugin || !plugin.config || !plugin.sidecar) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'bt-music'
const STYLE_ID = 'catrace-plugin-bt-music-settings-css'
const CSS = `
.bt-settings { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#1e3a8a; }
.bt-settings * { box-sizing:border-box; }
.bt-settings .intro { line-height:1.55; }
.bt-settings .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(18rem,1fr)); gap:0.75rem; }
.bt-settings .card {
  min-width:0; padding:1rem 1.125rem; border:0.0625rem solid #dbeafe; border-radius:0.875rem;
  background:#fff; display:flex; flex-direction:column; gap:0.625rem;
}
.bt-settings .head { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.bt-settings h3 { margin:0; font-size:0.875rem; color:#1d4ed8; }
.bt-settings .desc { margin:0; color:#64748b; font-size:0.75rem; line-height:1.5; }
.bt-settings .field { display:flex; flex-direction:column; gap:0.375rem; }
.bt-settings .label { font-size:0.75rem; color:#475569; font-weight:600; }
.bt-settings .row { display:flex; align-items:center; gap:0.5rem; }
.bt-settings .row .n-input { flex:1; min-width:0; }
.bt-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.bt-settings .value {
  min-height:2.25rem; padding:0.625rem; border-radius:0.5rem; background:#eff6ff; color:#1e40af;
  font:0.75rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;
  white-space:pre-wrap; word-break:break-all; overflow:auto; max-height:14rem;
}
.bt-settings .switch-row { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; }
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

const DEFAULT_CONFIG = {
  watchEnabled: false,
  nameFilter: '',
  playerPath: 'notepad.exe',
  playerArgs: '',
  pollIntervalMs: 4000,
  notifyDisconnect: true,
  simulateName: 'WH-1000XM5 (模拟)',
}

export default {
  name: 'BtMusicSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const busy = ref('')
    const watchEnabled = ref(DEFAULT_CONFIG.watchEnabled)
    const nameFilter = ref(DEFAULT_CONFIG.nameFilter)
    const playerPath = ref(DEFAULT_CONFIG.playerPath)
    const playerArgs = ref(DEFAULT_CONFIG.playerArgs)
    const pollIntervalMs = ref(DEFAULT_CONFIG.pollIntervalMs)
    const notifyDisconnect = ref(DEFAULT_CONFIG.notifyDisconnect)
    const simulateName = ref(DEFAULT_CONFIG.simulateName)
    const statusText = ref('尚未读取 sidecar 状态')

    function currentConfig() {
      return {
        watchEnabled: !!watchEnabled.value,
        nameFilter: nameFilter.value || '',
        playerPath: playerPath.value || '',
        playerArgs: splitArgs(playerArgs.value || ''),
        pollIntervalMs: Number(pollIntervalMs.value) || 4000,
        notifyDisconnect: !!notifyDisconnect.value,
        simulateName: simulateName.value || DEFAULT_CONFIG.simulateName,
      }
    }

    function applyConfig(cfg = {}) {
      if (typeof cfg.watchEnabled === 'boolean') watchEnabled.value = cfg.watchEnabled
      if (typeof cfg.nameFilter === 'string') nameFilter.value = cfg.nameFilter
      if (typeof cfg.playerPath === 'string') playerPath.value = cfg.playerPath
      if (Array.isArray(cfg.playerArgs)) playerArgs.value = cfg.playerArgs.join(' ')
      else if (typeof cfg.playerArgs === 'string') playerArgs.value = cfg.playerArgs
      if (typeof cfg.pollIntervalMs === 'number') pollIntervalMs.value = cfg.pollIntervalMs
      if (typeof cfg.notifyDisconnect === 'boolean') notifyDisconnect.value = cfg.notifyDisconnect
      if (typeof cfg.simulateName === 'string') simulateName.value = cfg.simulateName
    }

    async function run(key, task) {
      busy.value = key
      try {
        await task()
      } catch (error) {
        const text = errorText(error)
        message.error(text)
        statusText.value = text
      } finally {
        busy.value = ''
      }
    }

    async function pushToSidecar(cfg) {
      return plugin.sidecar.request('setConfig', {
        watchEnabled: cfg.watchEnabled,
        nameFilter: cfg.nameFilter,
        playerPath: cfg.playerPath,
        playerArgs: cfg.playerArgs,
        pollIntervalMs: cfg.pollIntervalMs,
        notifyDisconnect: cfg.notifyDisconnect,
      })
    }

    async function saveConfig() {
      await run('save', async () => {
        const cfg = currentConfig()
        await plugin.config.set(cfg)
        let status
        try {
          status = await pushToSidecar(cfg)
        } catch (error) {
          // Sidecar only runs while plugin enabled; config still persists.
          statusText.value = `已保存配置；sidecar 未就绪：${errorText(error)}`
          message.warning('配置已保存（启用插件后 sidecar 才会监听）')
          await plugin.log.warn('bt-music config saved without sidecar', { error: errorText(error) })
          return
        }
        statusText.value = JSON.stringify(status, null, 2)
        message.success('配置已保存并同步到 sidecar')
        await plugin.log.info('bt-music config saved', { cfg })
      })
    }

    async function refreshStatus() {
      await run('status', async () => {
        const status = await plugin.sidecar.request('getStatus')
        statusText.value = JSON.stringify(status, null, 2)
      })
    }

    async function refreshDevices() {
      await run('refresh', async () => {
        const status = await plugin.sidecar.request('refresh')
        statusText.value = JSON.stringify(status, null, 2)
        message.success('已刷新设备列表')
      })
    }

    async function simulateConnect() {
      await run('sim-in', async () => {
        const cfg = currentConfig()
        try {
          await pushToSidecar(cfg)
        } catch {
          /* enable required */
        }
        const result = await plugin.sidecar.request('simulateConnect', {
          deviceName: simulateName.value || DEFAULT_CONFIG.simulateName,
        })
        statusText.value = JSON.stringify(result, null, 2)
        message.success('已模拟连接并发布 Toast')
      })
    }

    async function simulateDisconnect() {
      await run('sim-out', async () => {
        const result = await plugin.sidecar.request('simulateDisconnect', {
          deviceName: simulateName.value || undefined,
        })
        statusText.value = JSON.stringify(result, null, 2)
        message.success(result?.device ? '已模拟断开' : '没有可断开的设备')
      })
    }

    async function pickPlayer() {
      await run('pick', async () => {
        const path = await plugin.dialog.pickFile()
        if (path) playerPath.value = path
      })
    }

    async function testOpenPlayer() {
      await run('open', async () => {
        const cfg = currentConfig()
        await pushToSidecar(cfg)
        const result = await plugin.sidecar.request('openPlayer', {
          deviceName: simulateName.value,
        })
        statusText.value = JSON.stringify(result, null, 2)
        message.success(result?.ok ? `已启动 PID ${result.pid}` : '启动失败')
      })
    }

    onMounted(() => {
      run('boot', async () => {
        const saved = await plugin.config.get()
        if (saved && typeof saved === 'object') applyConfig(saved)
        try {
          const status = await pushToSidecar(currentConfig())
          statusText.value = JSON.stringify(status, null, 2)
        } catch (error) {
          statusText.value = `sidecar 未运行（先启用插件「${PLUGIN_ID}」）\n${errorText(error)}`
        }
      })
    })

    const card = (title, tag, description, children) =>
      h('section', { class: 'card' }, [
        h('div', { class: 'head' }, [
          h('h3', title),
          h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => tag }),
        ]),
        h('p', { class: 'desc' }, description),
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
        h(
          NAlert,
          { type: 'info', bordered: false, class: 'intro' },
          {
            default: () =>
              '默认只开「模拟连接」。设备轮询默认关闭；打开后轮询 Windows 蓝牙音频（要求 DEVPKEY_Device_IsConnected=True，忽略仅配对未连接），同一耳机组合成一条 Toast。无真机时用模拟验收。默认播放器 notepad.exe。',
          },
        ),
        h('div', { class: 'grid' }, [
          card('监听', 'WATCH', '打开轮询后，新连上的蓝牙耳机会弹 Toast。名称过滤可填关键词缩小范围（空=全部蓝牙音频）。', [
            h('div', { class: 'switch-row' }, [
              h('span', { class: 'label' }, '启用设备轮询'),
              h(NSwitch, {
                value: watchEnabled.value,
                'onUpdate:value': (v) => {
                  watchEnabled.value = v
                },
              }),
            ]),
            h('div', { class: 'switch-row' }, [
              h('span', { class: 'label' }, '断开时也提醒'),
              h(NSwitch, {
                value: notifyDisconnect.value,
                'onUpdate:value': (v) => {
                  notifyDisconnect.value = v
                },
              }),
            ]),
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '名称包含（可选）'),
              h(NInput, {
                value: nameFilter.value,
                'onUpdate:value': (v) => {
                  nameFilter.value = v
                },
                placeholder: '例如 XM5 / AirPods / 耳机',
                clearable: true,
              }),
            ]),
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '轮询间隔（毫秒）'),
              h(NInput, {
                value: String(pollIntervalMs.value ?? 4000),
                'onUpdate:value': (v) => {
                  const n = Number(v)
                  pollIntervalMs.value = Number.isFinite(n) ? n : 4000
                },
                placeholder: '1500–60000',
              }),
            ]),
            h('div', { class: 'actions' }, [
              button('保存并同步', 'save', saveConfig),
              button('刷新设备', 'refresh', refreshDevices),
            ]),
          ]),
          card('听歌程序', 'PLAYER', 'Toast 点「打开听歌」时由 sidecar 直接 spawn，不经过宿主业务 API。', [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '可执行文件'),
              h('div', { class: 'row' }, [
                h(NInput, {
                  value: playerPath.value,
                  'onUpdate:value': (v) => {
                    playerPath.value = v
                  },
                  placeholder: 'notepad.exe 或绝对路径',
                }),
                button('选择', 'pick', pickPlayer),
              ]),
            ]),
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '参数（可选）'),
              h(NInput, {
                value: playerArgs.value,
                'onUpdate:value': (v) => {
                  playerArgs.value = v
                },
                placeholder: '例如 --mini',
              }),
            ]),
            h('div', { class: 'actions' }, [
              button('保存并同步', 'save', saveConfig),
              button('测试启动', 'open', testOpenPlayer),
            ]),
          ]),
          card('模拟 / 状态', 'DEMO', '无蓝牙硬件时用模拟连接验收 publish → Toast → open-player。', [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '模拟设备名'),
              h(NInput, {
                value: simulateName.value,
                'onUpdate:value': (v) => {
                  simulateName.value = v
                },
              }),
            ]),
            h('div', { class: 'actions' }, [
              button('模拟连接', 'sim-in', simulateConnect),
              button('模拟断开', 'sim-out', simulateDisconnect),
              button('读状态', 'status', refreshStatus),
            ]),
            h('pre', { class: 'value' }, statusText.value),
          ]),
        ]),
      ])
  },
}
