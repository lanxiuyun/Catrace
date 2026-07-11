# Toast 提醒窗口

独立透明 WebviewWindow + Vue 卡片实现的右下角通知堆叠。

## 涉及文件

- `src-tauri/src/reminder_toast.rs` — Toast 窗口创建/复用；兜底创建分支才定位，已有窗口由前端定位
- `src-tauri/src/window_manager/` — 无焦点显示（Windows `WS_EX_NOACTIVATE`）
- `src/views/ReminderToast.vue` — 前端卡片堆叠、窗口尺寸/位置调整、动画
- `src/components/EyeToastCard.vue` — 护眼提醒专用卡片

## 窗口特性

- 透明无边框 WebviewWindow，复用而非销毁
- 定位到工作区右下角，支持多屏
- Windows 不抢夺焦点（`WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE`）
- macOS / Linux 回退到普通显示

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

## 定位职责

- 已有 Toast 窗口时，前端通过 `currentMonitor()` 获取工作区，调用 `setSize` / `setPosition`
- Rust 兜底创建窗口时才会调用 `position_toast_window`
- 需要 `core:window:allow-current-monitor` 权限

## 调试

Debug 页开启 `toast_debug_mode` → Toast 窗口背景变半透明黄色，方便排查布局/点击。

## 子文档

- [dedicated-card-renders-own-body-generic-template-must-exclude-it.md](dedicated-card-renders-own-body-generic-template-must-exclude-it.md) — 专用卡片自渲染正文时，外层通用模板要显式排除，否则正文会渲染两遍
