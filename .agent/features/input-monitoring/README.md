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

## 键盘监听

所有平台统一使用 `device_query::DeviceState::on_key_down()` 事件回调。  
对 **活跃判定**：2 秒去重，同一窗口内多次按键只计 1 次活动。  
对 **Signal**：每次 keydown 增加 `key_count`；键序列需设置 opt-in。

## 鼠标采样

约 1Hz 采坐标算欧氏位移（只落距离）。  
对 **活跃判定**：仍按约 2 秒窗口「是否发生过移动」最多 +1，避免提高 `count>=3` 灵敏度。

## 子文档

- （历史）device_query 选择见 decisions `2026-07-07-drop-rdev-for-device-query`
