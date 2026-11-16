# 插件 sticky 卡的 action 回传与卸卡

外部 Card 动作只请求 Bus resolve，不在本地先卸一次卡。sidecar 可按同一 dedupe key 回传更新；提前卸卡会将 leave 动画、动态模块挂载与窗口缩放叠在一起。

## 规则

[busEvents.ts](../../../src/app/windows/toast/busEvents.ts) 对 resolved 事件执行：

| 条件 | 行为 |
|---|---|
| superseded | 保留可见卡，等待 active upsert |
| sticky 插件卡的 action，id 不是 `end`／`dismiss` | 留卡供插件回传 |
| `end`／`dismiss` action 或 dismissed／completed 等其它结束 | 正常移除 |

[controller.ts](../../../src/app/windows/toast/controller.ts) 的 handlePluginAction 仅调用 markEventResolved；同 id 或 dedupe key 的 active 由总线层原地更新，避免两次卸卡和 Blob 重新导入。

插件要“动作后继续显示”时使用稳定 action id 并负责回传；要结束则使用 `end`／`dismiss` 或 onClose。宿主不根据业务名称维护特例名单。回传协议见[sidecar](../../architecture/desktop-event-os/plugin-native-sidecar-runtime.md)。
