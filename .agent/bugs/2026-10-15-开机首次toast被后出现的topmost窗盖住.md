# 2026-10-15 开机后第一次 Toast 不在最前，要点一次才置顶

## 问题

11:06 重启后，debug 进程 11:12:23 启动，11:12:24 `prepare: built fresh window`，11:12:28 第一次 `ensure: shown`。

卡片能出来，但盖在其它置顶窗下面。点一次卡片之后，后面的 show 都正常。

当天日志里没有 `ensure_topmost: WS_EX_TOPMOST missing`。不是锁屏把样式位清掉的那条路。

## 根因

Toast 在开机时**隐藏创建**，`CreateWindowEx` 已经带上 `WS_EX_TOPMOST`。样式位从一开始就在，所以 `ensure_topmost_style` 直接返回，不会 `SetWindowPos(HWND_TOPMOST)`。

隐藏窗口插进 topmost 带之后，后出现或后激活的其它 topmost 窗（这次机器上有 WeMail）排在它前面。第一次显示走 `ShowWindow(SW_SHOWNOACTIVATE)` + `SWP_NOZORDER`，不改这个顺序。

点击走 `SetForegroundWindow`，把同一 HWND 抬到 topmost 带最前。之后 hide/show 仍带 `SWP_NOZORDER`，顺序被保住，所以只点一次就「好了」。

Win32 对照：隐藏 topmost 窗先建好，再盖一个后创建的 topmost 窗，`SW_SHOWNOACTIVATE` 之后后者仍在上面；补一次 `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)` 就翻过去，且不抢焦点。

## 修复

`raise_topmost_once`：每个 Toast HWND 只在第一次变为可见时推一次 topmost 带。后续 show 仍不推，避免再踩 2026-07-14 全屏游戏被切出。

## 相关文件

- `src-tauri/src/window_manager/windows.rs` — `raise_topmost_once` / `show_no_activate`

## 涉及的知识

- [[toast-window]] [[window-manager]]
- [锁屏解锁后 TOPMOST 丢失需在 show 时按需自愈](../features/toast-window/锁屏解锁后TOPMOST丢失需在show时按需自愈.md)
- [2026-07-14 Toast HWND_TOPMOST 推高 Z 序导致全屏游戏退出](2026-07-14-toast-hwnd-topmost-推高-Z-序导致全屏游戏退出.md)
