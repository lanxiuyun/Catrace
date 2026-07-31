# 插件 sticky 卡：action 回传时只对 echo 留卡，dismiss 仍卸卡

## 背景

外部插件 Toast 走 `PluginHostCard` + bus。sidecar 类插件常在 action resolve 后立刻用同一 `dedupe_key` 再 publish（roundtrip）。若 resolved 时卸卡，会与 leave 动画/窗口缩放竞态，Windows 上易冻透明 toast。

## 规则

在 `ReminderToast.vue` 的 `handleBusEvent`，`status === 'resolved'` 分支：

| resolution | 行为 |
|------------|------|
| `superseded` | 不卸卡；等后续 active upsert |
| `action` + `action_id === 'echo'` + sticky 插件卡 | **留卡**，等 roundtrip upsert |
| 其它 `action`（如 `dismiss`）/ `dismissed` / `completed` / … | `removeNotification` |

`handlePluginAction`：

- 只调用 `markEventResolved(eventId, actionId)`
- **禁止**再本地 `removeNotification`（避免双卸卡）

`markEventResolved`：

- 无 `actionId`（dismiss 路径）可先 `seenBusEventIds.add`
- 有 `actionId` 时不要提前把 id 当“已见”堵死后续 active（roundtrip 会换新 event id）

## 插件作者注意

- 需要「点了按钮卡还在、内容刷新」的 roundtrip：action id 用稳定名，并在宿主约定 keep 列表中（当前 demo 为 `echo`）；或改用 **不卸卡的 update/upsert** 语义而不是 resolve+re-publish。
- 需要「点了就关」：用独立 action id（如 `dismiss`），或走 close → dismissed；不要复用 keep 名单里的 id。

## 相关

- 故障记录：[.agent/bugs/2026-07-31-sidecar-echo回传动作导致toast卡死与完成关不掉.md](../../bugs/2026-07-31-sidecar-echo回传动作导致toast卡死与完成关不掉.md)
- Sidecar 设计：[[desktop-event-os]] / [plugin-native-sidecar-runtime.md](../../architecture/desktop-event-os/plugin-native-sidecar-runtime.md)
