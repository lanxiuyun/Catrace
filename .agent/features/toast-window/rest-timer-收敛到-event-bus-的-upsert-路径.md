# rest-timer 收敛到 Event Bus（upsert 路径）

## 背景

Step2 路线图一句话进度里，Toast 内容路径已全部经 Bus，仅 `dismissAgentSession` 与 `rest-timer` 仍用专用通道。
`rest-timer` 原先走 `emit_to(..., "catrace-rest-timer")`，Toast 窗单独 listen，与 rest/water/eye 渲染线分裂。

## 做法

### 后端

- 新增 `EventBus::upsert_by_dedupe_key`：有同 `dedupe_key` 的 active 事件则 `update`（同 id 升 revision），否则 `publish`。
  - **为什么不用每次 publish + supersede？** rest-timer 每分钟（测试时连点）刷新；supersede 会 resolved 旧 id + 新 id，前端易闪烁/抖窗。
- 统一入口 `emit_rest_timer_event`：
  - `event_type = reminder.rest.timer`
  - `kind = rest-timer`
  - `dedupe_key = reminder.rest.timer`（全局单卡）
  - `sticky = true`
  - payload：`break_minutes / rest_start_ts / rest_streak / remaining_minutes / is_complete`
- 调用点：settle 休息分钟、`test_notification` Toast 模式。
- `dismiss_rest_timer`：清 `break_timer_active`，并 resolve 上述 dedupe 事件（Dismissed）。

### 前端 `ReminderToast.vue`

- 删除 `catrace-rest-timer` listen。
- `handleBusEvent` 接受 `rest-timer`；**不**走 `seenBusEventIds` 短路（同 id 的 update 要能刷新）。
- 仍用 `updateRestTimer` 原地改卡 + 2s 活跃轮询。
- 手动关闭 / 恢复活跃延迟移除：继续 `dismissRestTimer()`，并 `markEventResolved`，避免 active 水合后重新冒卡。

## 手测

1. 设置 → 测试通知（Toast 模式）：应出现久坐卡 + 休息计时卡；连点受 1s 限流，计时卡应原地刷新不崩。
2. 真休息路径：触发休息后出现计时卡；到点完成文案变化；恢复键鼠约 4s 后消失且不再自动冒出。
3. 关卡后 `get_active_events` 无 `reminder.rest.timer`。

## 仍未做

- water/eye 插件 UI
- Toast 无限制连点堆叠抗崩（仍依赖 1s 限流）
