# Toast 提醒窗口

独立透明 WebView 内使用 React 卡片实现右下角通知堆叠。内容只来自 Event Bus；Rust 负责原生窗口创建、定位、显示与生命周期，主窗 Hub 只观察，不显示第二份卡片。

## 实现入口

| 职责 | 文件 |
|---|---|
| React 卡片栈与互斥内容分支 | [ReminderToast.tsx](../../../src/app/windows/ReminderToast.tsx) |
| 挂载、销毁、动作、反馈 | [controller.ts](../../../src/app/windows/toast/controller.ts) |
| 事件订阅、水合、upsert、resolve | [busEvents.ts](../../../src/app/windows/toast/busEvents.ts) |
| 数据、kind、自动隐藏和外壳解析 | [toastCard.ts](../../../src/app/windows/toast/toastCard.ts) |
| 计时／hover、尺寸、滚动、激活 | [toast/](../../../src/app/windows/toast/) |
| 卡片组件与外部插件 Card | [components/](../../../src/components/) |
| 原生窗口与层级 | [reminder_toast.rs](../../../src-tauri/src/reminder_toast.rs)、[window_manager/](../../../src-tauri/src/window_manager/) |

controller 与局部 zustand store 管数据变更，React 订阅快照渲染。页面卸载统一 dispose：注销 Tauri／DOM 监听、定时器、rAF、ResizeObserver 与卡片引用；异步监听注册若迟到，在 dispose 后立即注销。

## 内容与生命周期

- `catrace:event` 实时订阅，`get_active_events` 水合晚创建窗口，按 Event id／dedupe key 原地更新 SDK 和插件卡。
- resolved 的 superseded 不卸卡，等待后续 active；普通结束移除；sticky 插件 action 在非 `end`／`dismiss` 时留卡供 roundtrip。
- 自动隐藏遵循 sticky 与 payload 时长，hover 暂停剩余时间；进度条和关闭定时器必须同源。宿主没有卡片数量上限。
- 内容组件只处理标题、正文、动作与自身布局。容器的 `CardContent` 分支互斥，避免专用卡和通用卡重复输出内容，见[组件边界](dedicated-card-renders-own-body-generic-template-must-exclude-it.md)。
- 内置 kind 为 rest、update、rest-timer、sdk、special、notification；其它功能通过已启用外部插件 Card 展示。插件组件故障降级通用卡，不拖垮 Toast 栈。
- rest-timer 使用 Bus upsert，保留同一事件与卡片身份，见[休息计时](rest-timer-收敛到-event-bus-的-upsert-路径.md)。

## 尺寸与滚动

窗口逻辑宽约 392px，卡片约 360px，左右提供阴影出血。高度来自内容测量，Rust clamp 到工作区；Windows 再应用显示器 DPI 与辅助功能文本缩放。

- 测量 single-flight／合并调度，禁止每张卡并发调用原生 resize。
- `.toast-root` 用 `height: 100vh` 定高，栈内部滚动；父高 auto 会让百分比 max-height 失效。
- 新卡只有在栈本来贴底时才跟随滚到底，不能打断用户翻旧卡；单卡保留顶部阴影空间。
- 普通模式复用隐藏窗口；轻量模式仅在最后一张卡移除后销毁，下一次通过 Bus 水合恢复。

详细尺寸见[原生小窗与测量](toast小窗化实现-右下角定位-内容尺寸上报-与去穿透.md)和[阴影出血](toast-卡片紧凑尺寸规范-和阴影防裁剪出血方案.md)。

## 焦点与层级约束

- Windows 默认 `WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE`；pointerover 仅 `prepareWindowActivation` 清样式，pointerdown 才接管焦点。
- Toast 必须从 window-state 插件恢复中排除：其 show／set_focus 会在重建时抢焦点。前台巡检仅为兜底，不能替代排除规则。
- 仅 TOPMOST 样式丢失或 HWND 首次可见的特定路径调整层级，不能每次 show 都推到最顶，避免切出全屏游戏。
- macOS 显示／隐藏走非激活路径，不能通过关闭最后一张卡把主窗拉到前台。

根因见[首次点击与焦点](Toast首次点击唤醒NOACTIVATE窗口后输入控件需要重新获得焦点.md)、[TOPMOST 自愈](锁屏解锁后TOPMOST丢失需在show时按需自愈.md)和[窗口模块](../../architecture/window-manager/README.md)。

## 插件与调试

- Card／Settings 都是 React，注入与 callbacks 见[外部插件合同](../../architecture/desktop-event-os/m10-external-plugins.md)。
- 卡片缓存与 generation 见[模块重载](外部插件toast卡热更新-generation缓存与reload顺序.md)，sticky 动作规则见[回传](插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md)。
- 插件 `payload.toastStyle` 见[外壳样式](外部插件通过payload-toastStyle选择默认或独立卡片外壳.md)。
- 调试页 `toast_debug_mode` 切换黄色半透明背景，只用于观察尺寸与点击区域。
- 验证入口：`pnpm typecheck`、`pnpm test`、`pnpm build`；原生焦点／DPI／层级仍需要用户授权的实机验证。
