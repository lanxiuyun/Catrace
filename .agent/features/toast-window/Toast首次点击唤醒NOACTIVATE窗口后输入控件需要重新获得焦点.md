# Toast 首次点击唤醒 NOACTIVATE 窗口后输入控件需要重新获得焦点

## 现象

Windows 上 Toast 小窗默认使用 `WS_EX_NOACTIVATE`，避免通知弹出时抢走当前应用的键盘焦点。用户直接点 Toast 内的 DSH iframe 输入框时，WebView 可能显示文本光标，但键盘仍交给原前台窗口；再点一下 Toast 标题栏后，输入才恢复。

## 根因链路

1. `build_toast_window()` 将 Toast 初始设为 `.focused(false)`。
2. `show_reminder_no_activate()` 通过 `SW_SHOWNOACTIVATE` 显示窗口，并应用 `WS_EX_NOACTIVATE`。
3. 前端原先在 `pointerdown` 后调用 `setWindowActiveMode(true)`；此时当前点击/焦点事件可能已经在旧原生窗口状态下分发，WebView 的 DOM 光标与 Windows 键盘焦点短暂不一致。
4. 窗口激活命令移除 `WS_EX_NOACTIVATE` 并请求前台焦点；之后点击标题栏会带来下一次完整的原生激活/点击，因此看起来能修好输入。

## 处理原则

- Toast 的默认无焦点行为必须保留，不能在显示时无条件激活窗口，否则普通通知会打断用户当前应用。
- 在用户指针进入 Toast 内容时提前请求激活，让 `pointerdown` / `click` 到达之前有机会清除 NOACTIVATE；仅对 Toast 根节点内的指针事件处理，不因经过窗口外区域切换焦点。
- `activateToastWindow()` 幂等；成功后由 `toastActivated` 防止重复 invoke，关闭时恢复为无焦点模式。
- `pointerover` 是捕获阶段的预激活信号；验证时重点确认首次直接点击 iframe 输入框即可键入，并确认仅 hover 普通 Toast 会不会造成不可接受的焦点抢占。若产品仍要求“纯 hover 绝不激活”，需实现更精确的 pointer 轨迹/短延迟策略，而不是恢复到 pointerdown 后才激活。

## 演进：hover 全套激活抢焦点（2026-09-30 拆分修复）

上面第 19 行担忧的「hover 不可接受的焦点抢占」被真实撞上：`pointerover` 直接调 `setWindowActiveMode(true)`，Rust 侧会 `force_foreground_window` + `set_focus`——Toast 弹出后鼠标一划过卡片，正在输入的应用键盘焦点立刻被抢（轻量模式高频弹窗时尤其明显，日志表现为弹出几秒后 `active_mode[reminder-toast] -> focus`）。

修复是把「清样式」和「抢焦点」拆开：

- `pointerover` → `prepareWindowActivation`（新命令 `prepare_window_activation`）：仅清 `WS_EX_NOACTIVATE`，不请求前台。样式清掉后，后续首次点击会走 Windows 原生点击激活，DOM 光标与键盘焦点天然一致，首击时序问题同样解决。
- `pointerdown` → `setWindowActiveMode(true)`：真正的焦点接管，与「点卡片才抢焦点」的产品约定对齐。

「恢复到 pointerdown 后才激活」不可行、而「纯 hover 绝不动样式」也没必要——NOACTIVATE 只拦用户点击激活，程序清掉它不会抢焦点，hover 清样式是安全的中间态。

## 涉及文件

- `src/views/toastWindows/ReminderToast.vue` — 捕获 Toast 根节点内的 pointerover 调 `prepareWindowActivation`，pointerdown 调 `activateToastWindow`。
- `src-tauri/src/window_manager/windows.rs` — Windows 清除 `WS_EX_NOACTIVATE`（`prepare_window_activation_internal` / `set_window_active_mode_internal`）、调用前台激活和 focus。
- `src-tauri/src/window_manager/mod.rs` — `prepare_window_activation` 命令。
- `src-tauri/src/reminder_toast.rs` — Toast 创建时无焦点显示。

## 验证

- `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
- `node node_modules/vite/bin/vite.js build`
- 手动：重启 Catrace 后，从原前台应用直接点击 Toast iframe 输入框并输入，不再先点标题栏；同时确认普通 Toast 弹出不主动夺焦。
