# 无焦点提醒窗口重构

## 背景

Catrace 在 Windows 上弹出 Toast/Popup 提醒时，会抢夺当前输入焦点（如资源管理器 F2 重命名被打断）。

## 方案

新增 `window_manager/` 模块（Tauri 插件），利用 Win32 `WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE` 实现不夺焦弹窗。

## 应用范围

- Toast / Popup → 无焦点显示
- Fullscreen / 主窗口 → 保持原有聚焦行为

## 关键取舍

### 去掉全局输入钩子

曾引入 `WH_MOUSE_LL`（点击外部隐藏）和 `WH_KEYBOARD_LL`（Escape 隐藏），后移除。详见 [去掉全局低层输入钩子的取舍](../architecture/window-manager/README.md#去掉全局低层输入钩子的取舍)。

### macOS 回退

macOS 通知行为较友好，先回退普通显示。后续可按需接入 `tauri-nspanel`。

### 隐藏复用

Toast/Popup 关闭时 `hide_window_internal` 隐藏而非 `close()` 销毁，避免下次创建焦点抖动。

## 时间

2026 年 6 月初版，2026 年 7 月补充 Z 序约束。
