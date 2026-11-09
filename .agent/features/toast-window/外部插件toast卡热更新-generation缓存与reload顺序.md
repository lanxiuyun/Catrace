# 外部插件 Toast 卡缓存与重载

每个 WebView 有独立 Pinia registry 与模块级卡片缓存，主窗更新不能直接替代 Toast 窗更新。

## generation

[pluginHostCardCache.ts](../../../src/components/pluginHostCardCache.ts) 按插件 id 缓存异步组件，避免 supersede / upsert 时反复导入。清理 Map 不会自动替换已挂载的组件，因此 `clearPluginHostCardCache()` 同时增加响应式 generation，驱动 [PluginHostCard.vue](../../../src/components/PluginHostCard.vue) 重新解析组件。

## 重载入口

- [bootstrap.ts](../../../src/app/bootstrap.ts) 监听后端 `plugins-reloaded` / `plugin-enabled-changed`：先 `loadExternalPlugins({ force: true })` 更新当前窗口 registry，再清卡片缓存。
- [ReminderToast.vue](../../../src/views/toastWindows/ReminderToast.vue) 还监听显式 `catrace:reload-external-plugins`：先 force load，再更新存活通知的 uiUrl，最后增加 generation。
- 当前 React 插件中心刷新仅重读本机 / 远程目录，不发送上述显式重载事件。没有插件脚本文件监视，编辑文件不会自动广播重载。

## 必须保持的顺序

1. 加载最新源码并完成 registry 更新。
2. 如入口负责存活通知，更新其中的插件 uiUrl。
3. 清缓存并递增 generation，让已挂载卡解析新组件。

禁止先清缓存再加载，否则 remount 可能拿到旧 registry。普通加载用内容指纹跳过无变化重建，生命周期重载才强制刷新。

相关：[插件中心](../plugin-center/README.md) · [外部模块合同](../../architecture/desktop-event-os/m10-external-plugins.md)。
