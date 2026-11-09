# 外部插件加载与 UI 合同

外部插件由[插件中心](../../features/plugin-center/README.md)按仓库固定 commit 安装到 `<app_data_dir>/plugins/<id>/`。安装后默认停用；用户打开启用开关即信任插件代码，包含 WebView 模块与可选本机 sidecar。未启用时不导入 UI / settings，也不启动后台。

## 插件包与身份

插件目录名必须等于 `manifest.id`，id 使用小写字母、数字与连字符。清单解析、路径边界与启用检查以 [plugins.rs](../../../src-tauri/src/plugins.rs) 为准。

```text
<app_data_dir>/plugins/<id>/
  manifest.json
  ui.mjs                 # 可选 Toast 卡
  settings.mjs           # 可选设置面板
  background.mjs         # 可选，需要 DOM 的后台逻辑
  runtime/main.mjs        # 可选 sidecar
  assets/
```

- `main` / `settings` / `background` 是插件目录内的相对路径，不能逃逸到目录之外。
- 保留 kind 为 `rest|agent|permission|update|rest-timer|sdk`，外部插件不能冒用。
- 用户配置走 Store；运行数据走 SQLite 的 per-plugin storage。见[配置与运行数据边界](插件配置和运行数据必须分开存储.md)。
- 插件开发与业务实现维护在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)，开发流程见其 [README](https://github.com/lanxiuyun/catrace-plugin/blob/main/README.md) / [SKILL](https://github.com/lanxiuyun/catrace-plugin/blob/main/SKILL.md)。

## UI 模块合同

UI / settings 是预编译 ESM，导出 Vue render 组件。不要使用 template 字符串：生产运行时不含模板编译器。

```js
const { h } = globalThis.__CATRACE_VUE__
export default {
  props: { event: Object, isHovered: Boolean },
  emits: ['close', 'action'],
  render() { return h('div', this.event.title) },
}
```

Card 可导出 `default` / `Card` / `card`；设置面板可导出 `default` / `Settings` / `settings`。

宿主在 [pluginRuntime.ts](../../../src/plugins/pluginRuntime.ts) 注入：

| 全局变量 | 能力 |
|---|---|
| `__CATRACE_VUE__` | Vue render / 响应式 / 生命周期 |
| `__CATRACE_NAIVE__` | naive-ui 组件及 `useMessage` / `useDialog` |
| `__CATRACE_UI__` | 设置积木 `SettingRow` / `SliderControl` |
| `__CATRACE_CREATE_PLUGIN_API__` | 按插件 id 绑定的 `plugin` API |

不要在 Blob 模块中使用 `import 'vue'` / `import 'naive-ui'` 等 bare specifier。`useMessage` / `useDialog` 在 `setup()` 内调用，provider 由 [vueRuntime.ts](../../../src/app/legacy/vueRuntime.ts) 提供。

## 加载链路

1. Rust 读取已启用插件源码。
2. [loadExternalPlugins.ts](../../../src/plugins/loadExternalPlugins.ts) 包装绑定身份的 API，经 Blob URL 动态导入，再以 `markRaw` 注册到 Pinia registry。
3. React 插件详情通过 [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) → VueIsland 挂载设置；Toast 通过 [PluginHostCard.vue](../../../src/components/PluginHostCard.vue) 挂载 Card。
4. 加载请求 single-flight；内容指纹未变化时复用组件。停用、卸载与失败时清理组件和 Blob URL。
5. 后端持久化完成后发送 `plugins-reloaded` / `plugin-enabled-changed`；各窗口更新注册表与卡片缓存。

不要对 `file://` 或 `asset://` URL 直接动态 import。Blob URL 按插件缓存，不按 Event id 反复创建。

## 设置面板布局

宿主拥有详情导航、标题、总开关、内容列宽和页面边距。插件只输出业务卡片与卡片内部间距，不再添加根级 padding / max-width / 详情顶栏。

当前结构与尺寸见[插件详情内容区边界](../../features/plugin-center/插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md)。naive-ui 的 Modal / popup 可 teleport 到 body；浮层样式应自包含，不依赖插件根节点选择器。

## 事件与动作

- HTTP：`POST http://127.0.0.1:23457/v1/events`，Bearer 认证。有 `plugin_id` 时校验安装、启用、事件声明和保留 kind；无 `plugin_id` 时走 SDK 源。详见 [Event HTTP](m9-event-http-api.md)。
- Card 接收完整 BusEvent；`close` 对应 dismiss，`action(actionId)` 对应宿主 resolve；业务副作用由插件后台 / sidecar 处理。
- 同 `dedupe_key` 产生 superseded 时，Toast 保留可见卡，等待后续 active 原地 upsert，避免 remove + add 导致重挂载。
- `plugin.i18n.getLocale()` 读取宿主语言；不要用 HTML 的 lang 判断卡片按钮文案。

后台身份、能力与动作回传见[sidecar 协议](plugin-native-sidecar-runtime.md)。宿主强制身份、启用状态、事件所有权和 storage namespace 隔离；不做逐项权限弹窗。

## 修改入口

- 清单、启停与本机扫描：[plugins.rs](../../../src-tauri/src/plugins.rs)
- 仓库目录与 pinned commit 安装：[plugin_repository.rs](../../../src-tauri/src/plugin_repository.rs)
- 后台 WebView 生命周期：[plugin_window.rs](../../../src-tauri/src/plugin_window.rs)
- 前端模块加载：[loadExternalPlugins.ts](../../../src/plugins/loadExternalPlugins.ts)
- 插件中心 UI 与操作：[PluginCenter.tsx](../../../src/app/pages/plugins/PluginCenter.tsx) / [usePluginCatalog.ts](../../../src/app/pages/plugins/usePluginCatalog.ts)
- Toast 缓存与热更：[热更新约定](../../features/toast-window/外部插件toast卡热更新-generation缓存与reload顺序.md)

安装、卸载、插件源和启用交互以[插件中心](../../features/plugin-center/README.md)为真源。
