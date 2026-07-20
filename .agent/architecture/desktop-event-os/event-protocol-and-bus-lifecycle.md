# Event Protocol 与 Bus 生命周期

## 协议要点

- `event_type`：稳定协议名（`reminder.water.due` / `agent.permission` / `system.update.available`）
- `kind`：渲染族，对齐 Toast 分支（`rest` | `water` | `eye` | `agent` | `permission` | `update`）
- `source`：`{ "type": "internal" | "agent_hook" | "sdk" }` 或 `{ "type": "plugin", "name" }`
- 生命周期：`status` active|resolved，`revision` 单调，时间戳 ms
- `resolution.kind`：completed | dismissed | action | expired | superseded
- kind 专属字段放 `payload`（如 boundary、sessionId、requestId、version）

## dedupe_key 行为（2026-07-20）

- `publish` 时若 `dedupe_key` 非空：将 registry 内**同 key 且 Active** 的事件 `resolve(Superseded)`，先 emit 这些 resolved，再入库并 emit 新事件
- 前端 Toast：`status === resolved` 时按 `eventId` 撤卡；新 active 若本地已有同 `dedupeKey` 可**原地刷新**
- 约定示例：
  - 真实久坐：`reminder.rest.due:{boundary}`（`boundary != 0`）
  - 测试久坐：`boundary == 0` 时生产者可**不设** key，允许堆叠（当前另有 1s 测试限流）
  - agent permission / update：既有 key 格式不变（`agent.permission:{request_id}` 等）

## Commands

| Command | 作用 |
|---------|------|
| `publish_event` | 规范化后入库 + emit `catrace:event`；toast 模式会 ensure 窗口 |
| `update_event` | 白名单 patch |
| `resolve_event` / `resolve_event_action` | 置 resolved（不执行业务副作用） |
| `get_active_events` | Toast / 主窗水合 |

锁：registry mutate + clone → **放锁** → ensure 窗口 / emit。

## 生产者 → Bus（当前）

| 来源 | event_type 例 | kind | 入口 |
|------|---------------|------|------|
| 久坐 toast | `reminder.rest.due` | rest | `lib::show_notification` |
| 喝水 | `reminder.water.due` | water | `water::show_water_notification` |
| 护眼 | `reminder.eye.due` | eye | `eye::show_eye_notification` |
| Agent 状态 | `agent.{event}` | agent | `reminder_toast::create_agent_toast_window` |
| 权限审批 | `agent.permission` | permission | `create_agent_permission_window` |
| 更新 | `system.update.available` | update | `create_update_toast_window` |

`create_toast_window`（eval 注入）已废弃未再调用，仅保留 dead_code。

## 前端

- **Toast 窗**：`listen('catrace:event')` + `getActiveEvents`；`seenBusEventIds` 防重复
- **主窗 hub**：观察用，不驱动 Toast
- 用户操作：先业务 command，再 `resolve_*`（有 `eventId` 时）

## 扩展新 kind

1. 生产者只 `bus.publish`，payload 约定写清
2. `ReminderToast.handleBusEvent` 的 `busKinds` 加入 kind
3. `addNotification` / 模板分支
4. 可选：`registerBuiltins` 登记 event_type 与设置卡

相关：[toast-renders-only-from-event-bus.md](toast-renders-only-from-event-bus.md) · [[toast-window]] · [[agent-notification]]

## rest-timer

- 走 `EventBus::upsert_by_dedupe_key`，`dedupe_key=reminder.rest.timer`，同卡 `update` 升 revision，避免 supersede 闪烁。
