# 空闲 CPU 过高：DeviceEvents 100µs 轮询

## 症状

重构 Event/Signal 后，应用空闲时 CPU 占用明显偏高（可占满一核量级）。

## 根因

`device_query::DeviceEvents`（`on_key_down`）在 Windows 上用约 **100µs** 间隔轮询 `GetAsyncKeyState`，并额外启动鼠标 poller。  
≈ 10k Hz × 2 线程，空闲也会烧 CPU。

历史决策 [2026-07-07-drop-rdev-for-device-query](../decisions/2026-07-07-drop-rdev-for-device-query.md) 选 `device_query` 是为了避开 rdev 钩子，但 **`DeviceEvents` API 本身不适合常驻后台**。

## 修复（commit `f3345ed`）

- 文件：`src-tauri/src/signal.rs`
- **不再**使用 `DeviceEvents` / `on_key_down`
- 自管键盘边沿：`get_keys()` + `KEY_POLL_INTERVAL = 50ms`
- 保留 legacy：键 2s 去重写入 `ActivityState.count`；鼠标仍约 1Hz 位移采样

## 验证

- 重启后空闲 1–2 分钟，任务管理器 CPU 应明显下降
- 打字时 CPU 可短暂上升，松手回落
- 活跃结算 / 休息判定语义不变

## 相关

- [[input-monitoring]] · [[platform-input]] · [[desktop-event-os]]
