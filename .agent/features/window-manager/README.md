# window_manager 特性总览

window_manager 是 Tauri 插件形式的窗口管理模块，核心能力：**让提醒窗口（Toast/Popup）在 Windows 上显示时不抢夺输入焦点**，同时保持按钮可点击、Popup 自定义输入可输入。

## 特性列表

置顶样式按需恢复，不在每次 show 时推高 Z 序。首次可见与锁屏自愈见[TOPMOST 约定](../toast-window/锁屏解锁后TOPMOST丢失需在show时按需自愈.md)。

###  Windows 无焦点弹出

- 利用 `WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE` 实现不夺焦弹出
- 同时保持窗口置顶（`always_on_top(true)` 提供 `WS_EX_TOPMOST`）
- 不会推高 Z 序，全屏独占模式游戏不受影响

见 [Z 序约束](../../architecture/window-manager/README.md#z-序约束重要)。

### 无焦点模式恢复（Popup 输入框 / Toast 复制）

`WS_EX_NOACTIVATE` 的窗口不接受键盘焦点。需要临时恢复可聚焦能力时：

1. 用户点击 Popup「自定义」或 Toast 卡片正文 → 前端调用 `setWindowActiveMode(label, true)`
2. 后端去掉 `WS_EX_NOACTIVATE`、`SetForegroundWindow`、`set_focus`
3. 输入框 / Toast WebView 获得焦点
4. 关闭窗口后，下次弹出重新应用 `WS_EX_NOACTIVATE`

详见 [`set_window_active_mode_internal` 实现](../../architecture/window-manager/README.md#插件注册)。

### 隐藏复用

- 普通 Toast/Popup 关闭时隐藏复用；轻量模式在卡片清空后按生命周期销毁 Toast
- 下次弹出直接显示，避免窗口重建带来的焦点抖动
- Fullscreen 仍走 `close()` 销毁

### macOS / Linux 回退

macOS/Linux 不实现无焦点逻辑，回退到 `shared_show_window`。详见 [跨平台 dispatch](../../architecture/window-manager/README.md#跨平台-dispatch)。

## 前端 API

封装在 `src/api/tauri.ts`。`setWindowActiveMode` 现在是 app command，不再带插件前缀：

```ts
invoke('set_window_active_mode', { active: true })
```

命令操作调用方当前窗口，Rust 由 Tauri 注入 WebviewWindow，不依赖前端传入 label。

## 怎么给新窗口加上无焦点

1. 在 `shared.rs` 的 `is_reminder_window` 加上新标签
2. 创建窗口时用 `WebviewWindowBuilder.always_on_top(true)`（已有 `WS_EX_TOPMOST`）
3. 显示时调 `show_reminder_no_activate` 而非 `window.show()`
4. 关闭时调 `hide_window_internal` 而非 `window.close()`（需隐藏复用）

## 踩坑记录

### `HWND_TOPMOST` 与 `SWP_NOZORDER` 互斥

`SetWindowPos` 传 `HWND_TOPMOST` 时不能同时带 `SWP_NOZORDER`，否则 Win32 会忽略层级参数，窗口不会置顶。但去掉 `SWP_NOZORDER` 又会在每次 Toast 弹出时推高 Z 序 → 全屏游戏被切出。最终方案：窗口已有 `always_on_top(true)` 的 `WS_EX_TOPMOST`，不再调用 `SetWindowPos(HWND_TOPMOST)`。

详见[窗口模块 Z 序约束](../../architecture/window-manager/README.md#z-序约束重要)。

### `generate_handler!` 宏作用域限制

`#[command]` 函数必须与 `generate_handler!` 在同一模块作用域。子模块（`windows.rs`/`macos.rs`）中的函数不能直接加 `#[command]` 被 `mod.rs` 引用。

**解决**：子模块只暴露 `*_internal` 函数（无 `#[command]`），`mod.rs` 中定义 `#[command]` 包装函数转发调用。

### `WS_EX_NOACTIVATE` 与输入框的矛盾

`WS_EX_NOACTIVATE` 窗口不接受键盘焦点。Popup 的「自定义」输入框需要临时恢复可聚焦。见 [无焦点模式恢复](#无焦点模式恢复-popup-输入框)。

### `visible(false)` 在 Windows 上的竞态

Tauri `WebviewWindowBuilder.visible(false)` 在 Windows 上偶尔不立即生效，窗口会闪一下再隐藏。防御写法：`build()` 之后再显式调一次 `window.hide()`。

```rust
let window = builder.build()?;
let _ = window.hide(); // 防御：二次隐藏
```

### `cast_to_wry` 裸指针转换

内部函数需要把泛型 `WebviewWindow<R>` 转为 `WebviewWindow<Wry>`（Win32 API 需要具体类型）。通过裸指针转换，详见 [architecture](../../architecture/window-manager/README.md#cast_to_wry-类型擦除)。

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/api/tauri.ts` | 前端 invoke 封装 |
| `src/views/toastWindows/ReminderPopup.vue` | Popup UI + 输入框激活逻辑 |
