# 插件文件脚手架（拷贝即用）

将下文中的 `my-plugin` / 文案换成你的 id 与产品名。  
安装位置：Catrace **plugins 目录**下的 `my-plugin/` 文件夹（应用内「打开插件目录」）。

---

## A. 最小：仅自定义 Toast 卡

### `manifest.json`

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "自定义 Toast 卡示例",
  "main": "ui.mjs",
  "events": ["my-plugin", "kind:my-plugin", "my-plugin.demo"],
  "enabledByDefault": false
}
```

### `ui.mjs`

```js
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'my-plugin-card-style'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .my-plugin-card {
      box-sizing: border-box;
      min-width: 16rem;
      max-width: 22rem;
      padding: 0.75rem 0.875rem;
      border-radius: 0.75rem;
      background: var(--n-color, #fff);
      color: var(--n-text-color, #111);
      box-shadow: 0 0.5rem 1.5rem rgba(0,0,0,.12);
      font-size: 0.875rem;
    }
    .my-plugin-card__title {
      margin: 0 0 0.25rem;
      font-size: 0.9375rem;
      font-weight: 600;
    }
    .my-plugin-card__body {
      margin: 0 0 0.625rem;
      opacity: 0.85;
      line-height: 1.4;
    }
    .my-plugin-card__row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      justify-content: flex-end;
    }
    .my-plugin-card__btn {
      border: 1px solid rgba(0,0,0,.12);
      background: transparent;
      border-radius: 0.375rem;
      padding: 0.25rem 0.625rem;
      cursor: pointer;
      font-size: 0.8125rem;
    }
    .my-plugin-card__close {
      float: right;
      border: 0;
      background: transparent;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      opacity: 0.55;
    }
  `
  document.head.appendChild(style)
}

export default {
  name: 'MyPluginCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  render() {
    const event = this.event || {}
    const actions = Array.isArray(event.actions) ? event.actions : []
    return h('div', { class: 'my-plugin-card', 'data-hovered': this.isHovered ? '1' : '0' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'my-plugin-card__close',
          onClick: () => this.$emit('close'),
        },
        '×',
      ),
      h('h2', { class: 'my-plugin-card__title' }, event.title || '通知'),
      event.body ? h('p', { class: 'my-plugin-card__body' }, event.body) : null,
      actions.length
        ? h(
            'div',
            { class: 'my-plugin-card__row' },
            actions.map((a) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'my-plugin-card__btn',
                  onClick: () => this.$emit('action', a.id),
                },
                a.label || a.id,
              ),
            ),
          )
        : null,
    ])
  },
}
```

---

## B. 定时型：background + settings + ui

### `manifest.json`

```json
{
  "id": "my-plugin",
  "name": "定时示例",
  "version": "0.1.0",
  "description": "后台轮询 + 配置 + 自定义卡",
  "main": "ui.mjs",
  "background": "background.mjs",
  "settings": "settings.mjs",
  "events": ["my-plugin", "kind:my-plugin", "my-plugin.due"],
  "enabledByDefault": false
}
```

### `background.mjs`

```js
// plugin 由宿主注入，勿重新声明 create
const DEFAULT_CONFIG = {
  enabled: true,
  intervalMinutes: 30,
}

const STORAGE_LAST_FIRE = 'lastFireAt'

function mergeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const interval = Number(c.intervalMinutes)
  return {
    enabled: c.enabled !== false,
    intervalMinutes: Number.isFinite(interval)
      ? Math.min(24 * 60, Math.max(1, interval))
      : DEFAULT_CONFIG.intervalMinutes,
  }
}

async function loadConfig() {
  try {
    return mergeConfig(await plugin.config.get())
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

async function maybeFire() {
  const cfg = await loadConfig()
  if (!cfg.enabled) return

  const now = Date.now()
  let last = 0
  try {
    const v = await plugin.storage.get(STORAGE_LAST_FIRE)
    last = typeof v === 'number' ? v : Number(v) || 0
  } catch {
    /* ignore */
  }

  const gapMs = cfg.intervalMinutes * 60 * 1000
  if (last && now - last < gapMs) return

  await plugin.events.publish({
    eventType: 'my-plugin.due',
    kind: 'my-plugin',
    title: '定时提醒',
    body: `已满 ${cfg.intervalMinutes} 分钟`,
    level: 'info',
    sticky: false,
    dedupeKey: `my-plugin:due:${Math.floor(now / gapMs)}`,
    actions: [{ id: 'ack', label: '知道了' }],
    payload: { firedAt: now },
  })

  try {
    await plugin.storage.set(STORAGE_LAST_FIRE, now)
  } catch (e) {
    plugin.log?.warn?.('storage set failed', { error: String(e) })
  }
}

plugin.log?.info?.('my-plugin background started')
maybeFire()
setInterval(() => {
  maybeFire().catch((e) => plugin.log?.error?.('tick failed', { error: String(e) }))
}, 15_000)
```

### `settings.mjs`

```js
const { h, ref, onMounted } = globalThis.__CATRACE_VUE__
const { NButton, NInput, NSwitch, NSpace, useMessage } = globalThis.__CATRACE_NAIVE__

function clampInterval(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 30
  return Math.min(24 * 60, Math.max(1, Math.round(v)))
}

export default {
  name: 'MyPluginSettings',
  setup() {
    const message = useMessage()
    const enabled = ref(true)
    const intervalText = ref('30')
    const saving = ref(false)

    async function load() {
      const c = (await plugin.config.get()) || {}
      enabled.value = c.enabled !== false
      intervalText.value = String(clampInterval(c.intervalMinutes ?? 30))
    }

    async function save() {
      saving.value = true
      try {
        const next = {
          enabled: enabled.value,
          intervalMinutes: clampInterval(intervalText.value),
        }
        intervalText.value = String(next.intervalMinutes)
        await plugin.config.set(next)
        message.success('已保存')
      } catch (e) {
        message.error(String(e?.message || e))
      } finally {
        saving.value = false
      }
    }

    onMounted(() => {
      load().catch((e) => message.error(String(e?.message || e)))
    })

    return () =>
      h('div', { class: 'my-plugin-settings' }, [
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } }, [
            h('span', '启用规则'),
            h(NSwitch, {
              value: enabled.value,
              'onUpdate:value': (v) => {
                enabled.value = v
              },
            }),
          ]),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } }, [
            h('span', { style: { whiteSpace: 'nowrap' } }, '间隔（分钟）'),
            h(NInput, {
              value: intervalText.value,
              style: { maxWidth: '8rem' },
              'onUpdate:value': (v) => {
                intervalText.value = v
              },
            }),
          ]),
          h(NSpace, null, {
            default: () => [
              h(
                NButton,
                { type: 'primary', loading: saving.value, onClick: () => save() },
                { default: () => '保存' },
              ),
            ],
          }),
        ]),
      ])
  },
}
```

`ui.mjs` 可直接用 **A** 节（改 class 前缀与文案即可）。

---

## C. Sidecar + settings + ui

### `manifest.json`

```json
{
  "id": "my-plugin",
  "name": "Sidecar 示例",
  "version": "0.1.0",
  "description": "本机进程 + Toast + RPC",
  "main": "ui.mjs",
  "settings": "settings.mjs",
  "events": [
    "my-plugin",
    "kind:my-plugin",
    "my-plugin.connected",
    "my-plugin.disconnected",
    "my-plugin.tick"
  ],
  "enabledByDefault": false,
  "sidecar": {
    "command": "node",
    "args": ["runtime/main.mjs"],
    "cwd": "."
  }
}
```

### `runtime/main.mjs`

```js
import readline from 'node:readline'
import { spawn } from 'node:child_process'

const PLUGIN_ID = process.env.CATRACE_PLUGIN_ID || 'my-plugin'
const PROTOCOL = process.env.CATRACE_PROTOCOL_VERSION || '1'

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function log(level, message, data) {
  const row = { v: 1, op: 'log', level, message }
  if (data !== undefined) row.data = data
  send(row)
}

function respond(requestId, ok, result, error) {
  if (!requestId) return
  const message = { v: 1, op: 'response', requestId, ok: !!ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function publish(event) {
  send({ v: 1, op: 'publish', event })
}

/** @type {Record<string, unknown>} */
let config = {
  openPath: '',
}

function applyConfig(next) {
  if (!next || typeof next !== 'object') return
  config = { ...config, ...next }
}

function handleResolved(msg) {
  const actionId = msg.actionId
  if (actionId === 'open-app') {
    const target = String(config.openPath || '').trim()
    if (!target) {
      log('warn', 'open-app: no openPath in config')
      return
    }
    try {
      spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
      log('info', 'spawned', { target })
    } catch (e) {
      log('error', 'spawn failed', { error: String(e) })
    }
    return
  }
  if (actionId === 'echo') {
    setTimeout(() => {
      publish({
        eventType: 'my-plugin.tick',
        kind: 'my-plugin',
        title: 'Echo',
        body: `echo @ ${new Date().toISOString()}`,
        level: 'info',
        sticky: true,
        dedupeKey: 'my-plugin:sticky-echo',
        actions: [
          { id: 'echo', label: '再 Echo' },
          { id: 'done', label: '完成' },
        ],
        payload: { t: Date.now() },
      })
    }, 400)
  }
  // done / dismiss：不要再 publish sticky
}

function handleRequest(msg) {
  const { requestId, method, params } = msg
  try {
    if (method === 'ping') {
      respond(requestId, true, { pong: true, pluginId: PLUGIN_ID, protocol: PROTOCOL })
      return
    }
    if (method === 'setConfig') {
      applyConfig(params || {})
      respond(requestId, true, { ok: true, config })
      return
    }
    if (method === 'simulate') {
      const kind = params?.kind === 'disconnected' ? 'disconnected' : 'connected'
      publish({
        eventType: `my-plugin.${kind}`,
        kind: 'my-plugin',
        title: kind === 'connected' ? '已连接' : '已断开',
        body: String(params?.name || 'demo-device'),
        level: 'info',
        sticky: kind === 'connected',
        dedupeKey: `my-plugin:${kind}`,
        actions:
          kind === 'connected'
            ? [
                { id: 'open-app', label: '打开应用' },
                { id: 'done', label: '关闭' },
              ]
            : [{ id: 'done', label: '关闭' }],
        payload: { name: params?.name || 'demo-device', at: Date.now() },
      })
      respond(requestId, true, { ok: true, kind })
      return
    }
    respond(requestId, false, null, `unknown method: ${method}`)
  } catch (e) {
    respond(requestId, false, null, String(e?.message || e))
  }
}

send({ v: 1, op: 'ready' })
log('info', 'sidecar up', { pluginId: PLUGIN_ID, protocol: PROTOCOL })

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const text = String(line || '').trim()
  if (!text) return
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }
  if (msg.op === 'shutdown') {
    log('info', 'shutdown')
    process.exit(0)
  }
  if (msg.op === 'config') {
    applyConfig(msg.config)
    return
  }
  if (msg.op === 'resolved') {
    handleResolved(msg)
    return
  }
  if (msg.requestId && msg.method) {
    handleRequest(msg)
  }
})
```

### `settings.mjs`（调 sidecar RPC）

```js
const { h, ref, onMounted } = globalThis.__CATRACE_VUE__
const { NButton, NInput, NSpace, useMessage } = globalThis.__CATRACE_NAIVE__

export default {
  name: 'MyPluginSettings',
  setup() {
    const message = useMessage()
    const openPath = ref('')
    const busy = ref(false)

    async function load() {
      const c = (await plugin.config.get()) || {}
      openPath.value = typeof c.openPath === 'string' ? c.openPath : ''
    }

    async function save() {
      busy.value = true
      try {
        const next = { openPath: openPath.value.trim() }
        await plugin.config.set(next)
        try {
          await plugin.sidecar.request('setConfig', next)
        } catch {
          // 未启用时 sidecar 可能未运行，配置仍已保存
        }
        message.success('已保存')
      } catch (e) {
        message.error(String(e?.message || e))
      } finally {
        busy.value = false
      }
    }

    async function simulate(kind) {
      busy.value = true
      try {
        await plugin.sidecar.request('simulate', { kind, name: 'demo-device' })
        message.success(kind === 'connected' ? '已模拟连接' : '已模拟断开')
      } catch (e) {
        message.error(String(e?.message || e))
      } finally {
        busy.value = false
      }
    }

    onMounted(() => {
      load().catch((e) => message.error(String(e?.message || e)))
    })

    return () =>
      h('div', { class: 'my-plugin-settings' }, [
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' } }, [
          h('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } }, [
            h('span', { style: { whiteSpace: 'nowrap' } }, '打开路径'),
            h(NInput, {
              value: openPath.value,
              placeholder: '可执行文件或文档路径',
              'onUpdate:value': (v) => {
                openPath.value = v
              },
            }),
          ]),
          h(NSpace, null, {
            default: () => [
              h(NButton, { type: 'primary', loading: busy.value, onClick: () => save() }, { default: () => '保存' }),
              h(NButton, { loading: busy.value, onClick: () => simulate('connected') }, { default: () => '模拟连接' }),
              h(NButton, { loading: busy.value, onClick: () => simulate('disconnected') }, { default: () => '模拟断开' }),
            ],
          }),
        ]),
      ])
  },
}
```

`ui.mjs` 用 **A** 节即可。

### Sticky 按钮约定

```text
actionId === 'echo'           → 保留卡片，可延迟再 publish 同一 dedupeKey
actionId === 'done' / 关闭    → 卸卡；sidecar 不要再发 sticky
```

---

## D. 每个插件建议附带的 README 片段

```markdown
# my-plugin

一句话说明。

## 信任

启用本插件 = 信任其全部本地代码（含 sidecar 子进程）。请只安装你信任的来源。

## 安装

1. 在 Catrace 中打开插件目录  
2. 将本文件夹放到 `plugins/my-plugin/`（目录名须与 id 一致）  
3. 重新扫描或重启 Catrace 后启用  

## 手测

1. 启用插件  
2. …（按你的功能写）  
3. 若有 sidecar：禁用后确认无残留相关进程  
```

---

## E. 不要复制进插件的写法

```js
import { ref } from 'vue'           // 错误：blob 模块解析不到
import { NButton } from 'naive-ui' // 错误：同上
// NInputNumber                     // 错误：宿主未注入
```

```js
// settings 根节点 — 错误：与宿主详情区双倍边距
h('div', { style: { padding: '1.5rem', maxWidth: '40rem' } }, ...)
```

```json
"events": ["rest", "agent"]
```

（错误：占用保留 kind）

---

## F. 按架构需要的文件

| 架构 | 文件 |
|------|------|
| 仅 UI | manifest.json、ui.mjs、README |
| 定时型 | 另加 background.mjs、settings.mjs |
| Sidecar | 另加 runtime/main.mjs、settings（RPC）、manifest.sidecar |
| 可选 | runtime 内 package.json（须自行说明依赖安装方式） |
