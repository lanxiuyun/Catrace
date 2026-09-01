# 如何开发 Catrace 外部插件（完整指南）

> 面向：插件作者与 AI agent。  
> **不依赖 Catrace 源码。** 以本文合同为准；若你使用的 Catrace 版本行为不一致，以实际应用行为为准。

---

## 0. 一句话模型

```
本机 plugins/<插件id>/ 目录
  → Catrace 扫描 manifest.json
  → 用户启用后：可选隐藏页跑 background.mjs / 可选子进程跑 sidecar
  → 插件 publish 事件
  → Toast 用 ui.mjs 自定义卡片（或通用默认卡）
  → 用户点按钮 / 关闭 → 结果回传 background 与/或 sidecar
```

**业务能力写在插件里，不要指望宿主为你的业务开专用 API。**  
蓝牙、本机脚本、启动播放器等 → **sidecar**。定时与纯 JS 编排 → **background.mjs**。自定义外观 → **ui.mjs**。用户选项 → **settings.mjs** + `plugin.config`。

**信任：启用即信任。** Sidecar = 本机任意代码。无插件市场细粒度权限模型。

---

## 1. 先选架构

| 需求 | 用什么 | 说明 |
|------|--------|------|
| 自定义 Toast 外观 | `main` → `ui.mjs` | 可选；没有则用默认卡 |
| 定时、读活跃状态、纯 JS | `background.mjs` | 隐藏页常驻 |
| 开关、路径、表单 | `settings.mjs` | 插件详情里展示 |
| 蓝牙 / USB / PowerShell / 启动本机程序 | `sidecar` | 独立进程，JSONL 协议 |
| 只要简单通知 | `plugin.notification` 或 publish，可不写 `main` | |

合法组合示例：仅 ui；ui + settings；ui + background + settings；ui + sidecar + settings；background 与 sidecar 可同时存在。

---

## 2. 目录结构

把插件放在 Catrace 的 **plugins 根目录**下（应用内「打开插件目录」）：

```
plugins/
  <plugin-id>/
    manifest.json       # 必需
    ui.mjs              # 可选，对应 manifest.main
    settings.mjs        # 可选
    background.mjs      # 可选
    runtime/            # 可选，sidecar 脚本
      main.mjs
    README.md           # 建议：说明用途与信任风险
```

规则：

- 目录名 = `manifest.id`
- id 仅允许：`a-z`、`0-9`、`-`（推荐 kebab-case）
- `main` / `background` / `settings` / sidecar 脚本路径必须落在插件目录内

---

## 3. manifest.json

### 3.1 最小示例

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "一句话说明",
  "main": "ui.mjs",
  "events": ["my-plugin", "kind:my-plugin", "my-plugin.tick"],
  "enabledByDefault": false
}
```

### 3.2 字段

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 与目录名一致 |
| `name` | 是 | 列表显示名 |
| `version` | 是 | 版本字符串 |
| `description` | 建议 | 副文案 |
| `main` | 否 | Toast 卡脚本，相对路径 |
| `background` | 否 | 后台脚本 |
| `settings` | 否 | 设置面板脚本 |
| `events` | 要发事件时建议必填 | 白名单，见下 |
| `enabledByDefault` | 否 | 建议 `false` |
| `sidecar` | 否 | 见下 |

### 3.3 events 白名单

`events` 每一项可匹配：

- 完整 `eventType`，如 `my-plugin.tick`
- 裸 `kind`，如 `my-plugin`
- `kind:my-plugin` 形式

**不要占用宿主保留 kind：**

`rest` · `agent` · `permission` · `update` · `rest-timer` · `sdk`

插件自己的 kind 请用自己的 id 或明确前缀。

### 3.4 sidecar

```json
"sidecar": {
  "command": "node",
  "args": ["runtime/main.mjs"],
  "cwd": ".",
  "env": { "MY_DEBUG": "1" }
}
```

| 字段 | 规则 |
|------|------|
| `command` | 相对路径相对插件根；裸命令名走系统 PATH；也可绝对路径 |
| `args` | 原样传入 |
| `cwd` | 默认 `.` = 插件根 |
| `env` | 可选。宿主会**最后**写入 `CATRACE_PLUGIN_ID`、`CATRACE_PROTOCOL_VERSION=1`（同名覆盖你的 env） |

- 宿主**不会**替你 `npm install`
- Windows 上若用 `node`，需用户已安装并在 PATH 中
- 启用后插件中心会显示「本机进程」运行态；信任模型视 sidecar 为本机代码

#### sidecar 直接读写宿主 KV（M15.3）

sidecar stdout 可发（身份由宿主 running map 绑定，勿自报 pluginId）：

```json
{"v":1,"op":"storage.get","requestId":"r1","key":"cfg"}
{"v":1,"op":"storage.set","requestId":"r2","key":"cfg","value":{"n":1}}
```

宿主 stdin 统一用 `response` 应答（与 RPC 同形）：

```json
{"v":1,"op":"response","requestId":"r1","ok":true,"result":{"n":1}}
{"v":1,"op":"response","requestId":"r2","ok":false,"error":"..."}
```

- key 非空且不含 `:`；与 background `plugin.storage` **同一** SQLite 命名空间
- settings 用户配置仍优先 `plugin.config`；sidecar storage 适合进程侧运行态/缓存

---

## 4. 宿主注入（ui / settings / background）

加载前宿主会：

1. 注入全局运行时  
2. 在你的源码前插入：  
   `const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('<你的id>');`

因此脚本里**直接使用**模块级变量 `plugin`，不要自己 import 宿主模块，也不要重新 create。

### 4.1 Vue — `globalThis.__CATRACE_VUE__`

仅可使用：

`h` · `ref` · `computed` · `watch` · `markRaw` · `onMounted` · `onBeforeUnmount`

**禁止：**

- `import … from 'vue'`
- 模板字符串 SFC（无运行时编译器）
- 未列出的 API（如 `reactive`、`provide` 等当前未注入）

一律用 `h(...)` 或 `setup() { return () => h(...) }`。

### 4.2 Naive UI — `globalThis.__CATRACE_NAIVE__`

**仅以下组件/API（完整白名单）：**

`NAlert` `NButton` `NDatePicker` `NDivider` `NInput` `NModal` `NPopconfirm` `NProgress`  
`NRadioButton` `NRadioGroup` `NSelect` `NSlider` `NSpace` `NSwitch` `NTag` `NTooltip`  
`useDialog` `useMessage`

**没有 `NInputNumber`。** 数字请用 `NInput` + `Number(...)` 并自行钳制范围。

`useMessage` / `useDialog` 必须在组件 `setup()` 内调用。

### 4.3 可选 UI 积木 — `globalThis.__CATRACE_UI__`

可能提供：`SettingRow`、`SliderControl`（与系统设置风格一致）。没有也可以纯 Naive / 原生 DOM。

### 4.4 尺寸

界面尺寸优先用 **rem**（按 1rem = 16px 理解）。细边框 1px、blur、SVG viewBox 可例外。

---

## 5. 各表面合同

### 5.1 ui.mjs — Toast 卡片

```js
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

export default {
  name: 'MyCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  render() {
    const event = this.event || {}
    return h('div', { class: 'my-plugin-card' }, [
      h('h2', event.title || ''),
      event.body ? h('p', event.body) : null,
      h('button', { type: 'button', onClick: () => this.$emit('close') }, '×'),
      ...(event.actions || []).map((a) =>
        h(
          'button',
          {
            type: 'button',
            onClick: () => this.$emit('action', a.id),
          },
          a.label,
        ),
      ),
    ])
  },
}
// 也可：export const Card = { ... }
```

| 约定 | 行为 |
|------|------|
| `props.event` | 事件对象（title / body / actions / payload / sticky 等） |
| `emit('close')` | 关闭卡片 |
| `emit('action', actionId)` | 触发该按钮，结果可回传 sidecar/background |
| 样式 | 自行插入 `<style id="插件前缀-…">`，class 带插件前缀防冲突 |

### 5.2 settings.mjs — 插件设置

```js
const { h, ref, onMounted } = globalThis.__CATRACE_VUE__
const { NButton, NSwitch, NInput, useMessage } = globalThis.__CATRACE_NAIVE__

export default {
  name: 'MySettings',
  setup() {
    const message = useMessage()
    const enabled = ref(true)
    onMounted(async () => {
      const c = await plugin.config.get()
      if (c && typeof c.enabled === 'boolean') enabled.value = c.enabled
    })
    return () =>
      h('div', { class: 'my-plugin-settings' }, [
        h(NSwitch, {
          value: enabled.value,
          'onUpdate:value': async (v) => {
            enabled.value = v
            await plugin.config.set({ ...((await plugin.config.get()) || {}), enabled: v })
            message.success('已保存')
          },
        }),
      ])
  },
}
```

**布局：**

- 宿主详情区已负责外边距与最大宽度  
- **settings 根节点不要再写**外层 `padding` / `max-width`（会双倍缩进）  
- 内部小组件自己的间距可以有  

优先在卡片内联编辑；若用 `NModal`，注意 teleport 到 `body`，样式选择器不要只绑在插件根下。

### 5.3 background.mjs — 后台

- 同样注入 `plugin` 与 Vue/Naive 全局；后台页**优先只用 `plugin.*`**，少做 DOM UI  
- 典型：`setInterval`、`plugin.activity`、`plugin.events.publish`、`plugin.config`、`plugin.storage`  
- **配置 vs 运行时数据：**  
  - 用户可改的选项 → `plugin.config`（整包对象）  
  - 上次触发时间、计数器 → `plugin.storage`（按 key）

### 5.4 Sidecar — 本机进程

协议：标准输入输出 **UTF-8 JSON Lines**，字段 `v: 1`。

#### Sidecar → 宿主

| op | 作用 |
|----|------|
| `ready` | 可选，进程就绪 |
| `publish` | 发布事件（字段同下节 publish） |
| `log` | `{ level, message, data? }` |
| `response` | 应答 RPC：`{ requestId, ok, result? 或 error? }` |
| `error` | 自报错误 |

```js
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
send({ v: 1, op: 'ready' })
send({
  v: 1,
  op: 'publish',
  event: {
    eventType: 'my-plugin.tick',
    kind: 'my-plugin',
    title: '标题',
    body: '正文',
    level: 'info',
    sticky: true,
    actions: [{ id: 'ack', label: '知道了' }],
    payload: {},
    dedupeKey: 'my-plugin:tick',
  },
})
```

#### 宿主 → Sidecar

| op / 行 | 时机 |
|---------|------|
| `config` | 启动或配置变更，带整包 `config` |
| `resolved` | 用户处理了 Toast：`eventId`、`actionId`、`resolutionKind` 等 |
| `shutdown` | 禁用或退出前；应结束进程 |
| 带 `requestId` + `method` + `params` 的行 | 来自 `plugin.sidecar.request` |

```js
import readline from 'node:readline'

function respond(requestId, ok, result, error) {
  const msg = { v: 1, op: 'response', requestId, ok: !!ok }
  if (ok) msg.result = result ?? null
  else msg.error = error || 'request failed'
  send(msg)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.op === 'shutdown') process.exit(0)
  if (msg.op === 'config') {
    /* 合并 msg.config */
    return
  }
  if (msg.op === 'resolved') {
    /* 按 msg.actionId 办事 */
    return
  }
  if (msg.requestId && msg.method) {
    respond(msg.requestId, true, { ok: true })
  }
})
```

stderr 行通常会进宿主日志。  
启用时拉起进程；禁用/退出会发 `shutdown` 并结束进程树。

---

## 6. `plugin.*` API（JS 表面）

多数能力要求插件**已启用**；设置页里 `plugin.config.get` 在未启用时通常仍可读。

| 路径 | 用途 |
|------|------|
| `plugin.env.getAll()` | 环境变量 |
| `plugin.dialog.showOpenDialog` / `showSaveDialog` / `pickFile` / `pickFolder` | 选路径 |
| `plugin.path.get(name)` | `appData` `appConfig` `appCache` `home` `desktop` `documents` `downloads` `temp` |
| `plugin.path.getPluginDir()` | 本插件安装目录，用来拼 `assets/` |
| `plugin.clipboard.*` | 读写文本/图像、清空 |
| `plugin.window.hideMain` / `showMain` | 主窗口 |
| `plugin.screen.getCursorPoint` 等 | 显示器与光标 |
| `plugin.storage.get/set/remove` | 插件隔离运行时 KV |
| `plugin.config.get/set` | 用户配置整包 |
| `plugin.setEnabled(bool)` | 开关自己 |
| `plugin.shell.openExternal` / `openPath` / `showItemInFolder` / `beep` | 外壳；`beep` 依赖系统声音方案，不可靠 |
| `plugin.audio.play(path, { volume?, repeat?, speed? })` | 播本地 wav/mp3/ogg/flac，返回 playbackId |
| `plugin.audio.stop/pause/resume/setVolume/isPlaying` | 控制一次播放 |
| `plugin.platform.getInfo()` | os / arch / family |
| `plugin.theme.isDark()` | 是否深色 |
| `plugin.notification.show({ title, body?, level?, sticky? })` | 简单通知 |
| `plugin.events.publish({...})` | 完整事件（见下） |
| `plugin.activity.get()` | 活跃快照 |
| `plugin.activity.getLastRealRest()` | 休息锚点（毫秒时间戳或 null） |
| `plugin.activity.getRecords({ from, to })` | 历史分钟记录。unix 秒、半开区间 `[from, to)`，最长 31 天；缺分钟不补行 |
| `plugin.process.spawn(path, args?)` | 启动进程，返回 `{ pid }` |
| `plugin.http.get(url)` | HTTP GET |
| `plugin.log.info/warn/error(msg, data?)` | 写宿主侧日志 |
| `plugin.sidecar.request(method, params?)` | 调用 sidecar RPC，返回 Promise |

### 6.1 `events.publish` 字段

```ts
{
  eventType: string
  kind: string
  title: string
  body?: string
  level?: 'info' | 'warning' | 'error' | 'success'
  sticky?: boolean
  actions?: { id: string; label: string }[]
  payload?: unknown
  dedupeKey?: string
  expiresAt?: number
  correlationId?: string
  progress?: unknown
}
```

- `eventType` / `kind` 必须落在 manifest `events` 白名单内  
- `dedupeKey`：相同 key 会合并/限流，防刷屏  
- `sticky: true`：不自动消失，靠按钮或关闭结束  

### 6.2 Sticky 与按钮（必读）

| 用户操作 | 卡片应 |
|----------|--------|
| 「续命/更新」类（如 echo、再次 publish 同一 sticky） | **保留**卡片，可更新内容 |
| 完成 / 关闭 / dismiss | **卸掉**卡片 |
| 错误：dismiss 仍 keep，或完成后又 publish 同 sticky | 卡片关不掉 / 透明窗残留 |

Sidecar 在 `resolved` 里若要 echo：可短延迟（约数百毫秒）再 `publish`；dismiss **不要**再发同 sticky。

---

## 7. 端到端数据流

### background 发 Toast

```
background → plugin.events.publish
  → 宿主校验 events 白名单
  → Toast 加载 ui.mjs
  → 用户 action → 可选回传 sidecar
```

### sidecar 发 Toast + 设置里 RPC

```
settings: plugin.config.set + plugin.sidecar.request('setConfig', cfg)
sidecar: response 同一 requestId
sidecar: 设备变化 → op publish
Toast 按钮 → resolved → sidecar 执行（如启动应用）
```

---

## 8. 推荐制作流程

1. 写清触发条件、要不要自定义卡、要不要设置、要不要本机进程  
2. 选定 id（不与保留 kind 冲突）  
3. 按 §1 选架构  
4. 写 manifest，**一次写全** events  
5. 从配套《脚手架模板》拷贝文件并改文案/逻辑  
6. 装入 plugins 目录 → 扫描/重启 → 启用  
7. 自检 §9；测 sticky 的 keep / dismiss  
8. 插件 README 写明用途与「启用即信任」

**禁止：**

- 使用白名单外的 Naive 组件（尤其 `NInputNumber`）  
- settings 根再包一层大 padding / max-width  
- `import 'vue'` / `import 'naive-ui'`  
- 模板字符串 SFC  
- 占用保留 kind  
- 把「需要改 Catrace 源码」当成插件方案的一部分  

---

## 9. 检查清单

### Manifest

- [ ] id = 目录名 = `[a-z0-9-]+`  
- [ ] events 覆盖所有 publish 的 type/kind  
- [ ] 无保留 kind  
- [ ] sidecar 在目标机器可执行  

### ui.mjs

- [ ] 只用 `__CATRACE_VUE__` + `h`  
- [ ] props：`event`、`isHovered`；emits：`close`、`action`  
- [ ] `export default` 或 `export const Card`  
- [ ] 样式带插件前缀  

### settings.mjs

- [ ] 根无外层 padding/max-width  
- [ ] 仅 Naive 白名单；数字用 NInput  
- [ ] useMessage 在 setup 内  
- [ ] 用户配置走 `plugin.config`  

### background.mjs

- [ ] 运行时状态用 `plugin.storage`  
- [ ] publish 带合理 `dedupeKey`  

### sidecar

- [ ] 处理 `shutdown`  
- [ ] 处理业务相关 `resolved`  
- [ ] 每个 RPC 都 `op: response` 且 `requestId` 一致  
- [ ] publish 的 kind/type 在 manifest 内  
- [ ] sticky 语义正确  

### 信任

- [ ] README 写明启用 = 信任本地代码（含 sidecar）  
- [ ] 默认不自动启用  
- [ ] 日志避免打印密钥  

---

## 10. 常见问题

| 现象 | 常见原因 | 处理 |
|------|----------|------|
| 组件 undefined / Invalid vnode | 用了未注入组件（如 NInputNumber） | 改 NInput + Number |
| 设置页左右空白过大 | 根节点又写了 padding/max-width | 删掉 |
| 没有 Toast | 未启用；events 漏白名单 | 启用并检查 manifest |
| 连点刷屏 | 无 dedupeKey；乱发 sticky | 加 key、限流 |
| sticky 关不掉 | dismiss 后仍 publish | dismiss 禁止再发 |
| Windows 设备「没连也提示」 | 把「已配对」当成「已连接」 | 查真实连接状态属性，勿仅用 Status=OK |
| 中文乱码（PowerShell） | 控制台代码页 | 用 UTF-8 文件中转再读 |
| sidecar 无响应 | 无 Node/PATH；RPC 未 response | 查进程与协议 |
| 模块加载失败 | bare import | 只用全局注入 |

---

## 11. 不要用外部插件做的事

| 需求 | 说明 |
|------|------|
| 冒充系统久坐等内置 kind | 使用保留 kind 会被拒绝或冲突 |
| 依赖「官方插件商店」分发 | 当前模型是本机目录安装 |
| 要求普通用户改 Catrace 程序本体 | 插件应自包含 |

---

## 12. 配套文件

- 脚手架与完整可拷贝示例：[plugin-file-scaffolds-and-copy-paste-templates.md](plugin-file-scaffolds-and-copy-paste-templates.md)
