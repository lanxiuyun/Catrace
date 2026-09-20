# 键鼠输入监听

后台静默监听键鼠活动，实时累积活动次数，供每分钟结算判定活跃/休息。

> **Step 2 起**：采样实现下沉到 `src-tauri/src/signal.rs`。  
> legacy `ActivityState.count` 语义不变（键 2s 去重 + 鼠标 2s 移动门闩）。  
> 扩展指标（前台频次、键序列、鼠标位移）见 [[desktop-event-os]]  
> [signal-collection-schema-and-privacy.md](../../architecture/desktop-event-os/signal-collection-schema-and-privacy.md)。

## 涉及文件

- `src-tauri/src/signal.rs` — 键盘 / 鼠标 / 前台采样线程 + 分钟桶
- `src-tauri/src/lib.rs` — `ActivityState`、settle、启动门闩（accessibility）；macOS 未授权时先跑兜底采样
- `src/components/AccessibilityBanner.vue` — 授权横幅组件仍在，主窗暂不挂载（兜底采样够用）
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

## macOS 无辅助功能权限时

更新器替换 ad-hoc 签名的 `.app` 后，TCC 授权常会静默失效，`device_query` 键鼠全 0，表现为「一直休息」。此时：

- 启动 `start_input_sampling_fallback`：`CGEventSourceSecondsSinceLastEventType` + 光标位置，按同样 2s 语义喂 `ActivityState.count`，久坐判定照常。
- 授权后停兜底、切完整采样。未授权期间按键次数为 0。
- 不弹授权横幅、设置页也不展示授权行。详见 [macos-无辅助功能权限时用系统空闲秒数兜底忙闲.md](macos-无辅助功能权限时用系统空闲秒数兜底忙闲.md)。

## 子文档

- [macos-无辅助功能权限时用系统空闲秒数兜底忙闲.md](macos-无辅助功能权限时用系统空闲秒数兜底忙闲.md) — 更新后 TCC 失效时的兜底；产品选择不催授权
- [待做-mac包要用Apple-Developer-ID签名才能更新后保留辅助功能授权.md](待做-mac包要用Apple-Developer-ID签名才能更新后保留辅助功能授权.md) — **后续**：正式签名 + 公证，更新后才不用再勾权限
- 不要加回 `rdev`：它在 Windows 装 `WH_KEYBOARD_LL`，和 Electron 等共用钩子链时会吞 Ctrl KeyRelease，滚轮变成缩放。全平台用 `device_query` 的 `get_keys()` 自管采样即可。
- 轮询粒度必须自管：见 [2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md](../../bugs/2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md)
