# Sidecar storage 往返协议与 Plugins UI 运行态约定

M15.3 定稿：sidecar 进程可经 stdio 读写宿主 per-plugin KV；Plugins 中心展示本机进程运行态与信任说明。

## 为什么

- WebView `plugin_storage_*` 只服务 background/settings 窗口；sidecar（node/exe）不能直接 invoke。
- 业务配置/运行态若只在 sidecar 内存，进程重启即丢；需与宿主 SQLite 同一命名空间。
- 启用即信任模型下，用户必须能看见「是否有本机子进程、是否在跑」。

## Storage 协议（Sidecar ↔ Host）

### Sidecar → Host

```json
{"v":1,"op":"storage.get","requestId":"r1","key":"cfg"}
{"v":1,"op":"storage.set","requestId":"r2","key":"cfg","value":{"n":1}}
```

- 身份只来自 `PluginSidecarManager` running map 的 `plugin_id`，**不**信 JSON 内 pluginId。
- key 规则与 WebView 相同：非空、不含 `:`（`validate_storage_key`）。
- set 的 value 任意 JSON；宿主 `serde_json::to_string` 后写入 `plugin_storage` 表。
- set 会走 `record_storage_activity`（写压力 / 单值过大 → 异常 Tag，不限流）。

### Host → Sidecar

统一复用既有 `op:response`（与 host→sidecar RPC 应答同形），**不用**单独的 `storage.get.result`：

```json
{"v":1,"op":"response","requestId":"r1","ok":true,"result":{"n":1}}
{"v":1,"op":"response","requestId":"r1","ok":true,"result":null}
{"v":1,"op":"response","requestId":"r2","ok":false,"error":"..."}
```

- get 命中：`result` 为反序列化后的 JSON Value。
- get 未命中：`result: null`。
- 写回 stdin 前先 clone 句柄并释放 running 锁（与 `send_resolved` 同防死锁思路）；实现见 `reply_sidecar`。

## 实现落点

| 路径 | 职责 |
|------|------|
| `src-tauri/src/plugin_sidecar.rs` | `SidecarOutput::{StorageGet,StorageSet}` 解析；`handle_stdout_line` 路由；`reply_sidecar`；`is_running` |
| `src-tauri/src/plugin_commands.rs` | `validate_storage_key` / `record_storage_activity` 对 crate 可见 |
| `src-tauri/src/db.rs` | `get_plugin_storage` / `set_plugin_storage` |
| `src-tauri/src/plugins.rs` | `ExternalPluginInfo.sidecar_running`；list/set_enabled 注入；**enable 时先 `sidecars.sync` 再读 running** |

## Plugins UI 运行态

| 字段 | 来源 | 展示 |
|------|------|------|
| `hasSidecar` | manifest 声明 `sidecar` | 有则显示 badge |
| `sidecarRunning` | `PluginSidecarManager::is_running` | 绿=运行 / 灰=未运行 |

- 列表：`PluginNavRail` 名称旁小 Tag「本机进程 / Native」。
- 顶栏：`PluginPanelHeader` 标题旁 badge + tooltip。
- 启用/禁用：`set_external_plugin_enabled` **同步** `sidecars.sync` 后再返回，避免 UI 落后一轮刷新。
- 信任文案：`plugins.external.trustNote`（中英）+ 导航底部展示；m10 文档同步「sidecar = 本机代码」。

## 与 plugin.config 的边界

- `plugin.config.*`（settings facade）走 `plugin_config` 命名空间，面向 settings/background。
- sidecar `storage.*` 走 `plugin_storage` 表，与 background `plugin_storage_*` **同一表、同一 id 隔离**。
- bt-music 设置仍用 `plugin.config` + `setConfig` 推 sidecar；sidecar 侧 storage 是可选能力，插件自行选用。

## 手测要点

1. 启用含 sidecar 插件 → 列表/顶栏 badge 为运行中（绿）。
2. 禁用 → badge 变灰、无残留子进程。
3. sidecar 发 `storage.set` 再 `storage.get`，result 一致；非法 key（含 `:`）返回 error。
4. 插件中心底部可见 sidecar 信任说明。

## 相关

- [[plugin-native-sidecar-runtime]] 总设计
- [[plugin-center]] UI 组件
- [插件配置和运行数据必须分开存储.md](插件配置和运行数据必须分开存储.md)
