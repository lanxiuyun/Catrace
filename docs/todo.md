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

---

## 已解决：GSMTCSM 与视频规则回退的权衡

### 最终方案

已彻底移除 `GlobalSystemMediaTransportControlsSessionManager`（GSMTCSM）依赖。

Windows 上当前策略改为：

1. **WASAPI 音频检测为前提**：通过 `windows` crate 枚举系统音频输出会话，判断是否有程序正在发声。
2. **无音频输出 → 不活跃**：接受静音看视频/直播被误判为不活跃。
3. **有音频输出 → 检查音频输出进程排除列表**：每个音频输出会话的进程名在排除列表内（如系统提示音、会议软件）→ 不活跃；任一非排除列表中的进程正在发声 → 活跃。

### 为什么放弃 GSMTCSM

- GSMTCSM 只能检测暴露媒体会话的应用，很多直播客户端、网页播放器并不暴露。
- GSMTCSM 的 Playing/Paused 状态与「用户是否在看屏幕」不完全对应。
- 引入 WASAPI 音频检测后，「有没有声音」成为更稳定的入口条件；再结合音频输出进程排除列表，逻辑更简单、可预测。

### macOS / Linux 状态

系统级音频检测 API 尚未实现，因此 macOS / Linux 上媒体计入活跃功能暂时不可用（`is_media_active` 恒返回 `false`）。后续会统一接入跨平台音频捕获方案。

### 当前状态

已落地。Windows 上排除列表可在 Settings 页的「视频与音乐」卡片中编辑（开关开启时显示）；macOS / Linux 仅显示开关占位，规则匹配已完全移除。
