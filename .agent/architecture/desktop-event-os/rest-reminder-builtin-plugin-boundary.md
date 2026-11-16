# 久坐提醒内置插件边界

## Rust 职责

[rest_plugin.rs](../../../src-tauri/src/rest_plugin.rs) 负责 `ReminderState`（snooze / skip / break timer）、久坐 commands、分钟结算 `on_minute_settled` 和测试通知。

- `reminder_mode=toast` 时，提醒与计时经 Event Bus 发布 `reminder.rest.due` / `reminder.rest.timer`。
- `reminder_mode=fullscreen` 时调用宿主全屏窗口，在光标所在监视器展示倒计时；全屏期间不叠加 rest-timer Toast。

[lib.rs](../../../src-tauri/src/lib.rs) 负责 Signal、监听、窗口 / 宿主生命周期、Bus state、提醒方式与全屏配置 commands，以及分钟循环中调用久坐插件。

## 配置与 UI

- 启用状态、工作 / 休息时长、推迟时长与提醒文案由 `RestPluginConfig` 保存到 Store 的 `plugin_config:rest`。
- 提醒方式与全屏背景、透明度、填充等宿主窗口参数由 SQLite settings 保存。
- 配置入口：[Plugins.tsx](../../../src/app/pages/Plugins.tsx) / [RestSettings.tsx](../../../src/app/pages/plugins/RestSettings.tsx)。
- 提醒方式支持 `toast` / `fullscreen`，行为详见[久坐提醒](../../features/reminder/README.md)。

## 协作边界

- Toast 订阅 Bus 展示内容，主窗 Hub 不渲染第二张卡。
- 窗口创建、定位、前台状态和多监视器处理留在宿主窗口层，不混入提醒判定。
- Event 类型使用 `reminder.rest.due` / `reminder.rest.timer`，kind 为 `rest` / `rest-timer`。
