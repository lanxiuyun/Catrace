# 外部插件的宿主桌面 API

宿主向插件 WebView 注入统一 `plugin` facade，Rust 只实现可复用桌面原语。插件业务、示例与脚手架由独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护。

## 调用与注入

插件源码加载前，[wrapPluginSource](../../../src/plugins/pluginApi.ts) 插入模块局部变量：

```js
const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('plugin-id')
```

插件直接调用 `plugin.*`；宿主负责 command 名与参数转换。注入入口共用同一个 wrapper：

- [loadExternalPlugins](../../../src/plugins/loadExternalPlugins.ts)：Toast 卡与设置模块加载。
- [PluginHostCard](../../../src/components/PluginHostCard.vue)：卡片兜底加载。
- [PluginHost](../../../src/views/toastWindows/PluginHost.vue)：后台 WebView。

主窗口由 React 管理；外部设置组件由 [ExternalPluginSettings](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) 挂载 Vue 岛。模块加载、组件合同与启用门闩见[外部插件合同](m10-external-plugins.md)。

## 能力真源

完整名称、参数和返回类型以 [PluginApi](../../../src/plugins/pluginApi.ts) 为准，后端边界以 [plugin_api](../../../src-tauri/src/plugin_api/mod.rs) 各能力模块为准。

| 能力组 | JS 入口 | 后端 |
|--------|---------|------|
| 环境与进程 | `env.getAll`、`process.spawn`、`http.get` | [host.rs](../../../src-tauri/src/plugin_api/host.rs) |
| 路径与宿主信息 | `path.get/getPluginDir`、`platform.getInfo`、`theme.isDark`、`i18n.getLocale` | [host.rs](../../../src-tauri/src/plugin_api/host.rs) |
| 文件选择 | `dialog.showOpenDialog/showSaveDialog/pickFile/pickFolder` | [dialog.rs](../../../src-tauri/src/plugin_api/dialog.rs) |
| 剪贴板 | `clipboard.writeText/readText/writeImage/readImage/clear` | [clipboard.rs](../../../src-tauri/src/plugin_api/clipboard.rs) |
| 窗口与显示器 | `window.hideMain/showMain`、`screen.getCursorPoint/getDisplayNearestPoint/getAllDisplays` | [window.rs](../../../src-tauri/src/plugin_api/window.rs) |
| 外壳 | `shell.openExternal/openPath/showItemInFolder/beep` | [shell.rs](../../../src-tauri/src/plugin_api/shell.rs) |
| 音频 | `audio.play/stop/pause/resume/setVolume/isPlaying` | [audio.rs](../../../src-tauri/src/plugin_api/audio.rs) |
| 运行数据 | `storage.get/set/remove` | [storage.rs](../../../src-tauri/src/plugin_api/storage.rs) |
| 配置与启用 | `config.get/set`、`setEnabled` | [plugins.rs](../../../src-tauri/src/plugins.rs) |
| Event 与活跃信息 | `notification.show`、`events.publish/close`、`activity.get/getLastRealRest/getRecords` | [events.rs](../../../src-tauri/src/plugin_api/events.rs) |
| 日志 | `log.info/warn/error` | [host.rs](../../../src-tauri/src/plugin_api/host.rs) |
| 设置到 sidecar 的 RPC | `sidecar.request` | [plugin_sidecar.rs](../../../src-tauri/src/plugin_sidecar.rs) |

## 需要保留的边界

- 普通桌面能力通过 `require_plugin_api` 校验调用窗口：`main`、`reminder-toast` 或与 plugin id 匹配的 `plugin-bg-<id>`，且插件已启用。
- `config.get/set` 面向已安装插件，允许停用时读写；配置是整对象，运行数据是按 key 的 KV。详见[配置与运行数据分工](插件配置和运行数据必须分开存储.md)。
- `sidecar.request` 仅开放给主窗口设置面，调用的插件须启用且进程已运行；不是任意 WebView 到任意进程的通道。
- Event 发布走宿主校验与 Bus，source、保留 kind 与 manifest `events` 边界不可绕过；关闭事件校验本插件所有权。
- `activity.getRecords` 使用 unix 秒、半开区间 `[from, to)`，最长 31 天，缺失分钟不补行。细节见[历史分钟记录](../../features/plugin-center/plugin-activity-getRecords-历史分钟记录.md)。
- `i18n.getLocale` 从宿主配置读取语言；插件不要以页面 HTML 的 `lang` 推断用户语言。

## 日志与回环防护

`plugin.log.*` 写宿主日志，并由 `mirror_plugin_log` 将 `catrace:plugin-log` 发给 `main` 与 `reminder-toast`。前端 [ensurePluginLogConsole](../../../src/plugins/pluginApi.ts) 用原生 console 快照输出镜像，避免 patched console 再将同一行送回 Rust。

后台 WebView 的 console 由 `installPluginConsoleForwarding` 转发到宿主；日志镜像不投给 `plugin-bg-*` 窗，防止无限回环。console 镜像失败不影响宿主日志记录。

## 平台根因

- 图像剪贴板使用原始 RGBA；Rust 验证 `width * height * 4`。图像读取放在主线程之外，避免 Linux 桌面剪贴板同步读取死锁。
- `shell.beep` 使用系统提示音或终端铃声，不能保证可听见；通知音使用 `audio.play`。
- rodio 的 `OutputStream` 是 `!Send`，播放由专用音频线程持有。资源定位与线程约定见[音频与插件目录](plugin-audio-rodio独立线程与getPluginDir.md)。

Sidecar 的 stdio 能力集合是独立协议，不等同于整个 WebView facade；见[Sidecar Runtime](plugin-native-sidecar-runtime.md)。
