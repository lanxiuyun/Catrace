# 2026-07-21 插件测试连点卡死 Toast：supersede 卸载 + Blob 卡重挂载

## 症状

功能插件 → Demo Timer → **发送测试通知** 连点两次，Toast 窗口假死/卡死。  
第一次通常正常；第二次 publish 后卡死。日志可见第二次只打出 `bus event`，`adjustWindowSize` 不一定再跑完。

## 根因链路

同 `dedupe_key` 再次 `publish` 时，Bus 会：

1. 对旧 active 事件 `resolve(Superseded)` 并 emit  
2. 再 emit 新 active 事件（**新 UUID**）

Toast 前端旧逻辑：

1. 收到 `status=resolved` → **无条件** `removeNotification` → 卸载 `PluginHostCard`  
2. 收到新 active → 再挂一张新卡 → 重新 `defineAsyncComponent` / Blob `import`  
3. 若测试按钮还 `loadExternalPlugins()`：撤销 Blob URL + 全量重扫 → 正在显示的卡引用失效  

连点 = **拆装动态插件卡 + 窗口 ensure/resize**，与久坐连点卡死同类，但触发点在 **supersede 卸载** 和 **插件 UI 重载**，不只是 resize 并发。

## 修复（定稿约定）

| 层 | 做法 |
|----|------|
| FE `handleBusEvent` | `resolution.kind === 'superseded'` → **不卸载**可见卡；等后续 active 原地 upsert |
| FE sdk/plugin | 同 `eventId` **或** 同 `dedupe_key` → 原地刷新字段，不 `remove+add` |
| `PluginHostCard` | 按 **plugin id** 缓存组件实例；`cardKey` 不跟 event id/revision 走 |
| 测试按钮 | **只** `publishEvent`；**禁止**每次测试 `loadExternalPlugins`；1s 限流（对齐 Rest） |
| `loadExternalPlugins` | 并发 single-flight；enabled 集合 fingerprint 未变则跳过 Blob 重建；用户刷新/开关才 `force` |

## 不要再做

- 不要把所有 `resolved` 都当成「用户关卡」——`superseded` 是替换，不是 dismiss  
- 不要在热路径上 revoke 正在显示的 Blob URL  
- 不要为「确保 toast 有 registry」在每次测试时主窗重载插件（toast 窗自有 Pinia，mount 时已 load）

## 手测

1. 启用 demo-timer → 点测试：出现 DEMO 卡  
2. 1s 内/外连点：同一张卡刷新，Toast 不卡死  
3. 点完成/关闭：卡消失且 bus resolve  
4. 刷新列表 / 开关插件：仍能加载卡  

## 相关文件

- `src/views/ReminderToast.vue` — supersede 跳过卸载；plugin/sdk 原地 upsert  
- `src/components/PluginHostCard.vue` — plugin-id 组件缓存  
- `src/views/Plugins.vue` — 测试按钮只 publish + 1s 锁  
- `src/plugins/loadExternalPlugins.ts` — fingerprint / force / single-flight  

## 相关

- [2026-07-20-久坐测试连点卡死-toast-窗口并发show与resize.md](2026-07-20-久坐测试连点卡死-toast-窗口并发show与resize.md)  
- [2026-07-20-插件ui动态import-file-asset失败改blob加载.md](2026-07-20-插件ui动态import-file-asset失败改blob加载.md)  
- [[desktop-event-os]] m10-external-plugins.md  
- [[toast-window]]
