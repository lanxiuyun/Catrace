# M10 外部插件（本地加载 + 自定义 Toast 卡）

> 状态：**首版已手测通过**（manifest + Card 注册 + HTTP `plugin_id` + Plugins 页测试按钮）。**不做插件市场。**

## 目标

用户把插件包装进本机目录 → 应用发现 `manifest.json` → Toast 渲染插件自定义卡；事件经 Bus，生命周期由宿主 resolve。

## 目录布局

```
<app_data_dir>/plugins/<plugin-id>/
  manifest.json
  ui.mjs                 # 预编译 ESM（可选）
```

`plugin-id` 必须与目录名、`manifest.id` 一致，字符集 `[a-z0-9-]+`。

### manifest v1

```json
{
  "id": "demo-timer",
  "name": "Demo Timer",
  "version": "0.1.0",
  "description": "...",
  "main": "ui.mjs",
  "events": ["demo-timer", "kind:demo-timer", "demo-timer.tick"],
  "enabledByDefault": true
}
```

- `events`：允许的 `event_type` / `kind` / `kind:xxx`；**不得**占用保留 kind：
  `rest|water|eye|agent|permission|update|rest-timer|sdk`
- `main`：相对路径，必须在插件目录内（防 path escape）
- 无 `main`：事件可降级 `SdkToastCard`

## Card 合同（硬约束）

```js
// ui.mjs — 必须用 render/h，不要用 template 字符串（生产无 runtime compiler）
const { h } = globalThis.__CATRACE_VUE__
export default {
  props: { event: Object, isHovered: Boolean },
  emits: ['close', 'action'],
  render() { return h('div', …) }
}
// 或 export const Card = { … }
```

- 宿主传入完整 `BusEvent`
- `close` → dismiss + `resolve(dismissed)`
- `action(actionId)` → `resolve_event_action`
- **禁止** `import 'vue'`（asset/blob 模块解析不到 bare specifier）
- 使用宿主注入的 `globalThis.__CATRACE_VUE__`（`h` / `ref` / `computed` / `watch` / `markRaw`）
- 插件 UI 不应依赖内部 Pinia；副作用只走 emit

## UI 加载策略（手测踩坑后定稿）

**不要**对 `file://` / `convertFileSrc(asset://)` 做 `import()` —— Tauri WebView 下会失败（async component loader unhandled error）。

正确路径：

1. Rust `get_plugin_ui_source(id)` 读 `ui.mjs` 文本（≤512KiB）
2. 前端 `Blob` + `URL.createObjectURL` → `import(blobUrl)`
3. 组件 `markRaw` 后写入 `pluginRegistry`（防 Pinia deep reactive 警告）
4. Toast 窗 `onMounted` **先** `await loadExternalPlugins()` 再 listen bus
5. `PluginHostCard` 按 **plugin id 缓存**组件；勿用 event id 当 `:key` / cardKey
6. `loadExternalPlugins`：single-flight；enabled fingerprint 未变跳过重建；刷新/开关才 `force`

## Toast 与 dedupe / supersede（连点必读）

同 `dedupe_key` 再次 publish 时 Bus 会：`resolve(Superseded)` 旧事件 → 再 publish **新 id**。

| 规则 | 说明 |
|------|------|
| `resolution.kind === 'superseded'` | Toast **不要**卸载可见卡；等后续 active 原地 upsert |
| sdk / plugin 路径 | 同 `eventId` **或** 同 `dedupe_key` → 改字段，禁止 remove+add |
| Plugins「测试通知」 | 只 `publishEvent` + 1s 限流；**禁止**每次 `loadExternalPlugins` |
| 热路径 | 禁止 revoke 仍被显示卡引用的 Blob URL |

踩坑详见：[[bugs]] `2026-07-21-插件测试连点卡死-toast-supersede卸载与blob重挂载.md`

## 事件入口

### HTTP（脚本）

`POST http://127.0.0.1:23457/v1/events`（Bearer，与 M9 相同）

| 字段 | 行为 |
|------|------|
| 无 `plugin_id` | M9：`source=Sdk`, `kind=sdk` |
| 有 `plugin_id` | 校验已安装+enabled+events；`source=Plugin{name}`；自定义 `kind`；`display_mode=toast` |

list/get/patch/resolve 允许 `Sdk | Plugin` 源。

### 进程内（Plugins 页测试按钮）

`publish_event` invoke：`source: { type: 'plugin', name }` + `kind: <id>` + 稳定 `dedupe_key`（如 `<id>.test`）。
`BusEvent.id` 有 `#[serde(default)]`，可空，由 bus 填 UUID。
连点应表现为**同一张卡刷新**，不是叠多张、更不能卡死。

## 宿主链路

| 层 | 位置 |
|----|------|
| 扫描 / 启用 | `src-tauri/src/plugins.rs`；DB `external_plugin_enabled:<id>` |
| UI 源码 | `get_plugin_ui_source` / `get_plugin_ui_url` |
| HTTP | `event_http.rs` + `PluginManager` |
| 前端加载 | `src/plugins/loadExternalPlugins.ts`（主窗 + toast 窗） |
| Registry | `pluginRegistry`：`external` / `unregister` / `markRaw` |
| Toast | `ReminderToast` → `PluginHostCard` |
| Plugins 页 | 内置 allowlist + 外部列表 / 开关 / **发送测试通知** / 打开目录 |

## 信任模型

本地插件 ≈ VS Code 本地扩展：代码跑在应用 WebView。**仅安装信任的包。**
首版：保留 kind 拒绝 + enable 门闩 + 无远程 `main`。
M10.2 可选：iframe sandbox、invoke ACL。

## 手测清单（已过）

1. ✅ 拷贝 `tools/plugin-demo/demo-timer` → plugins 目录 → 刷新 → 启用
2. ✅ Plugins 页 **发送测试通知** → 青绿 DEMO 徽章自定义卡
3. 点 Done → 事件 resolved、卡消失
4. 禁用插件 → HTTP publish 403
5. `kind=agent` + `plugin_id` → 403
6. 无 `plugin_id` 的 M9 sdk 路径仍可用

## Demo

见 [`tools/plugin-demo/README.md`](../../../tools/plugin-demo/README.md)。


## Dev 自动 link（debug only）

开发时不必每次拷贝 demo 插件。`initial_scan` 在 **debug 构建**下会先跑 `ensure_dev_plugin_links`：

| 项 | 说明 |
|----|------|
| 源 | 仓库 `tools/plugin-demo/<id>/`（须含 `manifest.json`） |
| 目标 | `app_data/plugins/<id>` |
| Windows | `mklink /J` junction（无管理员）；失败再尝试 symlink |
| Unix | symlink |
| 已正确指向源 | 跳过 |
| 目标已是实目录/其他链接 | **不覆盖** |
| release | 整段编译剔除 |

实现：`src-tauri/src/plugins.rs`。

手测可改为：debug 启动 → Plugins 刷新 → 见 demo-timer → 启用。仍可用手动 junction：

```bat
mklink /J "%APPDATA%\com.lanxiuyun.catrace\plugins\demo-timer" "C:\work_sapce\Catrace\tools\plugin-demo\demo-timer"
```

## 相关

- 踩坑：[[bugs]] `2026-07-20-插件ui动态import-file-asset失败改blob加载.md`
- 决策：[[decisions]] 不做插件市场
- 路线图：[[desktop-event-os]] step2 M10
