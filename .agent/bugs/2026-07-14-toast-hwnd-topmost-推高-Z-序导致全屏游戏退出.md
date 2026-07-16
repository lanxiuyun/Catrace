# 2026-07-14 Toast HWND_TOPMOST 推高 Z 序导致全屏游戏退出

## 问题

全屏游戏时，Catrace Toast 弹出会导致游戏退出全屏回到桌面。

## 根因

commit `3c9d0b3` 修复 Toast 未置顶 bug 时，去掉了 `apply_no_activate_style` 和 `show_no_activate` 中的 `SWP_NOZORDER`，使 `SetWindowPos(HWND_TOPMOST, ...)` 真正生效。每次 Toast 显示时会将窗口推到 topmost 层最顶层，Windows 检测到新顶层窗口后，将全屏独占模式（DXGI/OpenGL）的游戏切出全屏。

## 修复

1. **`apply_no_activate_style`**：恢复 `SWP_NOZORDER`。此函数只需应用 `WS_EX_NOACTIVATE` 样式，不应改动 Z 序。窗口已有 Tauri `WebviewWindowBuilder::always_on_top(true)` 设上 `WS_EX_TOPMOST`，始终位于 topmost 层。
2. **`show_no_activate`**：去掉多余的 `SetWindowPos(HWND_TOPMOST, ...)` 调用。`ShowWindow(SW_SHOWNOACTIVATE)` + 已有的 `WS_EX_TOPMOST` 样式足够使窗口正确显示并置顶，无需额外推高 Z 序。

## 相关文件

- `src-tauri/src/window_manager/windows.rs` — `apply_no_activate_style`、`show_no_activate` 修改
- `docs/window-focus-refactor-notes.md` — 无焦点窗口重构文档，需同步更新

## 涉及的知识

- `SWP_NOZORDER` 与 Z 序修改互斥
- `WS_EX_TOPMOST`（`always_on_top(true)`）已使窗口在 topmost 层，不需要调用 `SetWindowPos(HWND_TOPMOST)`
- 全屏独占模式下 Win32 对 topmost 层 Z 序变化的特殊处理
