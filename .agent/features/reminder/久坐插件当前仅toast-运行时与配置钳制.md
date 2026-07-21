# 久坐插件当前仅 toast：运行时与配置钳制

## 一句话

产品侧久坐提醒只走 Event Bus toast；mode 读写与通知分发均钳制为 toast，fullscreen/popup 基础设施保留未删。

## 行为契约

1. **可见权威仍是 Toast 窗** — `reminder.rest.due` / `reminder.rest.timer` 经 bus 发布，hub 不渲染第二张卡。
2. **`show_notification` 无 mode 分支** — 始终 `DisplayMode::Toast` + `event_type: reminder.rest.due`。
3. **mode API 钳制** — 读/写 `reminder_mode` 时非 `toast` 一律当作 / 写成 `toast`。
4. **面板软迁移** — 打开 `RestPluginPanel` 时若库内仍是 popup/fullscreen，写回 toast。
5. **测试路径** — `testNotification` 始终追加 rest-timer 测试卡（不再 `if mode == toast`）。

## 涉及文件

| 文件 | 职责 |
|------|------|
| `src/components/plugins/RestPluginPanel.vue` | 仅节奏 + 内容 + 测试；`onMounted` 迁移 |
| `src-tauri/src/rest_plugin.rs` | toast-only `show_notification`；测试 always emit timer |
| `src-tauri/src/lib.rs` | `get_reminder_mode` / `set_reminder_mode` 钳制 |
| 保留未接：`create_popup_window` / `create_fullscreen_window`、fullscreen settings | 后续重启用 |

## RestPluginPanel 当前区块

1. **节奏** — `window_minutes` / `break_minutes` / `snooze_interval_minutes`
2. **内容** — `reminder_title` / `reminder_body`
3. **测试** — `testNotification`（按钮在内容区外）

UI 开关：`plugin_rest_ui_enabled`（plugin-store，不进 SQLite）。

## 重新启用 fullscreen 时 checklist

1. 取消 `get/set_reminder_mode` 钳制
2. `show_notification` 恢复 mode 分支（或 Host API 委托）
3. 面板加回方式选择与全屏配置
4. 去掉 `onMounted` 强制 toast 迁移（或改为可选）
5. 确认 `create_fullscreen_window` 调用链与媒体卡联动

## 相关

- 决策：[2026-07-21-久坐插件暂只支持toast不启用fullscreen.md](../../decisions/2026-07-21-久坐插件暂只支持toast不启用fullscreen.md)
- 配置入口：[久坐提醒配置从系统设置收敛到-RestPluginPanel.md](../settings/久坐提醒配置从系统设置收敛到-RestPluginPanel.md)
- 插件边界：[rest-reminder-builtin-plugin-boundary.md](../../architecture/desktop-event-os/rest-reminder-builtin-plugin-boundary.md)
