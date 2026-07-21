# 久坐插件暂只支持 toast，不启用 fullscreen

## 状态

Accepted — 2026-07-21

## 背景

久坐提醒历史上支持 `toast` / `popup` / `fullscreen` 三种 `reminder_mode`。popup UI 已先下线；fullscreen 窗口与 settings API 仍在。产品要求：

> 当前久坐提醒插件可以先不支持全屏提醒，只支持通知提醒。

需要在「立刻简化产品面」和「不拆掉可复用的全屏基础设施」之间取舍。

## 决策

**产品 / 运行时强制 toast-only；popup/fullscreen 窗口与 API 代码保留，暂不由 rest 插件调用。**

具体：

| 层 | 行为 |
|----|------|
| UI | `RestPluginPanel` 去掉提醒方式与全屏配置；只保留节奏 / 内容 / 测试 |
| 迁移 | 面板 `onMounted`：若 mode ≠ toast 则 `setReminderMode('toast')` |
| 运行时 | `rest_plugin::show_notification` 固定 publish `reminder.rest.due` toast，不再读 mode 分支 |
| API | `get_reminder_mode` / `set_reminder_mode` 将非 toast 钳制为 toast |
| 测试 | `test_notification` 始终发 rest-timer 测试卡（不再 gate 在 toast mode） |
| 保留 | `create_popup_window` / `create_fullscreen_window`、fullscreen settings API、i18n 全屏文案 |

## 不做什么

- 不删除 fullscreen/popup 窗口、路由、DB 键
- 不清理仅 fullscreen 使用的 i18n（随彻底删除一并清）

## 后果

- 用户无法从 UI 或 API 再启用全屏/弹窗久坐提醒
- `cargo check` 可能对未调用的 `create_*_window` 报 `dead_code`（预期）
- 重新接入全屏时：恢复 mode 分支 + 面板 UI + 取消 API 钳制即可，不必重写窗口层

## 相关

- [[reminder]] [[fullscreen-reminder]] [[settings]] [[desktop-event-os]]
- 阶段性决策：[.agent/decisions/popup-removal-pending.md](popup-removal-pending.md)
- 边界：[rest-reminder-builtin-plugin-boundary.md](../architecture/desktop-event-os/rest-reminder-builtin-plugin-boundary.md)
