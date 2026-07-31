# 2026-07-31 sidecar-echo 迁移到统一 Rust 宿主 API

## Session goal

参考 `rubick-api.js`，让外部插件通过统一 `plugin` facade 使用 Rust 桌面能力，并让 `plugin.log` 同时进入宿主日志和主窗口 console。

## Completed

- 新增按插件 id 绑定的 `plugin` facade，注入 settings、Toast card 与 background 三类 Blob 模块。
- Rust 提供环境变量、文件/目录选择、进程启动、HTTP GET 和日志通用 command。
- `plugin.log.info/warn/error` 写统一 Rust 日志，并转发到主窗口 DevTools console。
- 保留 `plugin.sidecar.request()` 作为插件自定义 sidecar RPC，不再用它重复实现通用桌面原语。
- `sidecar-echo` Settings 已迁移到 `plugin.*`；Node runtime 只保留后台 Toast 与 action roundtrip。
- Rust、TypeScript、Vite 构建和 Demo ESM 语法检查通过。

## Pending

- 重启 Tauri 应用进行真机交互验收，重点确认 dialog、exe 启动、HTTP 与主窗口 console 日志。
- M15.3 sidecar storage request/response 与插件中心 runtime 状态继续按路线图推进。

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/plugins.rs` | 通用插件宿主原语与 `plugin_api_log` |
| `src/plugins/pluginApi.ts` | Rubick 风格 facade、源码包装和 console listener |
| `src/plugins/loadExternalPlugins.ts` | settings/UI 注入模块局部 `plugin` |
| `src/components/PluginHostCard.vue` | Toast card 回退加载路径注入 `plugin` |
| `src/views/toastWindows/PluginHost.vue` | background 模块注入 `plugin` |
| `tools/plugin-demo/sidecar-echo/settings.mjs` | 使用统一宿主 API |
| `tools/plugin-demo/sidecar-echo/runtime/main.mjs` | 删除重复桌面能力，只保留 sidecar 后台事件 |

## Newly completed host capabilities

- `plugin.dialog.showSaveDialog()` and `plugin.path.get()`.
- Clipboard and plugin-isolated JSON storage.
- `openExternal/openPath/showItemInFolder` shell operations.
- Platform, theme, and Event Bus-backed Toast notification.
- Rust implementation is centralized in `src-tauri/src/plugin_api.rs`; `plugins.rs` remains responsible for manifest scanning and lifecycle state.
## Vue component update crash fix

- Symptom: refreshing/re-registering an external Settings component could throw `getComponentPublicInstance(... exposed)` and `parentNode` errors inside Vue/Naive UI ResizeObserver updates.
- Cause: the registry temporarily unregistered live components and replaced them with new `defineAsyncComponent` wrappers while the Plugins page was rendering them. The external component also received a dynamic component ref that is only needed by built-in panels.
- Fix: import Blob modules before registration, replace registry entries without an intermediate empty state, unregister only removed plugins, and attach the panel ref only to built-in panels.
