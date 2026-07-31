# 2026-07-31 M15 sidecar 运行时与 echo 演示及 toast 回传卡死修复

## Session goal

落地 M15.1/M15.2 可用切片：宿主 sidecar 启停 + JSONL publish/resolved，sidecar-echo 真机可点；修回传卡死与完成关不掉。

## Completed

- 新增 `src-tauri/src/plugin_sidecar.rs`：`PluginSidecarManager` 启停、stdout JSONL、stdin resolved/shutdown、杀进程树；写 stdin 不持 running 锁。
- `plugins.rs` 解析 manifest `sidecar` → `PluginSidecarSpec`；与 enable/rescan 同步。
- `bus` resolve 后 `notify_plugin_resolved` 转发 sidecar stdin。
- demo：`tools/plugin-demo/sidecar-echo`（15s timer + startup publish + echo roundtrip + dismiss）。
- Toast：echo 留卡 / dismiss 卸卡；PluginHostCard 诊断日志。
- 提交：`ecb5e3e feat(plugins): M15.1 native sidecar runtime + sidecar-echo demo`

## Pending

- M15.3：sidecar storage request/response + 插件中心 runtime 状态 UI
- M15 收尾：bt-music mock、信任文案补「sidecar = 本机代码」、完成定义清单全勾

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/plugin_sidecar.rs` | sidecar 进程托管与 JSONL bridge |
| `src-tauri/src/plugins.rs` | sidecar spec / 列表 |
| `src-tauri/src/bus.rs` | resolve → sidecar stdin |
| `src/views/toastWindows/ReminderToast.vue` | echo keep / dismiss remove |
| `tools/plugin-demo/sidecar-echo/*` | 端到端 demo |
