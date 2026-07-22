# Step 3 路线图：Plugin Runtime

> **计划真源**。覆盖 Desktop Event OS Step 2（Event Core + Signal Core）之后下一阶段：让用户写的插件脚本在应用后台持续运行，并获得受控的桌面能力。

## 0. 阶段定位

Step 2 完成了事件协议、行为感知、外部 Event HTTP（M9）和本地外部插件首版（M10：manifest + Toast Card）。

Step 3 的目标是把插件从「被动渲染 Toast 卡片」升级为「主动后台运行时」：

```
Step 1  休息提醒核心（legacy）
Step 2  Event Core + Signal Core + M9/M10 外部入口（已完成）
Step 3  Plugin Runtime：用户脚本随应用启动、后台运行、调用宿主能力
Step 4  （未来）跨应用自动化、AI agent 接入、插件市场评估
```

## 1. 目标与边界

### 1.1 是什么

- 用户把插件目录放进 `<app_data>/plugins/<plugin-id>/`，含 `manifest.json` + 脚本 + 可选 UI。
- 应用启动后，对已启用插件启动后台 JavaScript runtime。
- 用户在脚本里写 `setInterval`、`catrace.publishEvent(...)`、`catrace.storage.get(...)` 等逻辑。
- 插件可声明权限，宿主按权限注入能力（通知、存储、剪贴板、系统信息等）。
- 插件可提供 `settings.mjs`，在 Plugins.vue 详情页渲染自定义配置面板。

### 1.2 不是什么

- 不做插件市场 / 远程下载 / 自动更新。
- 不做浏览器扩展兼容层。
- 不做无权限沙箱逃逸。
- 本期不做 WASM 插件或多语言 runtime。

## 2. 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M11** Plugin Background Runtime | Rust 侧后台 JS runtime；manifest 扩展 `background`；宿主 API（publishEvent、storage、timer、logger）；示例 `demo-timer` 改由脚本驱动 | 📋 规划 |
| **M12** Permissions & System APIs | 权限声明 + 运行时门闩；剪贴板读写、系统通知、打开 URL/应用、读取当前焦点窗口信息、调用 shell；插件独立错误隔离 | 📋 规划 |
| **M13** External Settings Surface | 外部插件可注册 `settings.mjs`；Plugins.vue 详情页加载外部设置组件；把内置 TimerPlugin 作为首个可外部化的目标保留内置兜底 | 📋 规划 |
| **M14** Built-in plugins migration | 将 timer/water/eye/rest 中的定时/通知逻辑逐步迁到插件 runtime 模型；内置插件变为「默认预装 + 可禁用」 | 🧊 暂缓 |

图例：✅ 完成 · 🔲 进行中 · 📋 规划 · 🧊 暂缓

## 3. M11 详细设计

### 3.1 manifest v2 扩展

```json
{
  "id": "my-timer",
  "name": "我的定时器",
  "version": "0.1.0",
  "description": "用户自定义定时提醒",
  "background": "background.mjs",
  "settings": "settings.mjs",
  "events": ["my-timer", "kind:my-timer"],
  "permissions": ["notification", "storage", "logger"],
  "enabledByDefault": false
}
```

新增字段：

| 字段 | 说明 |
|------|------|
| `background` | 后台脚本相对路径，声明则启动 runtime |
| `settings` | 设置面板脚本，可选 |
| `permissions` | 宿主能力白名单，未声明即使代码调用也拒绝 |

保留字段不变：`id` / `name` / `version` / `description` / `events` / `enabledByDefault`。

### 3.2 后台脚本沙箱

- 每个插件一个独立 JS runtime isolate。
- 选型建议：`deno_core`（V8 + 模块加载 + 快照 + 权限模型成熟）。
- 替代方案：`boa`（纯 Rust，但生态/性能弱）；先以 deno_core 为默认，fallback 论证后再切换。
- 脚本通过 ESM `export default async function bootstrap(catrace) { ... }` 或顶层 await 进入。
- 禁止网络 I/O、文件系统、环境变量；所有能力走宿主注入的 `catrace.*` API。

### 3.3 宿主 API（M11 最小集）

在 `src-tauri/src/plugin_runtime/` 下实现，注入到每个 isolate：

```js
// 事件：向 Bus publish，经 Toast 渲染
await catrace.publishEvent({
  event_type: 'my-timer.due',
  kind: 'my-timer',
  title: '喝水',
  body: '该喝水了',
  actions: [
    { id: 'done', label: '完成' },
    { id: 'snooze', label: '5分钟后再提醒' }
  ],
  dedupe_key: 'my-timer:drink'
})

// 插件私有存储（key-value JSON，隔离 per plugin）
await catrace.storage.set('lastDrinkAt', Date.now())
const v = await catrace.storage.get('lastDrinkAt')

// 定时器
const id = catrace.timers.setInterval(() => { ... }, 60_000)
catrace.timers.clearInterval(id)

// 日志，统一进 Catrace 日志文件
await catrace.log.info('tick', { n: 1 })
await catrace.log.warn(...)
await catrace.log.error(...)
```

### 3.4 生命周期

- 应用在 `setup()` 中初始化 `PluginRuntimeManager`。
- `PluginManager::rescan()` 完成后，对启用且声明 `background` 的插件启动 isolate。
- 禁用插件时停止对应 isolate。
- 插件崩溃/未捕获异常 → 记录日志、停止 isolate、不重启（避免崩溃循环）。
- 应用退出时统一停止所有 isolate。

### 3.5 与现有系统的关系

- 后台脚本 publish 的事件走 `EventBus.publish()`，source = `Plugin { name: plugin_id }`。
- `plugins.rs` 的 `allows_event()` 仍负责校验插件是否有权声明该 kind/event_type。
- 前端 Toast 已经能渲染 plugin 来源事件，无需为 M11 改 Toast 渲染链路。
- 分钟 tick 调度由插件自己的 `setInterval` 替代；内置 `timer_plugin` 暂时保留，M14 再考虑迁移。

## 4. M12 权限与系统能力

### 4.1 权限模型

`permissions` 数组声明，宿主在创建 isolate 时按权限注入 API 子集：

| 权限 | 能力 |
|------|------|
| `notification` | `catrace.publishEvent`（已默认需要 events 声明） |
| `storage` | `catrace.storage.get/set/delete/keys` |
| `logger` | `catrace.log.*` |
| `clipboard` | `catrace.clipboard.readText()` / `writeText(text)` |
| `system` | `catrace.system.getActiveWindowInfo()` / `openUrl(url)` / `openPath(path)` |
| `shell` | `catrace.shell.run(command, args, options)`（高敏感，默认不提供） |

### 4.2 调用系统能力时的安全策略

- 所有系统 API 在 Rust 端用 `#[cfg]` 隔离平台差异，缺失时返回 `Err("unsupported")`。
- `shell` 权限单独显式开启，默认禁用。
- 剪贴板读取返回最近一次内容，不监听键盘。
- 焦点窗口信息只返回应用名、标题、进程路径（与现有 Debug 页一致），不返回坐标/击键。

### 4.3 错误隔离

- 单个插件 isolate panic/uncaught error 不拖垮其他插件。
- 连续多次崩溃后进入冷却，下次启动间隔递增。

## 5. M13 外部设置面板

### 5.1 注册方式

manifest 声明 `settings` 后，前端 `loadExternalPlugins()` 额外加载 settings 组件：

- Rust 提供 `get_plugin_settings_source(id)`。
- 前端用 Blob URL 动态 import，组件 contract 与内置 `SettingsComponent` 一致。
- 外部设置组件通过 `globalThis.__CATRACE_VUE__` 访问 Vue API，禁止 `import 'vue'`。

### 5.2 设置组件 contract

```js
const { h, ref, computed, watch } = globalThis.__CATRACE_VUE__

export default {
  name: 'MyTimerSettings',
  props: {
    manifest: Object,        // 插件 manifest
    pluginId: String,
  },
  emits: ['change'],         // 可选：通知宿主配置已变更
  setup(props, { emit }) {
    // 通过 catrace.storage 读写配置（需 storage 权限）
    // 通过 invoke 调用 runtime 命令
    return () => h('div', ...)
  }
}
```

### 5.3 内置插件外部化策略

以 `timer` 为试点：

- 保留 Rust `timer_plugin.rs` 作为内置兜底，确保现有用户数据不丢。
- 提供一个官方 `catrace-timer` 插件包，用 background script + settings panel 复刻当前功能。
- 当用户启用官方插件时，内置定时器自动让权（或提供开关选择「内置/插件」）。

M14 再评估是否把 water/eye/rest 也走同样路径。

## 6. 实现顺序建议

1. 在 `src-tauri/src/plugin_runtime/` 创建 `PluginRuntimeManager` 骨架（deno_core 选型 + Cargo 依赖）。
2. 扩展 `PluginManifestFile` 解析 `background` / `settings` / `permissions`。
3. 实现最小宿主 API：`publishEvent` + `storage` + `timers` + `logger`。
4. 改造 `tools/plugin-demo/demo-timer`：用 `background.mjs` 每分钟 publish 一次事件，UI 仍用现有 Card。
5. 接入 `setup()`：启动时扫描并启动已启用插件的 background runtime。
6. 手测：启动 → 启用 demo-timer → 每分钟收到通知 → 禁用后停止。
7. M12/M13 按里程碑分别推进。

## 7. 关键文件规划

| 路径 | 角色 |
|------|------|
| `src-tauri/src/plugin_runtime/mod.rs` | runtime manager、isolate 生命周期 |
| `src-tauri/src/plugin_runtime/permissions.rs` | 权限声明与校验 |
| `src-tauri/src/plugin_runtime/host_api.rs` | `catrace.*` 宿主 API 注入 |
| `src-tauri/src/plugin_runtime/deno_runtime.rs` | deno_core 封装（若选型确定） |
| `src-tauri/src/plugins.rs` | 扩展 manifest 解析；与 runtime 联动启停 |
| `src/plugins/loadExternalPlugins.ts` | 加载外部 settings 组件 |
| `tools/plugin-demo/demo-timer/background.mjs` | M11 示例后台脚本 |
| `tools/plugin-demo/demo-timer/settings.mjs` | M13 示例设置面板 |

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| deno_core 增加二进制体积 | 评估后决定；必要时 feature-gate |
| 用户脚本死循环/高 CPU | isolate 单线程 + 可中断的 timer；未来加 CPU 阈值 |
| 权限滥用（如 shell） | 默认关闭、显式声明、无提权操作 |
| 插件崩溃导致总线异常 | 错误隔离，单插件失败不波及其他 |
| 与内置 timer 冲突 | 保留内置兜底，官方插件提供「让权」开关 |

## 9. 完成定义

### M11 完成定义

- [ ] `demo-timer` 完全由 `background.mjs` 驱动，不依赖外部 HTTP 发事件。
- [ ] 启用/禁用插件时 background runtime 正确启动/停止。
- [ ] 宿主 API `publishEvent` / `storage` / `timers` / `logger` 可用。
- [ ] 插件崩溃只影响自己，应用核心功能不受影响。
- [ ] `cargo check` / `pnpm vue-tsc --noEmit` 通过。

### M12 完成定义

- [ ] 权限模型落地，未声明权限调用返回明确错误。
- [ ] `clipboard` / `system` / `shell` 至少实现剪贴板和系统信息。
- [ ] 平台差异用 `#[cfg]` 隔离，非目标平台返回友好错误。

### M13 完成定义

- [ ] 外部插件 settings 组件能在 Plugins.vue 详情页渲染。
- [ ] 提供官方 timer 插件示例，功能覆盖当前内置定时提醒核心场景。
- [ ] 内置 timer 与外部 timer 不重复触发。

## 10. 相关文档

- [m10-external-plugins.md](m10-external-plugins.md) — Step 2 外部插件基础
- [m9-event-http-api.md](m9-event-http-api.md) — 外部 Event HTTP
- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 上一阶段真源
- [README.md](README.md) — Desktop Event OS 总览
