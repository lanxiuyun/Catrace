# 统一日志系统

后端 + 前端日志统一写入本地文件，方便用户打包反馈问题。

## 涉及文件

- `src-tauri/src/log.rs` — 日志核心：按天轮转、7 天清理、文件写入、宏定义
- `src-tauri/src/lib.rs` — `log::init` 调用、`log_frontend` 命令、打开日志目录
- `src/api/tauri.ts` — `logFrontend()` / `openLogsDir()` 调用封装
- `src/main.ts` — 覆盖 `console.log/warn/error`，把前端日志转发到后端
- `src/components/settings/LinksSettingsCard.vue` — 设置页「相关链接」里提供「日志目录」入口
- `src/i18n/locales/zh-CN.ts` / `en-US.ts` — `settings.links.logsDesc` 翻译

## 关键行为

- 日志目录：`app_data_dir/logs/`
- 文件名：`catrace-YYYY-MM-DD.log`
- 行格式：`[2026-07-09 14:05:32] [tag] [level] message`
- 保留策略：保留最近 7 天，启动时清理过期文件
- 前端日志 tag 统一为 `frontend`，level 映射：`log→info`、`warn→warn`、`error→error`

## 使用方式

后端打日志：

```rust
log_info!("settle", "ts={} count={}", ts, count);
log_warn!("audio", "no sessions");
log_error!("db", "failed: {}", e);
```

前端正常 `console.log/warn/error` 即可，会自动写入日志文件。

## 注意事项

- 当前只按天轮转，未限制单个文件大小；全天大量日志时当天文件可能变大
- 日志文件写入失败时不抛异常，避免影响主流程
- 打开日志目录依赖 `tauri-plugin-opener`
