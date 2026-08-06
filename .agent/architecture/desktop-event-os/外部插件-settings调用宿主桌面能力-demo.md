# 外部插件 settings 通过统一 plugin API 调用 Rust 宿主能力

`sidecar-echo` 同时验证两条能力链：统一 Rust 宿主 API，以及可选 Node sidecar 的后台事件与 action 回传。

## 正确边界

插件 UI/settings/background 源码加载前，宿主会注入模块局部变量：

```js
const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('plugin-id')
```

插件直接调用 Rubick 风格 facade，不直接拼 Tauri command：

```js
await plugin.env.getAll()
await plugin.dialog.pickFile()
await plugin.dialog.pickFolder()
await plugin.process.spawn(path, args)
await plugin.http.get(url)
await plugin.log.info('message', { key: 'value' })
await plugin.sidecar.request('custom.method', params)
```

Rust 只实现可复用桌面原语；插件业务仍写在插件内。不要新增 `plugin_demo_*` 这类单插件 command。

## 调用链

```text
settings/ui/background.mjs
  -> 模块局部 plugin facade (src/plugins/pluginApi.ts)
  -> Tauri invoke + pluginId
  -> plugins.rs 通用 command
  -> 校验插件 id、调用窗口和启用状态
  -> 环境 / dialog / process / HTTP / log
```

`loadExternalPlugins.ts`、`PluginHostCard.vue`、`PluginHost.vue` 三条 Blob import 路径都必须使用 `wrapPluginSource()`，否则对应 surface 中没有 `plugin` 变量。

## plugin.log

`plugin.log.info/warn/error(message, data)` 有两个出口：

1. Rust 统一日志：stderr 与宿主日志文件，格式带 `[plugin] [plugin-id]`。
2. Rust emit `catrace:plugin-log` 到 `main`，主窗口监听后输出为 DevTools `console.info/warn/error`。

console 转发失败不应让插件日志调用失败；日志文件是主记录，console 是调试镜像。

## 当前 API

| API | Rust 实现 |
|-----|-----------|
| `plugin.env.getAll()` | `std::env::vars()` |
| `plugin.dialog.showOpenDialog({ directory })` | `tauri-plugin-dialog` |
| `plugin.dialog.pickFile()` / `pickFolder()` | facade 便捷方法 |
| `plugin.process.spawn(path, args)` | `std::process::Command`，返回 PID |
| `plugin.http.get(url)` | `reqwest`，返回 status/final URL/contentType/body |
| `plugin.log.*` | 统一 Rust 日志 + 主窗口 console |
| `plugin.storage.get/set/remove()` | 插件隔离 JSON runtime 存储 |
| `plugin.config.get/set()` | 整对象 settings store（可读可在禁用时写） |
| `plugin.setEnabled(bool)` | 启用/禁用本插件 |
| `plugin.events.publish()` | 完整 Event Bus 发布（actions/payload/dedupe） |
| `plugin.activity.get()` / `getLastRealRest()` | 活跃快照 / 真休息锚点 |
| `plugin.notification.show()` | Event Bus 简易 Toast |
| `plugin.sidecar.request()` | 既有通用 JSONL RPC，供插件自定义 sidecar method |

## sidecar-echo Demo 边界

- `settings.mjs`：通过 `plugin.*` 验证宿主环境、文件/目录选择、启动程序、HTTP GET、日志。
- `runtime/main.mjs`：只保留 sidecar 自身的定时 Toast、shutdown 和 resolved/action roundtrip；不再重复实现桌面原语。

## 验证

- `cargo check`
- `cargo test plugin_sidecar --lib`
- `pnpm exec vue-tsc --noEmit`
- `pnpm build`
- `node --check tools/plugin-demo/sidecar-echo/settings.mjs`
- `node --check tools/plugin-demo/sidecar-echo/runtime/main.mjs`
- 重启 Rust 应用后手测，并在主窗口 DevTools console 检查 `[plugin:sidecar-echo]`。

## Newly completed host capabilities

- `plugin.dialog.showSaveDialog()` and `plugin.path.get()`.
- Clipboard and plugin-isolated JSON storage.
- `openExternal/openPath/showItemInFolder` shell operations.
- Platform, theme, and Event Bus-backed Toast notification.
- Timer plugin config/events/activity surface: `plugin.config`, `plugin.events.publish`, `plugin.activity.*`, `plugin.setEnabled`.
- Rust implementation is centralized in `src-tauri/src/plugin_api.rs`; `plugins.rs` remains responsible for manifest scanning and lifecycle state.

## Rubick API second batch

The host facade now also exposes these reusable desktop primitives:

- `plugin.window.hideMain()` / `showMain()` for main-window visibility.
- `plugin.screen.getCursorPoint()`, `getDisplayNearestPoint(point)`, and `getAllDisplays()` using Tauri monitor APIs.
- `plugin.shell.beep()` with native Windows `MessageBeep` and a terminal-bell fallback on other desktop systems.
- `plugin.clipboard.writeImage({ rgba, width, height })`, `readImage()`, and `clear()`. Image data is raw RGBA and the Rust boundary validates `width * height * 4`.

Clipboard image reads stay off the main thread because the underlying desktop clipboard implementation can deadlock on Linux when read synchronously.