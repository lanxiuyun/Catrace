# 外部插件 Toast 卡热更新：generation 缓存与 reload 顺序

开发期改 `ui.mjs` 后，插件页刷新/测试应让已打开的 Toast 卡换上新 Blob UI，无需重启 `pnpm tauri dev`。

## 为什么不能只 clear Map

`PluginHostCard` 把异步组件缓存在进程级 Map 里，避免 supersede/原地 upsert 时反复 Blob import（见 2026-07-21 卡死修复）。
只 `Map.clear()` 时，**已经 mount 的** `cardComp` 仍指向旧组件；必须让 key 变化触发 re-resolve。

## generation 约定

- `clearPluginHostCardCache()`：`cardCache.clear()` + `cardCacheGeneration.value += 1`
- generation 必须是 Vue **`ref`**（普通 number 进不了 computed 依赖）
- `cardKey = \`${pluginIdentity()}@g${cacheGen.value}\``
- cache **key 仍是 plugin id**，不含 uiUrl；权威是 reload 后 registry 里的 Card

## reload 事件顺序（Toast 窗）

事件：`catrace:reload-external-plugins`（主窗刷新/测试 emit）

1. `loadExternalPlugins({ force: true })` — 重建 registry + 新 blob URL
2. 遍历 live `notifications`：有 `pluginId` 且未 leaving → 用 registry 更新 `n.uiUrl`
3. `clearPluginHostCardCache()` — generation++ → 已挂载卡 remount，resolve 到新 Card

**禁止**先 clear 再 load（remount 会命中旧 registry）。

## 谁该 emit reload

| 入口 | load | emit |
|------|------|------|
| 插件页刷新 | `force: true` | 是 |
| 插件页「测试」 | 无 force（mtime fingerprint） | 是 |
| 开关外部插件 | `loadExternalPlugins()` | 当前可不 emit（无 live 卡需求时） |

测试路径不要每次 force：避免无改动时 revoke 活 blob；有磁盘 mtime 变化时 fingerprint 会变并重建。

## 与主窗的关系

主窗 / Toast 各有 Pinia。主窗 load 只更新主窗 registry；Toast 必须自己 force load 或接收 reload 后再 load。
`PluginHostCard` 缓存是模块级单例，在**同一 WebView** 内 generation 才驱动 remount；Toast 独立 WebView 必须靠本窗的 reload 监听。

## 手测要点

改 demo `ui.mjs` → 刷新或测试 → 新文案/样式出现；连点测试不卡死。

## 相关

- [2026-08-02-外部插件toast改ui后不热更新需重启tauri-dev.md](../../bugs/2026-08-02-外部插件toast改ui后不热更新需重启tauri-dev.md)
- [[plugin-center]] 刷新/测试入口
