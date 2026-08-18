# Toast 只从 Event Bus 渲染内容

## 数据流

```
Producer (water/eye/rest/agent/update)
    → EventBus.publish(BusEvent)
        → ensure_toast_window_visible（无内容）
        → emit catrace:event
            → ReminderToast.handleBusEvent
                → addNotification（既有 UI/合并/计时逻辑）
```

## 谁负责什么

| 组件 | 职责 |
|------|------|
| `EventBus::publish` | 校验、registry、ensure 窗、emit |
| `ensure_toast_window_visible` | 预创建/显示 Toast 窗、路由 hash |
| `ReminderToast` | 唯一内容渲染；水合 active events |
| 主窗 `eventHub` | 调试/观察，**禁止**再弹一张卡 |

## 仍非 Bus 的通道

| 通道 | 用途 |
|------|------|
| `catrace:dismiss-agent-session` emit | UserPromptSubmit / 同 session 审批顶替后销 sticky+permission UI（**已非 eval**） |
| popup / fullscreen | 久坐非 toast 模式，不经 bus |

> rest-timer 内容路径已迁 Bus（`reminder.rest.timer` upsert）；进度仍由 settle 驱动。

## 防双弹

- 生产者不得再 `eval addToastNotification`（已移除调用）
- Toast 用 `seenBusEventIds`；resolved 事件会关掉对应 `eventId` 卡
- sticky agent 合并逻辑仍在 `addNotification` 内，与 bus 无关

## 改 Toast 时

1. 新内容类型优先加 BusEvent + handleBusEvent 映射
2. 不要恢复 `addToastNotification` 全局函数做主路径
3. dismiss 类副作用用专用 emit（如 `catrace:dismiss-agent-session`），只传 id，不传整卡 UI 数据
4. 卡片 UI：`Rest/Water/Update/RestTimer/Eye/Agent/PermissionToastCard`；`ReminderToast` 只管堆叠、尺寸、总线映射

相关：[[toast-window]] · [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md)
