# 统一日志系统

后端 + 前端日志统一写入本地文件，方便用户打包反馈问题。

## 涉及文件

- `src-tauri/src/log.rs` — 日志核心：按天轮转、7 天清理、文件写入、宏定义
- `src-tauri/src/lib.rs` — `log::init` 调用、`log_frontend` 命令、打开日志目录
- `src/api/tauri.ts` — `logFrontend()` / `openLogsDir()` 调用封装
- `src/main.ts` — 覆盖 `console.log/warn/error`，把前端日志转发到后端
- `src/components/settings/LinksSettingsCard.vue` — 设置页「相关链接」里提供「日志目录」入口
- `src/i18n/locales/zh-CN.ts` / `en-US.ts` — `settings.links.logsDesc` 翻译
- `src-tauri/src/plugin_api/host.rs` — `plugin_api_log`（插件 WebView 日志入口）与 `mirror_plugin_log`（两窗镜像）
- `src-tauri/src/plugin_sidecar.rs` — sidecar 结构化 `op:"log"` 落日志
- `src/plugins/pluginApi.ts` — 后台窗 console 转发 + 镜像监听
- `src/main.ts` — 前端 console 覆盖、F12 调 `toggle_devtools`

## 关键行为

- 日志目录：`app_data_dir/logs/`
- 文件名：`catrace-YYYY-MM-DD.log`
- 行格式：`[2026-07-09 14:05:32] [tag] [level] message`
- 保留策略：保留最近 7 天，启动时清理过期文件
- 级别门槛：`CATRACE_LOG_LEVEL` 环境变量（`error`/`warn`/`info`/`debug`，大小写不敏感，启动读一次，非法值 stderr 告警并回退默认），默认 `info`——`log_debug!` 行不落盘，排查时设 `CATRACE_LOG_LEVEL=debug` 重启看全量
- 前端日志 tag 统一为 `frontend`，level 映射：`log/info/debug→debug`（默认不落盘）、`warn→warn`、`error→error`

## 使用方式

后端打日志：

```rust
log_info!("settle", "ts={} count={}", ts, count);
log_warn!("audio", "no sessions");
log_error!("db", "failed: {}", e);
log_debug!("toast", "fit w={w} h={h}"); // 默认不落盘，CATRACE_LOG_LEVEL=debug 才可见
```

前端正常 `console.log/warn/error` 即可，会自动写入日志文件。

## 插件日志链路

- 后台 WebView（`plugin-bg-*`）：console.* 由 `installPluginConsoleForwarding` 经 `plugin_api_log` 带 `[插件id]` 前缀落宿主日志
- sidecar：结构化 `op:"log"` 带级别落宿主日志（tag `plugin-sidecar`）
- 两条链路共用 `mirror_plugin_log`，把 `catrace:plugin-log` 事件镜像到 main + reminder-toast 两窗 DevTools；Toast 窗点卡片拿焦点后按 F12 即可看插件日志
- 镜像不发 `plugin-bg-*`：后台窗 console 转发会把镜像行再送回 `plugin_api_log`，成回环

## DevTools

- 任意 WebView 窗按 F12 切换各自 DevTools（`toggle_devtools` 命令，`devtools` feature 无条件开启，dev/release 均可用）
- Toast 窗平时 `WS_EX_NOACTIVATE` 不持焦点，先点一下卡片再按 F12

## 注意事项

- 当前只按天轮转，未限制单个文件大小；全天大量日志时当天文件可能变大
- 日志文件写入失败时不抛异常，避免影响主流程
- 打开日志目录依赖 `tauri-plugin-opener`
