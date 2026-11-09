# 外部插件加载与 React UI 合同

插件中心按仓库固定 commit 安装到 `<app_data_dir>/plugins/<id>/`。安装默认停用；启用即信任插件本地代码，含 React 模块与可选本机 sidecar。未启用时不导入 UI／settings、不启动后台。

## 包与身份

清单解析、id、入口与路径限制以 [plugins.rs](../../../src-tauri/src/plugins.rs) 为准。目录名等于 manifest id，入口必须在插件目录内。用户配置存 Store，运行数据存 per-plugin SQLite KV，见[存储边界](插件配置和运行数据必须分开存储.md)。

```text
<app_data_dir>/plugins/<id>/
  manifest.json
  ui.mjs                 # 可选 React Card
  settings.mjs           # 可选 React Settings
  background.mjs         # 可选普通 ESM 后台副作用
  runtime/main.mjs        # 可选本机 sidecar
  assets/
```

## 组件合同

UI 与设置是预编译 ESM，导出 React 组件。Blob 模块使用宿主共享实例，不直接 import bare package：

```js
const React = globalThis.__CATRACE_REACT__
const { Button } = globalThis.__CATRACE_RADIX__
export default function Card({ event, onClose, onAction }) {
  return React.createElement('section', null,
    React.createElement('strong', null, event.title),
    React.createElement(Button, { onClick: () => onAction?.('done') }, '完成'),
    React.createElement(Button, { onClick: onClose }, '关闭'))
}
```

[pluginRuntime.ts](../../../src/plugins/pluginRuntime.ts) 注入 `__CATRACE_REACT__`、`__CATRACE_RADIX__` 与 `__CATRACE_CREATE_PLUGIN_API__`。源码 wrapper 为模块绑定本插件 `plugin` facade。

- Card 可导出 `default` / `Card` / `card`；设置可导出 `default` / `Settings` / `settings`。
- [PluginCardProps](../../../src/stores/pluginRegistry.ts) 包含 `event`、`isHovered`、`remainingMs`、`totalMs`、`onClose`、`onAction(actionId, payload?)`；SettingsComponent 是普通 React ComponentType。
- 组件使用 props callbacks，而非自建宿主事件监听来关闭／操作卡片；业务动作由插件后台／sidecar 完成。
- 后台 ESM 只执行模块副作用，宿主不虚构 start／cleanup 导出；后台窗口销毁结束其资源寿命。

## 加载与状态

1. Rust 仅读取已启用插件的执行源码。
2. [loadExternalPlugins.ts](../../../src/plugins/loadExternalPlugins.ts) 经 Blob URL 导入，通过组件形状校验后注册到 zustand [pluginRegistry](../../../src/stores/pluginRegistry.ts)。框架外调用 `.getState()`。
3. [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) 直接挂 React 设置并处理加载／渲染错误；[PluginHostCard.tsx](../../../src/components/PluginHostCard.tsx) 挂 Card，按 owner 与 generation 阻止停用／卸载后的迟到加载，错误降级通用卡。
4. 加载请求 single-flight；指纹未变复用组件，停用／卸载／失败清理组件与 Blob URL。
5. 后端持久化后广播 `plugins-reloaded`／`plugin-enabled-changed`；各 WebView 分别重载 registry 与卡片缓存。

模块不要直接 import file／asset URL。卡片缓存按插件 id 与 generation，不随 Event id／revision 反复重挂载。详情外壳、总开关与边距由宿主提供；插件只输出业务 UI。Portal 浮层样式自包含，见[详情边界](../../features/plugin-center/插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md)。

## 事件与能力

外部 HTTP 使用 :23457 Bearer API，校验 source、kind 和事件声明，见 [Event API](m9-event-http-api.md)。Card 收完整 BusEvent；close 对应 dismiss，action 对应生命周期 resolve。superseded 保留可见卡，后续 active 按 id／dedupe key 原地更新。

后台 WebView 身份由 `plugin-bg-<id>` label 推导；sidecar 身份由 manager 推导。宿主强制启用、事件所有权与 storage namespace 边界，不做逐项权限弹窗。完整能力见[宿主 API](外部插件-settings调用宿主桌面能力-demo.md)与[sidecar 协议](plugin-native-sidecar-runtime.md)。

插件业务、开发范本和插件知识维护在 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)；安装与来源规则以[插件中心](../../features/plugin-center/README.md)为准。
