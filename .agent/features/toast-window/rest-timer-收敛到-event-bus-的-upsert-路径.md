# 休息计时的 Bus upsert

休息计时是全局单卡：`event_type=reminder.rest.timer`、`kind=rest-timer`、`dedupe_key=reminder.rest.timer`、sticky=true。payload 含 break_minutes、rest_start_ts、rest_streak、remaining_minutes 和 is_complete。

## 后端

[rest_plugin.rs](../../../src-tauri/src/rest_plugin.rs) 结算与 Toast 测试路径发布计时状态。`EventBus::upsert_by_dedupe_key` 对现有 active 事件 update，保持 id 并增加 revision，避免每分钟 supersede 后再挂新卡。dismiss_rest_timer 清业务状态并 resolve 当前事件。

## React 前端

- [busEvents.ts](../../../src/app/windows/toast/busEvents.ts) 对 rest-timer 分流，不受 seen id 短路影响，同一事件的新 revision 必须刷新。
- [restTimer.ts](../../../src/app/windows/toast/restTimer.ts) 原地更新计时卡，并轮询活跃状态，卸载时清理轮询。
- [RestTimerToastCard.tsx](../../../src/components/RestTimerToastCard.tsx) 与 [RestTimerBall.tsx](../../../src/components/RestTimerBall.tsx) 只展示状态。
- 手动关闭或恢复活跃后移除时，先 dismiss 业务计时并 resolve，避免下一次 active 水合重新出现。

验证应覆盖：测试与真实休息原地更新、恢复活跃后消失、关闭后 get_active_events 不再含该计时事件，以及组件卸载不遗留轮询。
