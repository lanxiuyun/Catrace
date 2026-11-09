# 2026-09-19 锁屏解锁后 Toast 丢失 TOPMOST，Win+D 可最小化

## 问题

sticky 卡过夜 + Win+L 锁屏，第二天解锁后：

- Toast 卡片还在，但不置顶（会被主窗/其它窗盖住）
- Win+D 能把 Toast 收掉
- **点一下卡片**后置顶恢复，Win+D 也不再收

不是第一次 show。窗口已经 show 过很多次，只是 HWND 跨过了锁屏。

## 根因

Toast 复用同一 HWND。创建时 `always_on_top(true)` 带上 `WS_EX_TOPMOST`。为避免全屏游戏被切出，show 路径刻意不调用 `SetWindowPos(HWND_TOPMOST)`（见 2026-07-14 bug）。

锁屏/解锁后 DWM 清掉 `WS_EX_TOPMOST`。sticky 卡让窗口保持可见，`ensure_toast_window_visible` 直接 return，连 show 都不走。之后的 `SWP_NOZORDER` 也不会把 TOPMOST 补回来。

点击走 `setWindowActiveMode(true)` → `SetForegroundWindow` + `set_focus()`，tao 重新落实 `always_on_top`，所以一点就好。

实机 HWND（修复前，Toast 候选窗）：`topmost=False tool=False`。主窗当时甚至是 `topmost=True`，更容易把 Toast 盖住。

同一次日志里的 `event is not active` 是 Bus 对已结束事件二次 resolve，和窗口层无关。

## 修复

`9b3b50d` / 版本 `26.9.21`：

- `ensure_topmost_style`：缺 `WS_EX_TOPMOST` 才 `HWND_TOPMOST` + `SWP_NOACTIVATE`
- `show_no_activate` 每次 show 检查
- `ensure_toast_window_visible` 已可见的短路路径也检查（过夜 sticky 卡）

## 相关文件

- `src-tauri/src/window_manager/windows.rs` — `ensure_topmost_style` / `ensure_reminder_topmost`
- `src-tauri/src/reminder_toast.rs` — 已可见时也自愈
- `src/app/windows/ReminderToast.tsx` — 点击抢焦点（碰巧能修好，不是正道）

## 涉及的知识

- [[toast-window]] [[window-manager]]
- [锁屏解锁后 TOPMOST 丢失需在 show 时按需自愈](../features/toast-window/锁屏解锁后TOPMOST丢失需在show时按需自愈.md)
- [2026-07-14 Toast HWND_TOPMOST 推高 Z 序导致全屏游戏退出](2026-07-14-toast-hwnd-topmost-推高-Z-序导致全屏游戏退出.md)
