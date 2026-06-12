# 后续待办：统一键鼠监听库

## 问题背景

当前 `src-tauri/src/lib.rs` 中键盘监听采用平台分支实现：

- **Windows / Linux**：使用 `rdev::listen`
- **macOS**：使用 `device_query::DeviceEventsHandler`

分支原因是 `rdev` 在 macOS 上解析按键名称时会调用 `TISGetInputSourceProperty`，该 API 在非主线程 / 某些输入法下会直接导致进程崩溃（见 Narsil/rdev #103、#146）。

## 目标

**统一全平台键盘监听到 `device_query`**，彻底移除 `rdev` 依赖。

## 为什么可以统一

Catrace 只需要知道"用户是否按了键盘"，不需要知道具体按了哪个键、也不需要解析字符。`device_query` 的 `DeviceEventsHandler::on_key_down` 回调只返回 `Keycode`，不调用 TIS API，正好满足需求。

## 待办步骤

1. **依赖清理**
   - 在 `src-tauri/Cargo.toml` 中移除 `rdev` 及其条件依赖块。

2. **代码重构**
   - 在 `src-tauri/src/lib.rs` 中：
     - 移除 `#[cfg(not(target_os = "macos"))] use rdev::{listen, EventType};`
     - 移除键盘监听的条件编译分支。
     - 统一使用 `device_query::{DeviceEvents, DeviceEventsHandler, Keycode}` 的 `on_key_down` 回调。

3. **文档更新**
   - 更新 `AGENTS.md`：
     - 技术栈表格改为"`device_query`（键鼠）"。
     - 核心逻辑采样说明移除平台分支描述。
     - 开发进度第 1 步改为"Rust 采样：device_query 键鼠"。
     - 安全隐私说明改为"`device_query` 与 `active-win-pos-rs` 需要系统权限"。

4. **跨平台验证**
   - **Windows**：确认普通按键、功能键、组合键都能正常触发活跃计数。
   - **macOS**：确认中文/日文/韩文输入法下不再崩溃，按键事件正常触发。
   - **Linux**：确认 X11 环境下按键监听正常（Wayland 不支持，与现状一致）。

## 注意事项

- macOS 仍需在"系统设置 → 隐私与安全性 → 辅助功能 / 输入监控"中授权应用。
- `DeviceEventsHandler` 内部是轮询模型，回调灵敏度取决于创建时传入的 sleep 间隔（当前可保持 10ms）。
- 移除 `rdev` 后，`Cargo.lock` 会自动更新，需随代码一起提交。
