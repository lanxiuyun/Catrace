# Step 3 路线图：Plugin Runtime

> **计划真源**。覆盖 Desktop Event OS Step 2（Event Core + Signal Core）之后下一阶段：让用户写的插件脚本在应用后台持续运行，并获得受控的桌面能力。

## 0. 阶段定位

Step 2 完成了事件协议、行为感知、外部 Event HTTP（M9）和本地外部插件首版（M10：manifest + Toast Card）。

Step 3 的目标是把插件从「被动渲染 Toast 卡片」升级为「主动后台运行时」。**技术选型：每个插件一个隐藏 WebView 窗口**（复用 Tauri 自带 WebView，零体积增量），插件脚本在窗口里常驻运行，通过 Tauri invoke 调用宿主能力。

```
Step 1  休息提醒核心（legacy）
Step 2  Event Core + Signal Core + M9/M10 外部入口（已完成）
Step 3  Plugin Runtime：隐藏 WebView 窗口跑插件后台脚本，invoke 调宿主能力
Step 4  （未来）跨应用自动化、AI agent 接入、插件市场评估
```

**选型决策（已定）**：不嵌 deno_core、不引入独立 Node 进程、不改 Electron。用 Tauri 原生隐藏 WebView 窗口承载插件后台脚本——Catrace 的 Toast 窗口已是同款技术（`.visible(false)` 预创建隐藏窗口），路径已踩通。

## 1. 目标与边界

### 1.1 是什么

- 用户把插件目录放进 `<app_data>/plugins/<plugin-id>/`，含 `manifest.json` + 脚本 + 可选 UI。
- 应用启动后，对每个启用且声明 `background` 的插件，**创建一个隐藏 WebView 窗口**，加载插件的后台页面，常驻运行。
- 插件后台脚本是标准浏览器 JS：`setInterval` / `fetch` / `WebSocket` / ESM 模块均可用；napcat 等外部服务直接 `WebSocket`/`fetch` 连。
- 插件通过 **Tauri invoke** 调用宿主能力：发通知（publishEvent）、读活跃数据、读写自己的私有存储、剪贴板等。
- 插件可提供 `ui.mjs`（Toast 卡片，走 M10 现有 Blob 加载）和 `settings.mjs`（设置面板）。
- **职责划分**：background = 调度/计时 + 发通知 + 读活跃数据 + 持久化；卡片 = 渲染 + 用户即时交互（复制验证码、调外部 API）。

### 1.2 不是什么

- 不是真 Node：插件后台跑在 WebView（浏览器 JS），无 `require('fs')` / `child_process` / 直接 `npm install`。文件、剪贴板等靠 invoke 补。
- 不做插件市场 / 远程下载 / 自动更新。
- 不做浏览器扩展兼容层。
- 不做无权限沙箱逃逸。

## 2. 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M11** Plugin Background Window | 每插件一个隐藏 WebView 窗口；manifest 扩展 `background`；宿主 invoke 能力（publishEvent、activity 读取、plugin storage、logger）；启停生命周期 | ✅ 真机验收通过 |
| **M11.1** 资源与权限 | 定时器最小间隔 clamp、publish 限流（对齐 HTTP 10/s、5 publish/s）、权限声明 + 运行时门闩 | 📋 规划 |
| **M12** 更多宿主能力 | 打开 URL/应用、读取前台窗口信息、写文件（受限目录）、napcat 类外部服务对接（WebSocket 由插件自己连，宿主不感知） | 📋 规划 |
| **M13** External Settings Surface | 外部插件可注册 `settings.mjs`；Plugins.vue 详情页加载外部设置组件；与 background 共享 storage | 📋 规划 |
| **M14** Built-in plugins migration | 将 timer/water/eye/rest 的定时/通知逻辑逐步迁到插件 runtime 模型 | 🧊 暂缓 |

图例：✅ 完成 · 🔲 进行中 · 📋 规划 · 🧊 暂缓

## 3. 架构：插件后台 = 隐藏 WebView 窗口

### 3.1 模型

```
应用启动
  └─ PluginWindowManager（Rust，src-tauri/src/plugin_window.rs）
       对每个 启用 + manifest.background 的插件：
         创建隐藏 WebView 窗口，label = `plugin-bg-<id>`
         URL 指向插件的 background 页面（见 §3.3 加载策略）
         .visible(false) / .skip_taskbar(true) / 不抢焦点
       插件脚本在窗口里常驻运行
  禁用插件 / 应用退出 → 关闭对应窗口
```

这与 Toast 窗口是同一套技术：`WebviewWindowBuilder` + `.visible(false)`，Catrace 已有完整实现可参照（`reminder_toast.rs`）。

### 3.2 为什么不用独立 Node 进程 / deno_core

| 维度 | 隐藏 WebView 窗口（本方案） | deno_core | 独立 Node 进程 |
|------|---------------------------|-----------|---------------|
| 体积增量 | **0** | +80~150MB | +40MB |
| 与 Toast/UI 技术栈 | **统一**（都在 WebView） | 两个 JS 世界 | 两个 JS 世界 |
| 通信 | Tauri invoke / event（现成） | 手写 op 桥 | HTTP / IPC |
| 后台跑 JS | ✅ | ✅ | ✅ |
| npm 生态 | ❌（ESM CDN 可用） | ❌ | ✅ |
| 新代码量 | 少（窗口管理 + invoke） | 大量 | 中（进程 + IPC） |

对本阶段「卡片写逻辑、后台发通知+读活跃+存数据」的需求，WebView 方案零缺点。

### 3.3 后台页面加载策略

插件的 `background` 入口是个 HTML/JS 页面。两个候选：

| 方案 | 做法 | 问题 |
|------|------|------|
| **A. 每个插件一个独立窗口** | `WebviewUrl::App` 指向插件目录的 html | WebView 加载插件本地文件需 asset protocol / CSP 放行 |
| **B. 单一插件宿主窗口 + Blob 注入** | 一个隐藏窗口加载内置 `plugin-host.html`，用 `get_plugin_ui_source` 同款 Blob 方式注入插件脚本 | 复用 M10 Blob 加载路径，CSP/协议问题已解决 |

**推荐 B**（与 M10 卡片加载同一套 Blob import 机制，避开本地文件协议坑）。一个窗口内可为多个插件分别 `import(blobUrl)` 各自脚本，模块作用域天然隔离；或每插件一个窗口彻底隔离（崩了互不影响，代价是多窗口开销）。**隔离粒度在 M11 实现时定**：先单窗口多插件，出现相互干扰再拆成每插件一窗。

## 4. manifest v2 扩展

```json
{
  "id": "my-timer",
  "name": "我的定时器",
  "version": "0.1.0",
  "description": "用户自定义定时提醒",
  "background": "background.mjs",
  "main": "ui.mjs",
  "settings": "settings.mjs",
  "events": ["my-timer", "kind:my-timer"],
  "permissions": ["notification", "storage", "activity", "logger", "clipboard"],
  "enabledByDefault": false
}
```

| 字段 | 说明 |
|------|------|
| `background` | 后台脚本相对路径，声明则创建后台窗口 |
| `main` | Toast 卡片（M10 已有） |
| `settings` | 设置面板脚本，可选（M13） |
| `permissions` | 宿主能力白名单，未声明的 invoke 调用被拒绝 |

## 5. 宿主能力（invoke 命令集）

插件后台脚本通过 `window.__TAURI__.invoke(...)`（或注入的 `catrace.*` 薄封装）调用。**每个命令在 Rust 侧校验调用方插件身份 + 权限**。

### 5.1 发通知（notification 权限）

```js
await invoke('plugin_publish_event', {
  event_type: 'my-timer.due',
  kind: 'my-timer',
  title: '喝水',
  body: '该喝水了',
  actions: [{ id: 'done', label: '完成' }],
  dedupe_key: 'my-timer:drink'
})
```

- Rust 侧走 `EventBus.publish()`，source = `Plugin { name: <id> }`。
- **进程内也强制 `allows_event` 校验**：`kind`/`event_type` 必须在 manifest `events` 白名单，不得占用 `RESERVED_KINDS`。
- Toast 卡片渲染走 M10 现有链路，无需改。

### 5.2 读活跃数据（activity 权限）

插件要读 Catrace 已有的活跃信息。复用/扩展现有 command：

```js
// 当前是否活跃 + 媒体/全屏快照（复用 get_activity_snapshot 思路）
const snap = await invoke('plugin_get_activity', {})
// → { active: bool, count: number, media_active: bool, fullscreen_active: bool }

// 前台窗口信息（应用名/标题/进程路径，不含坐标/击键）
const win = await invoke('plugin_get_active_window', {})
// → { app_name, title, process_path }
```

- 数据来源：宿主分钟 settle 的 `ActivityState` 快照 + `active_win_pos_rs`（与 Debug 页同源）。
- 只读，不暴露键序列/坐标。

### 5.3 插件私有存储（storage 权限）

per-plugin 隔离 KV，落 SQLite `plugin_storage:<id>:<key>`：

```js
await invoke('plugin_storage_set', { key: 'lastDrinkAt', value: Date.now() })
const v = await invoke('plugin_storage_get', { key: 'lastDrinkAt' })
```

- **与 settings 面板共享同一份**：settings 面板（M13）用同一组 invoke 读写，background 下次 `get` 即读到。
- value 存 JSON 字符串。

### 5.4 日志（logger 权限）

```js
await invoke('plugin_log', { level: 'info', message: 'tick', data: { n: 1 } })
```

统一写进 Catrace 日志文件，带插件 id 前缀。

### 5.5 剪贴板（clipboard 权限）

```js
await invoke('plugin_clipboard_write', { text: '123456' })
const t = await invoke('plugin_clipboard_read', {})
```

- Rust 端 `#[cfg]` 隔离平台；读取返回最近内容，不监听键盘。

## 6. 身份识别与权限门闩

**关键问题**：多个插件的 invoke 都从 WebView 发出，Rust 怎么知道是哪个插件调的？

- Tauri invoke 可从 `WebviewWindow` 拿到调用方窗口 label。
- 插件后台窗口 label = `plugin-bg-<id>`，从 label 解析出 plugin id。
- Toast 卡片 / settings 面板在主窗/Toast 窗，label 不同 → 用另一组 identity（见 §7）。
- Rust 侧每个 `plugin_*` command 先解析窗口 label 得 plugin id，再查 manifest `permissions`，未授权返回 `Err("permission denied: <perm>")`。

## 7. 卡片（ui.mjs）与后台的关系

按已定职责：**background 只发通知 + 读活跃 + 存数据；卡片负责渲染 + 即时交互**。

- **后台 → 卡片**：通过事件 `payload` 单向传数据（publishEvent 时塞进去，卡片 `props.event.payload` 读到）。
- **卡片即时交互**（复制验证码、调外部 API）：卡片跑在 Toast 窗口（WebView），可直接 `fetch` 外部 API，或调剪贴板 invoke。
- **卡片要调宿主能力时**：Toast 窗口 label 不是 `plugin-bg-*`，需另一种身份识别——卡片调 `plugin_*` invoke 时显式传 `plugin_id`（来自 `props.event.source`），Rust 校验该插件确有此权限。
- **不需要 action 回传到后台**：交互在卡片内闭环（点按钮当场调剪贴板/外部 API），后台无需感知。`resolve_event_action` 维持现状（只记生命周期）。

> 若未来出现「按钮点击要改变后台计时状态」的场景，再补一条卡片→后台的轻量通道（如 `plugin_notify_background` invoke + 后台窗口监听 event）。**M11 不做，记为可选增强。**

## 8. 生命周期

- `setup()` 初始化 `PluginWindowManager`；`PluginManager::rescan()` 完成后，对启用 + 声明 `background` 的插件创建后台窗口。
- 禁用插件 → 关闭对应后台窗口。
- **版本升级 / 文件变更**：fingerprint 已含 version+main；检测到 `background.mjs` 变化或版本变化 → 重建该插件后台窗口。手动「刷新」也触发重建。
- 插件脚本抛错 → 捕获写日志，窗口保留（WebView 内 JS 错误不致命）；如需重启策略后续迭代。
- 应用退出 → 统一关闭所有插件窗口。

## 9. M11.1 资源与权限收紧

| 限制 | 策略 |
|------|------|
| 定时器最小间隔 | 宿主侧不强制（WebView 管不了 `setInterval`），但在文档约定 ≥1s；publish 端限流兜底 |
| 单插件 publish 限流 | 对齐 HTTP：≤ 10 req/s、≤ 5 publish/s，超限拒绝 |
| 权限门闩 | 未声明权限的 invoke 一律拒绝 |
| 窗口数量 | 每插件最多 1 个后台窗口 |

## 10. M12 更多宿主能力

| 能力 | invoke | 权限 |
|------|--------|------|
| 打开 URL / 应用 / 路径 | `plugin_open` | `system` |
| 读前台窗口信息 | `plugin_get_active_window`（M11 已有基础） | `activity` |
| 受限写文件（插件自己目录内） | `plugin_write_file` | `file` |
| napcat 类外部服务 | 插件自己 `WebSocket`/`fetch` 连，**宿主不感知** | 无需宿主权限（网络在 WebView 内） |

> QQ/微信快速回复：走 napcat（OneBot 协议，WebSocket/HTTP）。插件后台窗口里直接 `new WebSocket('ws://napcat:3001')` 即可，**不依赖宿主新增能力**。这条线 M12 起一个官方示例插件验证。

## 11. M13 外部设置面板

- manifest 声明 `settings` → 前端 `loadExternalPlugins()` 额外加载 settings 组件（Blob import，同 M10 卡片机制）。
- 组件 contract 与内置 `SettingsComponent` 一致，`globalThis.__CATRACE_VUE__` 提供 Vue API。
- 配置读写用 `plugin_storage_*` invoke（显式传 plugin_id），与 background 共享同一份数据。

### 内置插件外部化策略（timer 试点）

- 保留 Rust `timer_plugin.rs` 兜底，用户数据不丢。
- 提供官方 `catrace-timer` 插件包：background 计时发通知 + settings 面板 + ui 卡片，复刻现有功能。
- 启用官方插件时内置定时器让权（或开关选择「内置/插件」）。M14 再评估 water/eye/rest。

## 12. 实现顺序建议

1. 扩展 `PluginManifestFile` 解析 `background` / `settings` / `permissions`。
2. 新建 `src-tauri/src/plugin_window.rs`：`PluginWindowManager`，创建/销毁插件后台窗口（参照 `reminder_toast.rs` 隐藏窗口模式）。
3. 实现 `plugin_*` invoke 命令集：publishEvent（含进程内 `allows_event` 校验）、activity、storage、log、clipboard；从窗口 label 解析 plugin id + 权限门闩。
4. 后台页面加载：单宿主窗口 `plugin-host.html` + Blob import 插件脚本。
5. 改造 `tools/plugin-demo/demo-timer`：`background.mjs` 用 `setInterval` + `plugin_publish_event` 每 10 秒发通知，`plugin_storage` 记次数。
6. 接入 `setup()`：启动扫描并创建启用插件的后台窗口；禁用关闭；版本变化重建。
7. **M11.1**：publish 限流 + 权限收紧。
8. 手测：启动 → 启用 demo-timer → 每 10 秒收通知 → 卡片点按钮复制验证码 → 禁用后后台停止。
9. M12/M13 按里程碑推进。

## 13. 关键文件规划

| 路径 | 角色 |
|------|------|
| `src-tauri/src/plugin_window.rs` | 插件后台窗口管理器（创建/销毁/重建） |
| `src-tauri/src/plugin_commands.rs` | `plugin_*` invoke 命令集 + 身份解析 + 权限门闩 |
| `src-tauri/src/plugin_storage.rs` | per-plugin KV 存储（SQLite） |
| `src-tauri/src/plugins.rs` | 扩展 manifest 解析；`allows_event` 进程内校验；与窗口管理联动 |
| `src-tauri/src/lib.rs` | `setup()` 接入 PluginWindowManager；注册 invoke |
| `src/plugins/loadExternalPlugins.ts` | 加载 settings 组件（M13） |
| `plugin-host.html`（新增，内置） | 插件后台宿主页面，Blob import 各插件脚本 |
| `tools/plugin-demo/demo-timer/background.mjs` | M11 示例后台脚本 |
| `tools/plugin-demo/demo-timer/settings.mjs` | M13 示例设置面板 |

## 14. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 插件本地文件加载的协议/CSP 坑 | 用单宿主窗口 + Blob import（M10 已验证路径），不直接加载插件本地 html |
| 多插件挤一个窗口相互干扰 | 先单窗口，出问题拆每插件一窗（隔离粒度实现时定） |
| 插件脚本死循环/高 CPU | publish 限流兜底；WebView 级 CPU 超限后续迭代 |
| **隐藏窗口定时器节流** | 见 §14.1，分钟级计时可接受；秒级需在实现时关闭 WebView 节流 |
| 权限滥用（clipboard/file/system） | manifest 显式声明 + Rust 运行时门闩 |
| 进程内 publish 绕过事件白名单 | 复用 `allows_event` 强制校验 |
| 身份伪造（卡片冒充别的插件调 invoke） | 后台窗口 label 解析；卡片显式传 id 且校验事件 source 一致性 |
| 与内置 timer 冲突 | 保留内置兜底，官方插件「让权」开关 |

### 14.1 已知坑：隐藏 WebView 窗口的定时器节流（待验证）

插件后台用 `setInterval` 计时，但 **Chrome 系 WebView 对隐藏/后台页面的 `setInterval` 会节流**（降频到 ~1 分钟一次甚至更低）。现有 Toast 窗口也隐藏但不跑计时，没踩过这个坑。

- **分钟级计时**（如「每 20 分钟提醒喝水」）：节流误差最多 ~1 分钟，**可接受，不用处理**。
- **秒级精确计时**：会受影响，实现时需在插件窗口关闭节流（Tauri/WebView2 有相关配置）。

**待用户确认计时精度需求**；M11 实现时若为秒级，把「关闭插件窗口节流」列入任务。当前 roadmap 默认按分钟级，不阻塞。

## 15. 完成定义

### M11 完成定义

- [x] `demo-timer` 由隐藏 WebView 窗口里的 `background.mjs` 驱动，`setInterval` + `plugin_publish_event` 发通知（真机已确认启用后 10 秒成功弹出 Toast）。
- [x] 插件能读活跃数据（`plugin_get_activity`）、读写私有存储（`plugin_storage_*`）。
- [x] 启用/禁用插件时后台窗口创建/销毁；background 文件元数据或版本变化时重建（真机已确认关闭/重新启用正常）。
- [x] 卡片点按钮能完成即时交互（demo-timer 复制验证码），无需回传后台；Rust 校验 Toast 调用窗口、事件 source、插件启用状态和 `clipboard` 权限（真机已确认复制成功）。
- [x] `cargo check` / `pnpm vue-tsc --noEmit` / `pnpm build` 通过。

### M11.1 完成定义

- [ ] 单插件 publish 限流生效，超限拒绝报错。
- [ ] 未声明权限的 invoke 调用被门闩拒绝。

### M12 完成定义

- [ ] `plugin_open` / 前台窗口信息 / 受限写文件落地。
- [ ] napcat 对接示例插件：WebSocket 收发消息，快速回复链路验证。

### M13 完成定义

- [ ] 外部插件 settings 组件在 Plugins.vue 详情页渲染。
- [ ] settings 面板与 background 共享 storage 互通。
- [ ] 官方 timer 插件覆盖内置定时提醒核心场景，不重复触发。

## 16. 相关文档

- [m10-external-plugins.md](m10-external-plugins.md) — Step 2 外部插件基础（Blob 加载、Card 合同）
- [m9-event-http-api.md](m9-event-http-api.md) — 外部 Event HTTP
- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 上一阶段真源
- [README.md](README.md) — Desktop Event OS 总览
