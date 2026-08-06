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
  `rest|water|agent|permission|update|rest-timer|sdk`
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
- **禁止** `import 'vue'` / `import 'naive-ui'`（asset/blob 模块解析不到 bare specifier）
- 使用宿主注入的 globals（见 `src/plugins/pluginRuntime.ts` 的 `ensurePluginRuntime()`）：
  - `globalThis.__CATRACE_VUE__` — `h` / `ref` / `computed` / `watch` / `markRaw` / lifecycle
  - `globalThis.__CATRACE_NAIVE__` — 精选 naive-ui（`NButton`/`NInput`/`NSwitch`/`NTag`/`NTooltip`/`NModal`/`NPopconfirm`/…）+ `useMessage` / `useDialog`（**须在 `setup()` 内调用**）
  - `globalThis.__CATRACE_UI__` — 主机设置积木 `SettingRow` / `SliderControl`（可选；复杂表单不一定要用）
- 插件 UI 不应依赖内部 Pinia；副作用只走 emit / `invoke`
- naive-ui 已挂在 App 的 `NConfigProvider` 下，主题自动继承；**toast 窗同样注入**（`PluginHostCard` 与 `loadExternalPlugins` 共用 `ensurePluginRuntime`）

```js
// settings.mjs / ui.mjs — naive-ui via host
const { h, ref } = globalThis.__CATRACE_VUE__
const { NButton, NSwitch, useMessage } = globalThis.__CATRACE_NAIVE__

export default {
  setup() {
    const msg = useMessage()
    const on = ref(true)
    return () =>
      h(NSwitch, {
        value: on.value,
        'onUpdate:value': (v) => {
          on.value = v
          msg.success('已保存')
        },
      })
  },
}
```

### NModal / teleport 样式陷阱（必读）

`NModal`（以及部分 popup）会 **teleport 到 `body`**，不在插件根节点 `.timer-settings` 子树里。

| 错 | 对 |
|----|----|
| CSS 写 `.timer-settings .modal-body { … }` | 给 Modal 设 `class: 'timer-modal'`，样式写 `.timer-modal .tm-body { … }` |
| 依赖插件根继承的字号/颜色 | 弹层样式自包含，或挂在 teleport 目标 class 上 |
| 弹层里再叠一层原生 `overflow` 滚动条凑合 | 优先避免长弹层；或用 `NScrollbar` 且样式挂在 modal class |

**产品偏好（timer 已落地）**：复杂规则编辑 **优先卡片内联展开**，不要 `NModal`。理由：

1. 样式不会因 teleport 失效  
2. 列表上下文不丢，可对照其它规则  
3. 无双轴原生滚动条问题  
4. 与「一条提醒一张卡」信息架构一致

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

本地插件 ≈ VS Code 本地扩展：代码默认跑在应用 WebView。声明 `sidecar` 的插件还会启动本机子进程（node/exe 等），等同执行本机代码。**仅安装信任的来源。**
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


## Settings 与 background（M10.1）

可选 manifest 字段：

```json
{
  "background": "background.mjs",
  "settings": "settings.mjs"
}
```

| 能力 | 说明 |
|------|------|
| `get_plugin_settings_source(id)` | 主窗读 settings ESM 文本 → Blob import |
| `get_plugin_config` / `set_plugin_config` | 主窗按已安装 id 读写整包 `plugin_config:{id}` |
| `plugin_config_get_all` | bg 窗读整包 config（caller-bound） |
| resolve 回传 | Bus resolve Plugin 源事件 → emit `catrace:plugin-event-resolved` 到 `plugin-bg-{id}`；PluginHost 再 `CustomEvent` 转给 background.mjs |
| 第一方示例 | `tools/plugin-demo/timer`（原内置定时提醒） |

- settings 组件同样走 `__CATRACE_VUE__`（含 `onMounted` / `onBeforeUnmount`）；export `default` / `Settings` / `settings`；`settingsSurface: plugins`
- **禁用时也加载 settings**：Plugins 页要能看配置；Toast 卡仅 enabled 时加载
- header 开关 = `set_external_plugin_enabled`；规则调度另看 config/rules
- Toast action 副作用在 bg 处理，宿主只 `resolve_event_action`

### settings.mjs 布局合同（与内置面板对齐）

Plugins 页挂载路径（内置 / 外部相同）：

```text
Plugins.vue
└── .plugin-detail          ← 唯一内容外壳：max-width 64rem、居中、padding、section gap
    └── SettingsComponent   ← 只出业务 UI
```

宿主 `.plugin-detail`（权威值，改宿主时同步文档）：

```css
/* 宽屏 */
padding: 1.5rem 2rem 2rem;
max-width: 64rem;
gap: 1.25rem;
/* 窄屏 ≤56.25rem */
padding: 1.25rem;
```

| 该做 | 不该做 |
|------|--------|
| 根节点 `width: 100%` + 业务样式 | 根上再写外层 `padding` / `max-width: 64rem` / 水平居中 |
| 卡片、列表、控件内部的间距 | `@media` 里给 settings 根补一层与宿主相同的 padding（窄屏会**双倍缩进**） |
| 需要全宽装饰时在业务层局部覆盖 | 再包 layout shell / 自建详情顶栏总开关 |

参考实现：`tools/plugin-demo/timer/settings.mjs` 注释写明边距归宿主；根 `.timer-settings` 无外 padding。曾误留窄屏 `@media { .timer-settings { padding: 1.25rem } }`，与宿主叠加后外部插件比内置「多一圈边距」——已删，作为反例。

布局真源：[[plugin-center]] [插件详情内容区外壳收归宿主](../../features/plugin-center/插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md) · [[app-shell]] 插件页布局约定。

### 宿主 runtime 注入点

| 入口 | 文件 |
|------|------|
| 主窗 / 插件页加载 | `src/plugins/loadExternalPlugins.ts` → `ensurePluginRuntime()` |
| Toast 卡兜底加载 | `src/components/PluginHostCard.vue` → `ensurePluginRuntime()` |
| 实现 | `src/plugins/pluginRuntime.ts` |
| 类型 | `src/vite-env.d.ts` 声明三个 global |
