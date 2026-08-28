# 2026-08-27 Toast 点击卡片无法抢焦点

## 现象

Toast 窗口可以选中文本，但键盘焦点仍留在原来的文本框（如 ZCode 输入框）。复制/粘贴快捷键继续作用于原窗口。

## 根因

`setWindowActiveMode` 调用的是 Tauri 插件命令：

```ts
invoke('plugin:catrace-window|set_window_active_mode', { label, active })
```

但 `catrace-window` 是 `src-tauri/src/window_manager/mod.rs` 里用 `Builder::new("catrace-window")` 手工注册的 inline plugin，**没有配置 Tauri v2 capability 权限**。前端调用时直接报错：

```
catrace-window.set_window_active_mode not allowed. Plugin not found
```

因此点击卡片时前端 `pointerdown` 能触发，但 IPC 到 Rust 的链路被 capability 系统拦截，焦点永远不会切换。

## 修复

把 `set_window_active_mode` 从 plugin 命令提升为普通 app command：

1. `src-tauri/src/window_manager/mod.rs`：命令改为 `pub`，从 plugin handler 移除
2. `src-tauri/src/lib.rs`：在 `generate_handler!` 里注册 `window_manager::set_window_active_mode`
3. `src/api/tauri.ts`：调用前缀从 `plugin:catrace-window|set_window_active_mode` 改为 `set_window_active_mode`

同时加固 Windows 后台抢焦点逻辑：直接 `SetForegroundWindow` 会被系统拒绝，改为先把当前线程输入附加到前台窗口线程，调用成功后再 detach，并补 `SetActiveWindow` / `SetFocus`。

## 关键文件

- `src-tauri/src/window_manager/mod.rs` — 命令导出与 plugin 注册
- `src-tauri/src/window_manager/windows.rs` — `force_foreground_window` 实现
- `src-tauri/src/lib.rs` — app command 注册
- `src/api/tauri.ts` — 前端 invoke 调用点
- `src/views/toastWindows/ReminderToast.vue` — 点击卡片触发 `setWindowActiveMode`

## 教训

- inline plugin 的命令必须显式配置 capability 权限，否则前端调不通
- 如果插件没有独立的权限清单，最稳妥的做法是把命令注册为 app command，走 `core:default` 授权
- 后台进程抢 Windows 焦点要用 `AttachThreadInput` + `SetForegroundWindow`，不能裸调
