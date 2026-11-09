# Event Protocol 与 Bus 生命周期

## 协议

- `event_type` 是稳定协议名，如 `reminder.rest.due` / `agent.permission` / `system.update.available`。
- `kind` 决定渲染族：`rest` / `rest-timer` / `agent` / `permission` / `update` / `sdk` 或外部插件 kind。
- `source` 为 internal / agent_hook / sdk，或带 name 的 plugin。
- `status` 为 active / resolved；revision 单调递增，时间戳为毫秒。
- `resolution.kind` 为 completed / dismissed / action / expired / superseded。
- kind 的业务字段放在 payload，如 boundary、sessionId、requestId、version。

类型与实现以 [event.rs](../../../src-tauri/src/event.rs) / [bus.rs](../../../src-tauri/src/bus.rs) 为准。

## dedupe 与 upsert

`publish` 遇到非空 dedupe key 时，先 resolve 同 key 的 active 事件为 superseded，再发布新事件。Toast 对 superseded 保留可见卡，后续 active 按 id / dedupe key 原地更新。

- 真实久坐提醒：`reminder.rest.due:{boundary}`。
- 测试久坐：boundary 为 0 时可不设 key，允许堆叠，另有 1 秒测试限流。
- 休息计时：`upsert_by_dedupe_key` 使用 `reminder.rest.timer`，同事件更新 revision，避免 supersede 重挂载。

## Commands

| Command | 作用 |
|---|---|
| `publish_event` | 规范化后写 registry、发送 `catrace:event`；Toast 模式确保窗口可见 |
| `update_event` | 应用允许的 patch |
| `resolve_event` / `resolve_event_action` | 记录 resolved 生命周期，不执行业务副作用 |
| `get_active_events` | 窗口水合 |

并发边界：registry mutate + clone 后释放锁，再执行窗口 ensure / emit，避免窗口调用阻塞 registry。

## 生产者与消费方

| 来源 | 事件 / kind | 入口 |
|---|---|---|
| 久坐 Toast / 计时 | `reminder.rest.due` / `reminder.rest.timer` | [rest_plugin.rs](../../../src-tauri/src/rest_plugin.rs) |
| Agent / 审批 / 更新 | agent / permission / update | [reminder_toast.rs](../../../src-tauri/src/reminder_toast.rs) |
| SDK / 外部插件 | sdk / plugin kind | [event_http.rs](../../../src-tauri/src/event_http.rs)、[plugin_commands.rs](../../../src-tauri/src/plugin_commands.rs) |

Toast 窗监听 `catrace:event` 并调用 `getActiveEvents` 水合；主窗 Hub 只观察，不驱动 Toast。用户动作由对应业务 command 完成后 resolve。

新增内部 kind 时，补生产者 publish、Toast 事件接受与模板分支、专用卡片；外部插件通过 registry 提供自定义 Card。详见[Toast 渲染入口](toast-renders-only-from-event-bus.md)与[外部插件合同](m10-external-plugins.md)。
