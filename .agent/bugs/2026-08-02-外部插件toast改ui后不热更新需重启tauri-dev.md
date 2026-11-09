# 2026-08-02 外部插件 toast 改 ui.mjs 后不热更新需重启 tauri dev

## 症状

改磁盘上外部插件的 `ui.mjs`后，插件页点刷新或「测试」仍显示旧卡片 UI，必须重启 `pnpm tauri dev` 才生效。

## 根因

1. Toast 是**独立 WebView + 独立 Pinia**，与主窗 registry 不同步。
2. `PluginHostCard` 用进程级 Map 按 **plugin id** 缓存已 `defineAsyncComponent` / Blob `import` 的组件；`clearPluginHostCardCache()` 只清 Map，**已挂载实例不会重 resolve**。
3. 旧 reload 顺序：先 clear cache 再 `loadExternalPlugins({ force })`，remount 时 registry 仍可能是旧 Card。
4. 2026-07-21 为防测试连点卡死，测试按钮**禁止** `loadExternalPlugins`，热更路径被一并关掉。

## 修复约定（定稿）

| 层 | 做法 |
|----|------|
| `pluginHostCardCache.ts` | `clear` 时 `cardCacheGeneration`（Vue `ref`）+1 |
| `PluginHostCard.vue` | `cardKey = pluginId@g${gen}`；watch 后重新 `resolveCard()`；**不要**把 uiUrl 写进 cache key |
| Toast `ReminderToast` | 听 `catrace:reload-external-plugins`：**先** `loadExternalPlugins({ force: true })`，**再**把 live 通知的 `uiUrl` 换成 registry 新 blob，**最后** `clearPluginHostCardCache()` |

## 与 2026-07-21 连点卡死修复的关系

- 缓存按 plugin id、supersede 不卸卡、fingerprint 未变跳过重建 — **仍然有效**。
- 热更靠 **generation 强制 remount** + reload 时 registry 已换新 Blob；不是每次测试无脑 force thrash。
- `contentMtimeMs`（main/settings mtime）进 fingerprint 后，改 ui 会重建 blob，不必每次 force。

## 手测

1. 更新已启用插件源码后，触发宿主模块重载。
2. 重载完成后 registry 与 generation 应更新，Toast 使用新卡片。
3. 重复事件仍按 supersede / upsert 约定处理。

## 相关文件

- `src/components/pluginHostCardCache.ts`
- `src/components/PluginHostCard.vue`
- `src/views/toastWindows/ReminderToast.vue`
- [bootstrap.ts](../../src/app/bootstrap.ts)
- `src/plugins/loadExternalPlugins.ts`

## 相关

- [2026-07-21-插件测试连点卡死-toast-supersede卸载与blob重挂载.md](2026-07-21-插件测试连点卡死-toast-supersede卸载与blob重挂载.md)
- [2026-07-20-插件ui动态import-file-asset失败改blob加载.md](2026-07-20-插件ui动态import-file-asset失败改blob加载.md)
- [[toast-window]] [[plugin-center]] [[desktop-event-os]]
