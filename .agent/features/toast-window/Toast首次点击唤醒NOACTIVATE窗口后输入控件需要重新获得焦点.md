# Toast 首次点击与 Windows 键盘焦点

Toast 默认以 NOACTIVATE 显示，通知到达不能抢走原应用输入。若等 pointerdown 已分发后才移除 NOACTIVATE，DOM 光标可能已出现但 Windows 键盘焦点仍留在原窗口，表现为第一次点击输入框不能键入。

## 两阶段激活

[windowActivation.ts](../../../src/app/windows/toast/windowActivation.ts) 处理根节点捕获事件：

- pointerover 调 `prepareWindowActivation`，只清 NOACTIVATE 样式，不请求前台。
- pointerdown 调 `setWindowActiveMode(true)`，才接管焦点；成功后幂等，关闭时恢复无焦点态。

纯 hover 不能调用全套 SetForegroundWindow／set_focus，否则鼠标划过通知会打断正在输入的应用。

## 重建与原生恢复

轻量模式会重复创建 WebView，必须将 Toast 排除在 window-state 的 show／set_focus 恢复之外。窗口显示路径还保存原前台，延迟巡检仅在当前前台是 Toast 且用户未主动点卡时归还。巡检只是兜底，不能代替从源头避免抢焦点。

底层见 [window_manager/windows.rs](../../../src-tauri/src/window_manager/windows.rs)、[reminder_toast.rs](../../../src-tauri/src/reminder_toast.rs)。验证要覆盖：其它应用持续输入时来卡不丢键、hover 不切焦点、首次直接点击卡内输入框即可键入、用户主动点击后巡检不夺回焦点。
