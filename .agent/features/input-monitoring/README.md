# 键鼠输入监听

后台静默监听键鼠活动，实时累积活动次数，供每分钟结算判定活跃/休息。

> **Step 2 起**：采样实现下沉到 `src-tauri/src/signal.rs`。  
> legacy `ActivityState.count` 语义不变（键 2s 去重 + 鼠标 2s 移动门闩）。  
> 扩展指标（前台频次、键序列、鼠标位移）见 [[desktop-event-os]]  
> [signal-collection-schema-and-privacy.md](../../architecture/desktop-event-os/signal-collection-schema-and-privacy.md)。

## 涉及文件

- `src-tauri/src/signal.rs` — 键盘 / 鼠标 / 前台采样线程 + 分钟桶
- `src-tauri/src/lib.rs` — `ActivityState`、settle、启动门闩（accessibility）
- `src-tauri/src/reminder_toast.rs` — 仅用 `DeviceQuery::get_mouse()` 获取屏幕尺寸计算 Toast 窗口位置

## 键盘监听（2026-07-20 起）

**不要**用 `device_query::DeviceEvents` / `on_key_down` 做常驻监听：Windows 上约 100µs 轮询，空闲 CPU 过高。  
见 [2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md](../../bugs/2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md)。

当前实现：

- `DeviceState::get_keys()` + **`KEY_POLL_INTERVAL = 50ms`** 自管边沿（刚出现的 keycode）
- **活跃判定**：2 秒去重，同一窗口内多次按键只计 1 次活动（`ActivityState.count`）
- **Signal**：每次边沿 `key_count++`；键序列需设置 opt-in

## 鼠标采样

约 1Hz 采坐标算欧氏位移（只落距离）。  
对 **活跃判定**：仍按约 2 秒窗口「是否发生过移动」最多 +1，避免提高 `count>=3` 灵敏度。

## 子文档 / 决策

- 历史：弃 rdev 选 device_query — [2026-07-07-drop-rdev-for-device-query](../../decisions/2026-07-07-drop-rdev-for-device-query.md)（API 选型仍成立；**轮询粒度**必须自管）
