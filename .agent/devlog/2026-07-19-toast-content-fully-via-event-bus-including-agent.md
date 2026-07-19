# 2026-07-19 Toast 内容全量经 Event Bus（含 agent/permission/update）

## Session goal

把剩余 eval 注入的 Toast 内容（agent / permission / update）迁到 Event Bus，使 Toast 成为统一渲染线。

## Completed

- `create_agent_toast_window` / `create_agent_permission_window` / `create_update_toast_window` 改为 `bus.publish`
- `ReminderToast` 订阅并渲染 agent/permission/update；去掉 `addToastNotification` 主路径
- rest/water/eye 此前已迁 bus；测试按钮验证单卡正常
- 更新 roadmap / manifest current

## Remaining

- 真机验 agent sticky 合并、permission 审批回传
- 设置页按 pluginRegistry 挂载
- rest-timer / dismissAgentSession 是否也协议化（可选）

## Key file changes

| File | Change |
|------|--------|
| `reminder_toast.rs` | agent/update/permission → bus |
| `ReminderToast.vue` | handleBusEvent 扩 kind；去 addToastNotification |
| desktop-event-os docs | 约定与进度 |

## Decisions

- 内容与窗口分离；eval 仅保留会话销项等非内容指令
- sticky/permission 业务语义仍在前端 addNotification，不重写合并逻辑
