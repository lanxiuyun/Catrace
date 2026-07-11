# 2026-07-11 护眼 Toast 加稍后/跳过按钮

## 目标

护眼提醒卡片原本只有关闭按钮，到点自动消失，用户没法主动延后。本次加上「稍后5分钟」「跳过本次」两个按钮，对齐喝水/休息提醒的交互。

## 完成

- 后端 `eye.rs`：`EyeReminderState` 加 `snooze_until` + `is_snoozed()`；新增命令 `snooze_eye_reminder(minutes)`、`skip_eye_reminder()`（跳过 = 推迟一个 `eye_interval`）；`check_and_notify` 加 snooze 过滤；补 `is_snoozed` 单测。
- `lib.rs` 注册两个新命令。
- 前端 `tauri.ts` 加 `snoozeEyeReminder` / `skipEyeReminder`。
- `EyeToastCard.vue` 渲染绿色正文 + 两个按钮，emit `snooze(minutes)` / `skip`；按钮文案复用 `reminder.snooze5` / `reminder.skip`。
- `ReminderToast.vue` 接线 `handleEyeSnooze` / `handleEyeSkip`；通用 body 渲染对 `eye` 加排除，避免与卡片自渲染正文重复。

## 踩坑：护眼正文渲染了两遍

第一版在 `EyeToastCard` 内加了绿色 `body-text`，忘了 `ReminderToast.vue` 通用模板对 `eye` 也会渲染黑色 `body-text`，结果同一段正文出现两次（绿+黑）。第一次误判去掉了卡片内绿色正文，用户纠正后恢复卡片内绿色正文，改为在通用模板加 `item.kind !== 'eye'` 排除。沉淀为 toast-window 子文档。

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `src-tauri/src/eye.rs` | snooze 状态 + 两个命令 + 结算过滤 + 单测 |
| `src-tauri/src/lib.rs` | 注册 snooze/skip 命令 |
| `src/api/tauri.ts` | snoozeEyeReminder / skipEyeReminder |
| `src/components/EyeToastCard.vue` | 绿色正文 + 稍后/跳过按钮 + emit |
| `src/views/ReminderToast.vue` | 接线 + 通用 body 排除 eye |

## 验证

- `pnpm vue-tsc --noEmit` 通过
- `cargo check` 通过
- `cargo test eye::` 2 个单测通过
- 手动：调试页「测试护眼提醒」按钮验证（未启动 dev server）
