# 插件 action 回传不能触发双卸卡

插件 Card 请求 resolve action 后，Bus 会发 resolved，sidecar 还可能立刻按同 dedupe key 发布新内容。若前端先本地卸卡、再由 Bus 卸一次，就会叠加离场动画、窗口 resize 和动态组件挂载。

## 宿主约束

- controller 的 handlePluginAction 只调用 Bus resolve，不先 removeNotification。
- superseded 保留可见卡，后续 active 原地更新。
- sticky 插件 action 在 action id 不是 end／dismiss 时留卡供 roundtrip；真正结束按总线结果正常移除。
- 不把所有 action 都当成 dismiss，也不把所有 sticky action 永久留住。

实现以 [busEvents.ts](../../src/app/windows/toast/busEvents.ts) 和 [controller.ts](../../src/app/windows/toast/controller.ts) 为准；回传规则见[sticky 动作](../features/toast-window/插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md)。调试同时对照插件 action、Bus resolved、sidecar stdin 与后续 active 的顺序。
