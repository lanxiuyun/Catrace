# 外部插件卡缓存的重载顺序

主窗与 Toast 是独立 WebView，各有独立 zustand registry 和模块缓存。只更新主窗，或只清普通 Map，都不能确保已挂载的 Toast Card 换成新组件。

## 现行约束

- [pluginHostCardCache.ts](../../src/components/pluginHostCardCache.ts) 按插件 id 缓存 React 组件；清缓存同时增加 generation，通过 useSyncExternalStore 通知订阅者。
- [PluginHostCard.tsx](../../src/components/PluginHostCard.tsx) 同时校验 registry owner、enabled 和 generation；旧加载结果不得写回新 owner 的缓存。
- 重载必须先完成 registry 更新，再刷新存活通知中的 uiUrl，最后增加 generation。反序会让重挂载读到旧 registry。
- 普通内容指纹未变时复用组件，避免在重复事件热路径上 force 导入与撤销活 Blob。

入口与顺序见[模块重载](../features/toast-window/外部插件toast卡热更新-generation缓存与reload顺序.md)。窗口本身没有源码文件监视，不把“保存插件源码”描述成自动热更。
