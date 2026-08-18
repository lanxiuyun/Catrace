# 2026-08-08 sidecar 挂 Job Object，宿主退出自动回收孤儿进程不再占端口

## Session goal

smsforwarder 插件的 sidecar 在 Catrace 退出后仍占着端口（17890）。需求：插件 reload / disable 时杀掉占用该端口的进程；进一步要根治「宿主退出后孤儿进程残留」。

## 决策

**在宿主里做**，不靠插件：

- 宿主掌握 sidecar 生命周期，能覆盖「宿主怎么死」的所有路径（正常退出 / 崩溃 / 强杀 / 更新重启）。
- 插件侧 `freePort()` 只在自身 bind 撞 EADDRINUSE 时兜底，disable 时插件已死救不了自己。

## Completed

- `src-tauri/Cargo.toml`：windows 依赖加 `Win32_System_JobObjects`、`Win32_Security`。
- `src-tauri/src/plugin_sidecar.rs`：新增 `SidecarJob`（RAII，`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + `AssignProcessToJobObject`），spawn 每个 sidecar 时挂 job；`RunningSidecar` / `SpawnedSidecar` 持有句柄；`#[cfg(windows)]` 隔离 + 降级 log。
- `cargo check` 通过；54 个 lib 测试通过。
- 已提交 `3fdf070`（只含 Cargo.toml + plugin_sidecar.rs 两个文件）。

## Remaining

- 真机验收：强杀 Catrace 后确认端口已释放、reload/disable 无残留（未手测，仅编译级验证）。

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | windows 特征加 `Win32_System_JobObjects`、`Win32_Security` |
| `src-tauri/src/plugin_sidecar.rs` | `SidecarJob` + `create_and_assign` + 接线 + 降级日志 |

## 沉淀

- bug：[../bugs/2026-08-08-sidecar孤儿进程占用端口不随宿主退出释放.md](../bugs/2026-08-08-sidecar孤儿进程占用端口不随宿主退出释放.md)
- 实现详解：[../architecture/desktop-event-os/sidecar孤儿进程清理-Windows-Job-Object实现.md](../architecture/desktop-event-os/sidecar孤儿进程清理-Windows-Job-Object实现.md)
