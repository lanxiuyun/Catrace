# 插件 ESM 的本地加载边界

WebView 不能可靠地直接动态导入本地 file／asset ESM；Blob 模块也不能解析未打包的 bare package specifier。表现是插件事件到达，但自定义 Card 加载失败。

## 现行路径

1. Rust 校验启用状态并返回源码文本。
2. [loadExternalPlugins.ts](../../src/plugins/loadExternalPlugins.ts) 包装绑定插件 id 的 API，生成 Blob URL 后动态导入。
3. 插件从 `__CATRACE_REACT__` / `__CATRACE_RADIX__` 取得宿主共享运行时，导出 React 组件。
4. 组件形状校验后注册到 zustand，失败清理 Blob 并提供通用卡降级。
5. [PluginHostCard.tsx](../../src/components/PluginHostCard.tsx) 兜底加载时，在读取、执行与缓存前复查 owner／启用／generation，避免停用或卸载后执行迟到源码。

不要仅为了动态 import 打开额外 asset 协议或将 React 打包成另一个运行时实例。完整合同见[外部插件](../architecture/desktop-event-os/m10-external-plugins.md)。
