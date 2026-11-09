# 插件 sidecar 生命周期

## 用户动作

- **启用 / 停用**：`set_external_plugin_enabled` 只调用当前插件的 `sync_plugin(id)`，不重启其它插件的进程树。
- **重载单个插件脚本**：关闭再开启该插件，停止旧进程后从磁盘启动。没有文件监视，存盘不会自动重启。
- **插件中心刷新**：当前 React 工具栏调用本机只读目录 `list_plugin_catalog` 与远程目录读取，不请求全量重启 sidecar。

## 后端同步接口

[plugins.rs](../../../src-tauri/src/plugins.rs) 的 `list_external_plugins` 供模块加载器使用：

| 参数 | 行为 |
|---|---|
| 默认 `restart_sidecars=false` | schedule_sync：补启动、停用清理与运行状态同步 |
| 显式 `restart_sidecars=true` | schedule_sync_force：所有启用 sidecar 重启 |

显式全量重启接口与插件中心刷新不是同一个动作。接口封装见 [tauri.ts](../../../src/api/tauri.ts)，React 刷新入口见 [usePluginCatalog.ts](../../../src/app/pages/plugins/usePluginCatalog.ts)。

## 必须保留的边界

停止 sidecar 会回收进程树，包含它拉起的子进程。因此开关 Y 时不能顺带扫描 / 重启 X；全量 sync 或 force 放进单插件开关会误杀其它插件的播放器等进程。

Windows 以 shutdown 宽限、进程树终止和 Job Object 兜底。实现见 [plugin_sidecar.rs](../../../src-tauri/src/plugin_sidecar.rs) 与[子进程回收](../../architecture/desktop-event-os/sidecar孤儿进程清理-Windows-Job-Object实现.md)，根因记录见[误杀案例](../../bugs/2026-08-31-sidecar重启误杀其他插件的子进程树.md)。
