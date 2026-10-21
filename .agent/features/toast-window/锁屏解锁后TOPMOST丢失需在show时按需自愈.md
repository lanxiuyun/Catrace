# 锁屏解锁后 TOPMOST 丢失，需在 show 时按需自愈

Toast 小窗创建时带 `always_on_top(true)`，但置顶窗口之间仍有 Z 序。禁止无条件反复 `SetWindowPos(HWND_TOPMOST)`，也不能只检查样式位。见 [Z 序约束](../../architecture/window-manager/README.md#z-序约束重要) 与 [2026-07-14 全屏游戏退出](../../bugs/2026-07-14-toast-hwnd-topmost-推高-Z-序导致全屏游戏退出.md)。

前提「窗口一直带着 `WS_EX_TOPMOST`」在锁屏/解锁后不成立。

## 现行行为

- `show_no_activate` 显示后与已可见的 ensure 分支共用 `ensure_topmost`：缺少 `WS_EX_TOPMOST` 或存在可见、重叠且排在前面的窗口时才修复。
- 从 `GW_HWNDPREV` 查实际顺序，排除隐藏、最小化、DWM cloaked、Toast 自己的直接 owned 弹窗及不重叠窗口。使用 `HWND_TOPMOST + SWP_NOACTIVATE`，不抢前台焦点；修复后验证实际顺序，最多补一次。
- `SHQueryUserNotificationState` 仅在 ACCEPTS_NOTIFICATIONS / QUIET_TIME 允许抬升；全屏、演示、离开桌面、APP 或查询失败时不改 Z 序。恢复桌面后再次按需修复。
- 每个 Toast 生命周期有一个 500ms 巡检，处理显示中被遮挡、退出全屏、解锁等没有新通知的情况；隐藏时不扫描，销毁后结束，不能重新显示已隐藏窗口。
- `apply_no_activate_style` 不再携带 `SWP_SHOWWINDOW`，避免关闭路径恢复样式时意外重新显示。

## 2026-10-21 复发与验证

此前 `raise_topmost_once` 仅首次显示有效；同一 HWND 之后被其它置顶窗压住时，复用路径跳过抬升，已可见路径又只查样式位。现已移除一次性 HWND 缓存。

原生测试直接创建屏幕外 Win32 窗口并调用生产修复函数，修复前断言 `reused Toast is still covered despite WS_EX_TOPMOST` 失败。覆盖首次显示、20 轮复用和显示中遮挡、焦点不变、样式丢失恢复、无重叠/隐藏时不操作，以及受保护状态不改顺序。全屏状态通过注入系统查询结果验证，未实测独占游戏。

```powershell
cargo test --manifest-path C:\work_sapce\Catrace\src-tauri\Cargo.toml --lib native_toast_z_order -- --ignored --test-threads=1
```

该测试需交互式 Windows 桌面，默认忽略以免无桌面的 CI 误报。普通策略单测仍随 `cargo test --lib` 执行。

## 为什么必须这样

Toast HWND 是复用的。锁屏（Win+L）/ 解锁会让 DWM 清掉已有窗口的 `WS_EX_TOPMOST`。show 仍带 `SWP_NOZORDER`，发现丢了也不会补。结果：

- 卡片还在，但不置顶
- Win+D 把 Toast 当普通窗口收掉
- 点一下卡片走 `setWindowActiveMode(true)` → `set_focus()`，tao 把 `always_on_top` 重新落实，现象消失

点击不是产品设计，只是碰巧修好了样式。自愈必须发生在 show / ensure，不能等用户点。

## 不要做的

- 不要无条件每次 show 都 `HWND_TOPMOST`，也不要以“每个 HWND 仅一次”代替全屏保护
- 不要靠用户点击恢复置顶
- 不要把 Win+D 异常先当成「系统 hide」，先看 HWND 的 `topmost` 位

修复：`9b3b50d` / `26.9.21`。完整复现见 [bug 记录](../../bugs/2026-09-19-锁屏解锁后toast丢失TOPMOST且Win+D可最小化.md)。
