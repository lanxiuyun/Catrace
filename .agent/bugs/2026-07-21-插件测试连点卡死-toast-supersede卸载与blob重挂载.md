# 插件重复事件的 supersede 与动态组件身份

同 dedupe key 重新 publish 时，Bus 先 resolve 旧事件为 superseded，再发送新 active。若 Toast 把所有 resolved 都卸卡，会在极短时间里串起离场动画、Blob 组件重挂载和原生窗口缩放，透明 WebView 容易卡死。

## 现行约束

- [busEvents.ts](../../src/app/windows/toast/busEvents.ts) 对 superseded 保留卡，随后同 event id／dedupe key 的 active 原地更新数据。
- [PluginHostCard.tsx](../../src/components/PluginHostCard.tsx) 缓存按插件 owner／generation，而不是 Event id／revision。
- [loadExternalPlugins.ts](../../src/plugins/loadExternalPlugins.ts) single-flight；指纹不变复用组件，事件热路径不无条件 force 重载或撤销活 Blob。
- 明确生命周期重载先换 registry，再增加卡片 generation；停用与卸载必须阻止迟到源码执行和缓存写入。

事件字段与内容应更新，但组件身份和窗口尺寸调度保持稳定。原生并发问题见[窗口 show／resize](2026-07-20-久坐测试连点卡死-toast-窗口并发show与resize.md)，源码加载边界见[Blob 合同](2026-07-20-插件ui动态import-file-asset失败改blob加载.md)。
