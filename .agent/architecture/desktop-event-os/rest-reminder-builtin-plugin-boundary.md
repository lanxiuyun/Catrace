# 久坐提醒内置插件边界

> 2026-07-21：从 `lib.rs` 抽到 `rest_plugin.rs`；同日产品侧暂只启用 toast。

## 边界

`src-tauri/src/rest_plugin.rs` 负责：

- `ReminderState`（snooze / skip / break timer）
- 久坐相关 invoke commands（command 名保持不变）
- 分钟结算 `on_minute_settled` 入口
- `reminder.rest.due` / `reminder.rest.timer` Event Bus 发布
- 测试通知路径
- **当前仅 toast**：`show_notification` 固定 publish toast；不再按 mode 分支 popup/fullscreen

仍由 `src-tauri/src/lib.rs` 负责：

- Signal/监听/窗口与宿主生命周期
- Event Bus 创建与 Tauri state 注入
- popup/fullscreen 窗口基础设施（保留，暂不由 rest 插件调用）
- 分钟循环里回调 `rest_plugin::on_minute_settled`

## 契约不变

- 对外 invoke command 名不变
- 配置键名不变（含 `window_minutes`、`break_minutes`、`snooze_interval_minutes`、`reminder_*`、`fullscreen_*`）
- Event 类型不变（`reminder.rest.due`、`reminder.rest.timer`；kind 为 `rest` / `rest-timer`）
- Toast 仍是可见权威；bus 失败不挡既有路径约定
- 业务配置仍进 SQLite；UI 开关等非核心走前端 Store

## 备注

popup/fullscreen 窗口与 `fullscreen_*` settings API 仍在 Host 侧保留，待重新接入时再启用；`get/set_reminder_mode` 现阶段将非 toast 钳制为 toast。
