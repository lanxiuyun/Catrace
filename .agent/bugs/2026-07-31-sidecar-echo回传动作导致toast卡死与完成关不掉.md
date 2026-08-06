# 2026-07-31 sidecar-echo 回传动作导致 toast 卡死与完成关不掉

## 症状

1. 点击 sidecar-echo 卡片「回传 Sidecar」后，透明 toast 窗半透明卡住，按钮无响应。
2. 为修卡死后，一度出现「完成」点了关不掉；日志可见 `event is not active` 二次 resolve。

## 根因

动作链路：

1. 前端 `resolve_event_action`
2. Bus 发 `resolved`（`resolution.kind = action`）
3. toast 卸卡（leave 动画 + `isAnimating` + 窗口缩放）
4. sidecar 收到 stdin `resolved` 后用同一 `dedupeKey: sidecar-echo:tick` 再 publish

问题叠加：

- **双卸卡**：`handlePluginAction` 本地 `removeNotification` + bus `resolved` 再卸一次。
- **同 key 快速替换**：leave 动画中又 upsert/挂载 PluginHostCard（Blob UI），Windows 透明 toast 窗易冻住。
- **修 freeze 过宽**：曾对所有 sticky 插件 `action` resolve 都 `keep` 卡片，导致 `dismiss` 也不卸卡。

## 修复约定（现行）

文件：`src/views/toastWindows/ReminderToast.vue`

1. `handlePluginAction` **只** `markEventResolved`，不本地卸卡。
2. bus `resolved` 且 `resolution.kind === 'superseded'`：**不卸卡**（留给后续 active upsert）。
3. 仅当同时满足时 **保留卡片**：
   - 有 `pluginId`
   - sticky
   - `resolution.kind === 'action'`
   - `resolution.action_id === 'echo'`
4. 其它 action（含 `dismiss`）以及 dismissed/completed：**正常 `removeNotification`**。
5. 同 `event.id` / `dedupe_key` 的 plugin 事件走 **原地 upsert**，避免 PluginHostCard 因插件身份变化重载。

sidecar demo：`tools/plugin-demo/sidecar-echo/runtime/main.mjs` 在 `actionId === 'echo'` 时延迟 ~400ms 再 publish roundtrip。

## 验收

- 回传 Sidecar：卡不消失、序号/来源更新为 `action-roundtrip`，窗不卡死。
- 完成：卡片滑出关闭。
- 连点回传多次：不冻窗。

## 排查日志关键字

前端 toast console：

- `[sidecar-demo] action click`
- `[PluginHostCard] action`
- `[sidecar-action] toast action`
- `[sidecar-action] resolve invoke:start|done|error`
- `[sidecar-action] resolved handling`（看 `keepForActionRoundtrip`）
- `[sidecar-action] upsert in place`

Rust：

- `resolve action start/emitted/done`
- `forward resolved`
- `write resolved stdin start/done`
