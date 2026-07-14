# 无焦点提醒窗口重构

## 背景

Catrace 在 Windows 上弹出 Toast/Popup 提醒时，会抢夺当前输入焦点（如资源管理器 F2 重命名被打断）。

## 方案

新增 `window_manager/` 模块（Tauri 插件），核心 Win32 技巧：

- `WS_EX_NOACTIVATE` 扩展样式：窗口不会激活
- `SW_SHOWNOACTIVATE` 显示命令
- `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE | ...)` 置顶但不抢焦点

## 应用范围

- Toast / Popup → 无焦点显示
- Fullscreen / 主窗口 → 保持原有聚焦行为

## 关键取舍

### 去掉全局输入钩子

曾引入 `WH_MOUSE_LL`（点击外部隐藏）和 `WH_KEYBOARD_LL`（Escape 隐藏），后移除：
- Toast 自带 8 秒自动消失 + 按钮关闭
- Popup 有明确关闭按钮
- 全局钩子增加维护成本，处理不当可致系统输入卡顿

### macOS 回退

macOS 通知行为较友好，先回退普通显示。后续可按需接入 `NSPanel`。

### 隐藏复用

Toast/Popup 关闭时 `hide_window_internal` 隐藏而非 `close()` 销毁，避免下次创建焦点抖动。

## 踩坑记录

- `SetWindowPos` 传 `HWND_TOPMOST` 时不能同时带 `SWP_NOZORDER`，否则置顶被忽略
- 但去掉 `SWP_NOZORDER` 后 `HWND_TOPMOST` 会在每次 Toast 显示时推高 Z 序 → **全屏独占模式游戏被切出全屏**。窗口已有 `always_on_top(true)` 的 `WS_EX_TOPMOST`，不需要额外 `SetWindowPos(HWND_TOPMOST)`。
- 插件命令必须带前缀调用：`invoke('plugin:catrace-window|set_window_active_mode', ...)`
- `WS_EX_NOACTIVATE` 与输入框矛盾：Popup 自定义输入框需临时 `set_window_active_mode(label, true)` 恢复可聚焦
- HINSTANCE / HMODULE 类型转换通过裸指针 `HINSTANCE(hmodule.0)`

## 时间

2026 年 6 月。
