# window_manager 模块框架

Tauri 插件形式注册、跨平台（Windows 不夺焦 + macOS/Linux 回退）的窗口管理模块。本文档只描述模块结构和代码模式，不涉及具体窗口行为和使用流程。

## 模块结构

```
window_manager/
├── mod.rs          # 插件入口 init()，#[command] 包装函数，导出供 lib.rs 使用
├── shared.rs       # 窗口标签常量 + is_reminder_window 守卫 + 通用显示/隐藏辅助
├── windows.rs      # Windows：WS_EX_NOACTIVATE + SW_SHOWNOACTIVATE 实现
└── macos.rs        # macOS：回退到 shared_show_window
```

## 插件注册

```rust
// lib.rs
.plugin(window_manager::init())

// mod.rs
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("catrace-window")
        .invoke_handler(generate_handler![show_window, hide_window, set_window_active_mode])
        .build()
}
```

插件命令需 Tauri 前缀调用：

```ts
invoke('plugin:catrace-window|show_window', { ... })
invoke('plugin:catrace-window|hide_window', { ... })
invoke('plugin:catrace-window|set_window_active_mode', { label, active })
```

## `generate_handler!` 与子模块 `#[command]`

Tauri 的 `generate_handler!` 要求命令标注 `#[command]` 且在 `generate_handler!` 所在模块的作用域内可见。子模块（`windows.rs`/`macos.rs`）中的函数不能被 `mod.rs` 的 `generate_handler!` 直接引用。

**方案**：子模块只暴露 `*_internal` 函数（无 `#[command]`），`mod.rs` 中定义 `#[command]` 包装函数转发调用：

```rust
// mod.rs
#[command]
async fn show_window<R: Runtime>(...args...) {
    platform::show_window_internal(&app_handle, &window, no_activate, pinned);
}
```

同时通过 `pub use platform::{hide_window_internal, show_reminder_no_activate}` 导出供 `lib.rs` 直接调用。

## `cast_to_wry` 类型擦除

内部函数需要把泛型 `WebviewWindow<R>` / `AppHandle<R>` 转为 `WebviewWindow<Wry>`（Win32 API 需要具体类型）。通过裸指针转换：

```rust
fn cast_to_wry<R: Runtime>(window: &WebviewWindow<R>) -> &WebviewWindow<tauri::Wry> {
    unsafe { &*(window as *const WebviewWindow<R> as *const WebviewWindow<tauri::Wry>) }
}
```

## `is_reminder_window` 守卫

```rust
pub fn is_reminder_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let label = window.label();
    label == TOAST_WINDOW_LABEL || label == POPUP_WINDOW_LABEL
}
```

所有内部命令函数（`show_window_internal` / `hide_window_internal` / `set_window_active_mode_internal`）都先用 `is_reminder_window` 守卫：
- true → 走无焦点逻辑
- false → 回退到 `shared_show_window` / `shared_hide_window` / 直接返回

## 跨平台 dispatch

```rust
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(target_os = "windows"))]
mod macos;

#[cfg(target_os = "windows")]
use windows as platform;
#[cfg(not(target_os = "windows"))]
use macos as platform;
```

## Z 序约束（重要）

窗口在 `WebviewWindowBuilder::always_on_top(true)` 时已获得 `WS_EX_TOPMOST`，始终在 topmost 层。**不要额外调用 `SetWindowPos(HWND_TOPMOST)` 推高 Z 序。**

- `apply_no_activate_style`：`Some(HWND(null))` + `SWP_NOZORDER`，只应用样式不动 Z 序
- `show_no_activate`：去掉 `SetWindowPos(HWND_TOPMOST)`，`ShowWindow` + 已有 `WS_EX_TOPMOST` 足够
- `restore_normal_style`：`Some(HWND(null))` + `SWP_NOZORDER`，只去掉 `WS_EX_NOACTIVATE` 不动 Z 序

为什么这样设计详见 [无焦点弹出特性：Z 序约束演变](../features/window-manager/README.md#z-序约束演变)。
