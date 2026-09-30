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

## 演进：2026-09-30 两处抢焦点修复

本篇首击时序问题后来牵出**两个独立的抢焦点 bug**，不要混为一谈：

### 1) 轻量模式按需重建必抢焦点（主 bug，用户实测「开→每次必抢、关→从不抢」）

用户反馈轻量模式每次弹窗都抢焦点后，日志排除了 app 层调用：复用路径 show 完全合规（`SW_SHOWNOACTIVATE` + `noact=true`），且体感被抢的时刻没有任何 `active_mode` 记录、也没有 main-win 重建。真凶在 `build_toast_window()` **内部**：WebView2 控制器异步初始化完成时把焦点切进自己的 child HWND（控制器创建会先往父窗口挂 child 再返回，此过程影响激活，WebView2 已知问题类别），把当时**尚未套 NOACTIVATE 样式**的新 Toast 窗口顶成前台。普通模式控制器只在启动时建一次（`prepare_toast_window`），故从不复发——这正是「轻量开/关」成为开关变量的原因。

修复（机制无关，防未来变体）：重建前 `current_foreground()` 记下前台窗口，show 后 ~0.15–4s 分六拍调 `restore_foreground_if_taken(toast_hwnd, prev_fg)`——仅当前台仍是 Toast 本尊、且用户没有点卡接管（`TOAST_FOCUS_TAKEN_DELIBERATELY` 标志，show 时复位、`set_window_active_mode(true)` 时置位）时，用 AttachThreadInput 提权把前台还给原窗口。抢在巡检前发生也一样能追回；用户主动点了卡片则巡检停手，不会把用户刚点的焦点抢回去。

### 2) hover 全套激活抢焦点（次 bug，已拆分）

7692a88 的 `pointerover` 直接调 `setWindowActiveMode(true)`，Rust 侧 `force_foreground_window` + `set_focus`——鼠标一划过卡片就抢走正在输入应用的键盘焦点（14:02 实测日志 7 次 `ok=true`，全部由鼠标活动触发，与主 bug 无关）。拆成两步：

- `pointerover` → `prepareWindowActivation`（新命令 `prepare_window_activation`）：仅清 `WS_EX_NOACTIVATE`，不请求前台。样式清掉后，后续首次点击走 Windows 原生点击激活，DOM 光标与键盘焦点天然一致，首击时序问题同样解决。
- `pointerdown` → `setWindowActiveMode(true)`：真正的焦点接管，与「点卡片才抢焦点」的产品约定对齐。

「恢复到 pointerdown 后才激活」不可行、而「纯 hover 绝不动样式」也没必要——NOACTIVATE 只拦用户点击激活，程序清掉它不会抢焦点，hover 清样式是安全的中间态。

## 涉及文件

- `src/views/toastWindows/ReminderToast.vue` — 捕获 Toast 根节点内的 pointerover 调 `prepareWindowActivation`，pointerdown 调 `activateToastWindow`。
- `src-tauri/src/window_manager/windows.rs` — Windows 清除 `WS_EX_NOACTIVATE`（`prepare_window_activation_internal` / `set_window_active_mode_internal`）、前台激活与 focus、重建抢焦点巡检（`current_foreground` / `reminder_hwnd_id` / `restore_foreground_if_taken`）。
- `src-tauri/src/window_manager/mod.rs` — `prepare_window_activation` 命令 + 巡检函数导出。
- `src-tauri/src/reminder_toast.rs` — Toast 创建时无焦点显示；重建路径接入巡检归还。

## 验证

- `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
- `node node_modules/vite/bin/vite.js build`
- 手动（主 bug）：开轻量模式，在其它应用打字，每次 toast 弹出打字不中断；日志出现 `restore_foreground ... ok=true` 即为巡检追回。
- 手动（次 bug）：鼠标划过卡片焦点不动；点卡片才接管；直接点输入框首次点击即可键入。
