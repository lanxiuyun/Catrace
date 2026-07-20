# 2026-07-21 插件测试连点卡死修复（supersede + Blob 卡缓存）

## Session goal

Demo Timer 测试通知可连点，Toast 不卡死；巩固 M10 手测。

## Completed

- 根因：同 dedupe publish → Superseded 卸载 PluginHostCard → Blob 重挂载卡死
- 修复：supersede 不卸卡；plugin/sdk 原地 upsert；HostCard 按 plugin id 缓存
- 测试按钮去掉每次 `loadExternalPlugins` + 1s 限流；load 侧 fingerprint/force
- 用户确认：插件 Toast 正常显示、连点可用

## Remaining

- M10.2 iframe/ACL；M9.1 SSE/webhook（可选）
- 可选：把 supersede 不卸卡提升为所有 kind 的统一约定并补单测

## Key file changes

| File | Change |
|------|--------|
| `ReminderToast.vue` | superseded 跳过卸载；plugin upsert |
| `PluginHostCard.vue` | plugin-id 组件缓存 |
| `Plugins.vue` | 测试只 publish |
| `loadExternalPlugins.ts` | single-flight + fingerprint |
| `.agent/bugs/2026-07-21-…` | 踩坑真源 |
| `m10-external-plugins.md` | 约定写入架构文 |
