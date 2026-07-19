# Toast 提醒窗口

独立透明 WebviewWindow + Vue 卡片实现的右下角通知堆叠。

> **内容入口（Step 2）**：rest/water/eye/agent/permission/update 均经 [[desktop-event-os]] Event Bus（`catrace:event`）到达本窗；  
> Rust 侧 `ensure_toast_window_visible` 只保证窗口在位。详见  
> [toast-renders-only-from-event-bus.md](../../architecture/desktop-event-os/toast-renders-only-from-event-bus.md)。  
> 例外：`catrace-rest-timer`、`dismissAgentSession` eval。

## 涉及文件

- `src-tauri/src/reminder_toast.rs` — 窗口 ensure/复用；agent/update/permission **publish bus**（不再 eval 内容）
- `src-tauri/src/bus.rs` / `event.rs` — 事件协议与分发
- `src-tauri/src/window_manager/` — 无焦点显示（Windows `WS_EX_NOACTIVATE`）
- `src/views/ReminderToast.vue` — listen bus + 栈生命周期；卡片内容下沉专用组件
- `src/components/EyeToastCard.vue` — 护眼提醒专用卡片
- `src/components/AgentToastCard.vue` — agent 通知专用卡片（详见 [[agent-notification]]）

## 组件边界纪律

新增卡片类型时**必须抽独立组件**，不要堆进 ReminderToast.vue；同时检查父模板三处按 kind 分支的 v-if（通用 header / body-text / progress-bar）都把新 kind 排除，否则会和组件内部渲染叠成双份（2026-07-12 agent 双进度条 bug 即此原因）。

## 窗口特性

- 透明无边框 WebviewWindow，复用而非销毁
- 定位到工作区右下角，支持多屏
- Windows 不抢夺焦点（`WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE`）
- macOS / Linux 回退到普通显示
- Z 序约束见 [window-manager 架构](../architecture/window-manager/README.md#z-序约束重要)

## 卡片行为

- 新卡片右侧滑入，关闭时 FLIP 动画让下方卡片上移
- 普通卡片 8 秒自动消失，hover 暂停，离开恢复
- 同类提醒不去重：护眼/喝水等卡片按普通 Toast 入栈，统一受 `MAX_NOTIFICATIONS` 上限约束；快速点测试按钮会堆叠多张，超出上限时丢最旧
- 内容超出时 `.toast-stack` 可滚动，并自动滚动到底部

## 卡片类型（按 `kind` 区分主题）

| kind | 颜色 | 行为 |
|------|------|------|
| 休息提醒 | 紫色 | 8s 自动消失 |
| 喝水提醒 | 蓝色 | 8s 自动消失 |
| 护眼提醒 | 绿色 | 25s 自动消失，倒计时在进度条右侧，hover 不暂停 |
| 休息计时 | 绿色 | 不自动关闭，液体球动画，满 break_minutes 后继续累计 |
| 更新通知 | 橙色 | 不自动关闭，展开更新日志 + 下载进度条 |
| agent 通知 | 青色 | 按事件策略：auto 8s 消失 / sticky 常驻手动关，多个 sticky 合并为一张「N 个会话在等你」；详见 [[agent-notification]] |

## 定位职责

- 已有 Toast 窗口时，前端通过 `currentMonitor()` 获取工作区，调用 `setSize` / `setPosition`
- Rust 兜底创建窗口时才会调用 `position_toast_window`
- 需要 `core:window:allow-current-monitor` 权限

## 调试

Debug 页开启 `toast_debug_mode` → Toast 窗口背景变半透明黄色，方便排查布局/点击。

## 子文档

- [dedicated-card-renders-own-body-generic-template-must-exclude-it.md](dedicated-card-renders-own-body-generic-template-must-exclude-it.md) — 专用卡片自渲染正文时，外层通用模板要显式排除，否则正文会渲染两遍
- [toast-卡片紧凑尺寸规范-和阴影防裁剪出血方案.md](toast-卡片紧凑尺寸规范-和阴影防裁剪出血方案.md) — 卡片/字体/留白尺寸规范（对标 Win11 原生 toast），以及透明窗口里阴影被 overflow 裁剪的根治方案
