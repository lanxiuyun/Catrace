# 启动事件上报

## 涉及文件

- `src-tauri/src/report.rs` — 上报接口（空实现）

## 现状

原上报目标 toolsetlink 已停服，业务代码已清空，仅保留 `spawn_report_app_start(app_handle, db)` 空接口供 `lib.rs` setup 阶段调用，启动时打一条 "report service not configured" 日志。dev 模式下跳过。

后续接入新上报服务时在 `report.rs` 内填充实现即可，调用方不用改。
