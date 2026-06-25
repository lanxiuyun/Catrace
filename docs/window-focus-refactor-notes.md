# Catrace 无焦点提醒窗口重构经验总结

> 记录本次将 Toast / Popup 提醒窗口改为不抢夺焦点的过程、踩坑与最终取舍。

---

## 1. 背景与目标

**问题**：Catrace 在 Windows 上弹出 Toast/Popup 提醒时，会把当前输入焦点从用户正在操作的窗口（如资源管理器重命名输入框、编辑器）夺走，打断输入状态。

**目标**：让提醒窗口显示时不抢夺前台焦点，同时保持按钮可点击、Popup 自定义输入可输入。典型场景：在资源管理器中对文件按 `F2` 重命名时，Catrace 提醒弹出，文件名编辑框仍保持编辑状态。

---

## 2. 无焦点窗口的技术要点

Windows 上实现不夺焦弹窗的核心思路是阻止窗口被激活，同时让它可见且置顶。常见做法包含以下 Win32 API 组合：

- **扩展样式 `WS_EX_NOACTIVATE`**：窗口不会成为前台窗口，点击它也不会夺走当前焦点。
- **显示命令 `SW_SHOWNOACTIVATE`**：以不激活的方式显示窗口。
- **`SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE | ...)`**：将窗口置顶，但不让它获得焦点。

一些实现还会叠加低层输入钩子：

- `WH_MOUSE_LL`：监听全局鼠标点击，点击窗口外部时隐藏窗口。
- `WH_KEYBOARD_LL`：监听 `Escape` 等按键以隐藏窗口。

这些钩子可以增加交互便利，但也会带来全局输入处理和维护成本。

---

## 3. Catrace 的最终方案

### 3.1 架构

新增独立模块 `src-tauri/src/window_manager/`：

```
window_manager/
├── mod.rs          # Tauri 插件入口、命令封装
├── shared.rs       # 窗口常量与通用显示/隐藏辅助函数
├── windows.rs      # Windows：WS_EX_NOACTIVATE + SW_SHOWNOACTIVATE
└── macos.rs        # macOS：回退到普通显示
```

在 `lib.rs` 中注册插件：

```rust
.plugin(window_manager::init())
```

### 3.2 Windows 核心代码

```rust
// 给窗口加上 WS_EX_NOACTIVATE
let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
let new_style = style | WS_EX_NOACTIVATE.0 as isize;
SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);

// 无焦点显示
ShowWindow(hwnd, SW_SHOWNOACTIVATE);

// 置顶但不激活
SetWindowPos(
    hwnd,
    Some(HWND_TOPMOST),
    0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER
        | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
);
```

### 3.3 应用范围

- **使用无焦点显示**：`reminder-toast`、`reminder-popup`
- **保持原有行为**：`reminder-fullscreen`（强制聚焦）、主窗口（正常显示/聚焦）

### 3.4 前端配合

- `src/api/tauri.ts` 封装 `showWindow` / `hideWindow` / `setWindowActiveMode`。
- `ReminderPopup.vue` 在点击「自定义」展开输入框时调用 `setWindowActiveMode(label, true)` 临时恢复可聚焦模式，输入完成后再关闭窗口。
- 关闭 Toast/Popup 时调用 `closeReminderWindow`，后端对这两个标签使用 `hide_window_internal` 隐藏而非销毁，便于复用。

---

## 4. 关键取舍

### 4.1 去掉全局输入钩子

最初实现时曾同步引入 `WH_MOUSE_LL`（点击外部隐藏）和 `WH_KEYBOARD_LL`（`Escape` 隐藏），但随后确认：

- Catrace 的 Toast 自带 8 秒自动消失 + 按钮关闭。
- Popup 有明确的关闭/snooze/跳过按钮。
- 全局输入钩子会增加维护成本，且一旦回调处理不当可能导致系统输入卡顿。

**结论**：只保留「不夺焦」核心能力，去掉两个低层钩子。

### 4.2 macOS 暂不回退到 NSPanel

- 用户的实际痛点在 Windows。
- macOS 的通知行为相对友好，不夺焦问题不如 Windows 明显。
- 引入 `tauri-nspanel` 会增加依赖和集成复杂度。

**结论**：macOS 先回退到普通显示，后续如需要再接入 `NSPanel`。

### 4.3 隐藏复用而非关闭

- 关闭窗口后下次创建需要重新 `build()`，可能带来额外的焦点状态切换。
- 隐藏后通过 `show_reminder_no_activate` 再次无焦点显示更稳定。

**结论**：`close_reminder_window` 对 Toast/Popup 调用 `hide_window_internal` 隐藏；Fullscreen 仍走 `close()`。

---

## 5. 踩坑记录

### 5.1 Tauri 命令命名与插件前缀

`window_manager` 通过 Tauri 插件方式注册命令，前端 invoke 时必须使用插件前缀：

```ts
invoke('plugin:catrace-window|set_window_active_mode', { label, active })
```

如果直接用 `invoke('set_window_active_mode')` 会找不到命令。

### 5.2 `generate_handler!` 的宏作用域

命令函数定义在平台子模块（`windows.rs` / `macos.rs`）时，`generate_handler!` 在 `mod.rs` 中无法直接识别子模块宏。最终方案：

- 子模块只暴露内部实现函数（无 `#[command]`）。
- `mod.rs` 中定义 `#[command]` 包装函数，调用子模块的内部实现。

### 5.3 `SetWindowPos` 的 `HWND_TOPMOST`

在 windows crate 0.61 中，`SetWindowPos` 的 `hwndinsertafter` 参数类型是 `Option<HWND>`，`HWND_TOPMOST` 需要包装为 `Some(HWND_TOPMOST)`。

### 5.4 HINSTANCE 与 HMODULE

`SetWindowsHookExW` 需要 `Option<HINSTANCE>`，而 `GetModuleHandleW` 返回 `HMODULE`。两者内部都是 `*mut c_void`，可直接构造：

```rust
let h_instance = GetModuleHandleW(None).unwrap_or_default();
let h_instance = Some(windows::Win32::Foundation::HINSTANCE(h_instance.0));
```

> 注：最终去掉钩子时此代码也被移除，仅作记录。

### 5.5 跨平台类型转换

内部函数需要把 `WebviewWindow<R>` 和 `AppHandle<R>` 转换为 `WebviewWindow<Wry>` / `AppHandle<Wry>`。通过裸指针转换实现：

```rust
fn cast_to_wry<R: Runtime>(window: &WebviewWindow<R>) -> &WebviewWindow<tauri::Wry> {
    unsafe { &*(window as *const WebviewWindow<R> as *const WebviewWindow<tauri::Wry>) }
}
```

### 5.6 WS_EX_NOACTIVATE 与输入框的矛盾

`WS_EX_NOACTIVATE` 窗口默认不接受键盘焦点。Popup 的「自定义」输入框需要临时恢复可聚焦：

1. 点击「自定义」时调用 `set_window_active_mode(label, true)`。
2. 后端移除 `WS_EX_NOACTIVATE` 并 `SetForegroundWindow` + `set_focus()`。
3. 输入框获得焦点后可正常输入。
4. 用户关闭窗口时，下次通过 `show_reminder_no_activate` 重新应用 `WS_EX_NOACTIVATE`。

---

## 6. 验证结果

- `cd src-tauri && cargo check` ✅
- `cd src-tauri && cargo build` ✅
- `cd src-tauri && cargo test` ✅（30 个测试全过）
- `npx vue-tsc --noEmit` ✅
- `pnpm build` ✅

现场测试：在 Windows 资源管理器中对文件按 `F2` 重命名，等待提醒触发，Toast/Popup 弹出后文件名编辑框保持编辑状态。

---

## 7. 相关文件

| 文件 | 说明 |
|---|---|
| `src-tauri/src/window_manager/mod.rs` | 插件入口与命令封装 |
| `src-tauri/src/window_manager/shared.rs` | 窗口常量与通用辅助函数 |
| `src-tauri/src/window_manager/windows.rs` | Windows 无焦点实现 |
| `src-tauri/src/window_manager/macos.rs` | macOS 回退实现 |
| `src-tauri/src/reminder_toast.rs` | Toast 窗口位置与复用逻辑 |
| `src-tauri/src/lib.rs` | Popup 创建、`close_reminder_window` |
| `src/api/tauri.ts` | 前端 invoke 封装 |
| `src/views/ReminderToast.vue` | Toast UI |
| `src/views/ReminderPopup.vue` | Popup UI，含自定义输入激活逻辑 |
| `docs/reminder-development-notes.md` | 提醒窗口通用开发笔记 |
| `docs/window-focus-refactor-notes.md` | 本文档 |
