# Sidecar Storage 往返与插件中心状态边界

Sidecar 通过 stdio 读写宿主的 per-plugin KV，与 WebView `plugin.storage` 共用 SQLite `plugin_storage` 表。用户配置使用独立的 `plugin.config`；边界见[插件配置与运行数据](插件配置和运行数据必须分开存储.md)。

## 请求与应答

Sidecar → Host：

```json
{"v":1,"op":"storage.get","requestId":"r1","key":"lastRun"}
{"v":1,"op":"storage.set","requestId":"r2","key":"lastRun","value":{"at":123}}
```

Host → Sidecar：

```json
{"v":1,"op":"response","requestId":"r1","ok":true,"result":{"at":123}}
{"v":1,"op":"response","requestId":"r2","ok":true,"result":true}
{"v":1,"op":"response","requestId":"r3","ok":false,"error":"..."}
```

- 身份来自宿主为 stdout 线程绑定的 plugin id，消息中的 pluginId 不参与鉴权。
- `key` 必须非空且不含 `:`；所有查询和写入按 plugin id 隔离。
- `storage.get` 命中时返回反序列化后的 JSON，未命中时返回 `result: null`。
- `storage.set` 将任意 JSON 序列化后写库，成功返回 `result: true`。
- 写入调用 `record_storage_activity`；写压力或单值过大会记录异常，不拦截写入。
- `reply_sidecar` 只在 running map 锁内 clone stdin 句柄，放锁后再写管道，避免响应写入阻塞进程管理。

## 配置同步

`storage.*` 是按 key 的运行数据，不向设置页广播配置变化。用户选项使用 `config.get/set`，其整对象写入和变更广播见[宿主能力 op](插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md)。

## 插件中心的状态来源

- [usePluginCatalog](../../../src/app/pages/plugins/usePluginCatalog.ts) 使用只读 `list_plugin_catalog` 获取安装信息；目录刷新本身不执行插件，也不重启进程。
- [PluginCenter](../../../src/app/pages/plugins/PluginCenter.tsx) 用持久化的 `enabled` 控制开关，用 `error` 展示需要处理的安装或清单错误。`enabled` 表示用户的启用选择，不是进程存活探针。
- 开关等待 `set_external_plugin_enabled` 完成持久化和该插件生命周期同步，再静默重读目录。后端启用失败会回滚停用；前端失败后也重读实际状态。
- 目录的 `sidecar` 字段描述 manifest 中的本机进程入口；具体启停与错误定位以[运行时协议](plugin-native-sidecar-runtime.md)和宿主日志为准。

## 实现真源

| 文件 | 职责 |
|------|------|
| [plugin_sidecar.rs](../../../src-tauri/src/plugin_sidecar.rs) | JSONL 解析、Storage 路由、应答与 stdin 写入 |
| [plugin_commands.rs](../../../src-tauri/src/plugin_commands.rs) | `validate_storage_key`、`record_storage_activity` |
| [db.rs](../../../src-tauri/src/db.rs) | `get_plugin_storage`、`set_plugin_storage` |
| [plugin_api/storage.rs](../../../src-tauri/src/plugin_api/storage.rs) | WebView facade 使用的同命名空间存储 |
| [plugins.rs](../../../src-tauri/src/plugins.rs) | 只读目录、启用状态持久化和单插件生命周期同步 |

插件中心安装与交互的完整约定见[插件中心](../../features/plugin-center/README.md)。