# 锁屏解锁后 TOPMOST 丢失，需在 show 时按需自愈

Toast 小窗创建时带 `always_on_top(true)`，平时 show 路径**禁止** `SetWindowPos(HWND_TOPMOST)`，以免把全屏独占游戏切出全屏。见 [Z 序约束](../../architecture/window-manager/README.md#z-序约束重要) 与 [2026-07-14 全屏游戏退出](../../bugs/2026-07-14-toast-hwnd-topmost-推高-Z-序导致全屏游戏退出.md)。

前提「窗口一直带着 `WS_EX_TOPMOST`」在锁屏/解锁后不成立。

## 现行行为

- `show_no_activate`：先套 `WS_EX_NOACTIVATE`，再读 `GWL_EXSTYLE`；**只有缺少 `WS_EX_TOPMOST` 时**才 `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)`。
- sticky 卡让窗口保持可见时，`ensure_toast_window_visible` 不会再走 show；此时同样检查并按需补回。
- 样式还在则不因为「缺位」再推。另外：每个 Toast HWND **第一次变为可见**时仍推一次 topmost 带（`raise_topmost_once`）。开机时窗口是隐藏创建的，样式位从 `CreateWindowEx` 起就在，但后出现的其它 topmost 窗（邮件客户端等）排在它前面；`SW_SHOWNOACTIVATE` + `SWP_NOZORDER` 不改这个顺序，所以第一次弹出被盖住，要点一下（`SetForegroundWindow`）才到最前。同一 HWND 的后续 show 不再推，全屏游戏路径不变。

## 为什么必须这样

Toast HWND 是复用的。锁屏（Win+L）/ 解锁会让 DWM 清掉已有窗口的 `WS_EX_TOPMOST`。show 仍带 `SWP_NOZORDER`，发现丢了也不会补。结果：

- 卡片还在，但不置顶
- Win+D 把 Toast 当普通窗口收掉
- 点一下卡片走 `setWindowActiveMode(true)` → `set_focus()`，tao 把 `always_on_top` 重新落实，现象消失

点击不是产品设计，只是碰巧修好了样式。自愈必须发生在 show / ensure，不能等用户点。

## 不要做的

- 不要每次 show 都 `HWND_TOPMOST`（会再踩 2026-07-14）
- 不要靠用户点击恢复置顶
- 不要把 Win+D 异常先当成「系统 hide」，先看 HWND 的 `topmost` 位

修复：`9b3b50d` / `26.9.21`。完整复现见 [bug 记录](../../bugs/2026-09-19-锁屏解锁后toast丢失TOPMOST且Win+D可最小化.md)。
