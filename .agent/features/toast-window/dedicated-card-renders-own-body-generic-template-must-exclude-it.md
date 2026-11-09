# Toast 内容组件边界

[ReminderToast.tsx](../../../src/app/windows/ReminderToast.tsx) 的 `CardContent` 按 kind 选择且只返回一个 React 内容组件。容器负责外壳、入退场、hover、尺寸和原生窗口协作；卡片负责标题、正文、动作与自身布局。

## 新增卡片

1. 在 [toastCard.ts](../../../src/app/windows/toast/toastCard.ts) 定义数据与内置 kind 边界。
2. 独立实现 React 卡片，使用 props 与 callbacks，不把业务 JSX 混入 controller。
3. 在 `CardContent` 增加一个互斥分支；专用组件与通用 SdkToastCard 不应同时输出同一份 header／body／progress／actions。
4. 内容增减时让 ResizeObserver 或显式 resize callback 驱动窗口测量。

外部插件卡由 [PluginHostCard.tsx](../../../src/components/PluginHostCard.tsx) 管理，其 API／渲染失败降级到通用卡。supersede 与原地更新时保持组件身份，避免反复 Blob 导入和窗口动画冲突。
