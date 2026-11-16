# Plugin Native Sidecar Runtime

宿主为已启用插件托管本机子进程，通过 UTF-8 JSON Lines 连接 stdin/stdout。宿主提供通用能力和生命周期，插件业务在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护。

## 运行模型

- `sidecar` 与 `background` 是独立的可选入口；只声明 `sidecar` 时只启动子进程。
- 声明 `background` 时，[PluginWindowManager](../../../src-tauri/src/plugin_window.rs) 为该插件创建 `plugin-bg-<id>` 隐藏 WebView。
- 无界面调度与动作处理优先使用 sidecar；页面级能力使用 background。选择约定见[宿主能力 op 与运行入口](插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md)。
- Toast 卡与设置组件留在 WebView；设置可经 `plugin.sidecar.request()` 调用本插件进程，Toast 的处理结果经 Bus 回传。

启用即信任插件的本机代码。宿主不按业务添加专用 API，也不替插件安装 npm 依赖。

## Manifest 与命令解析

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "events": ["my-plugin", "my-plugin.tick"],
  "sidecar": {
    "command": "node",
    "args": ["runtime/main.mjs"],
    "cwd": ".",
    "env": { "MY_PLUGIN_DEBUG": "1" }
  }
}
```

| 字段 | 运行规则 |
|------|----------|
| `command` | 带路径分隔符或以 `.` 开头的相对命令从插件根解析；绝对路径原样使用；裸命令经 `resolve_program` 查找 |
| `args` | 原样传给子进程 |
| `cwd` | 默认插件根目录；相对路径从插件根解析，也接受绝对路径 |
| `env` | 附加到继承的环境；宿主最后注入 `CATRACE_PLUGIN_ID` 与 `CATRACE_PROTOCOL_VERSION=1` |

[sidecar_spec](../../../src-tauri/src/plugins.rs) 负责路径组合；[resolve_program](../../../src-tauri/src/sidecar/command.rs) 先查系统 PATH，再查额外目录。额外目录包括宿主注册的 `app_data/runtime/node` 及其 `bin` 子目录，以及各平台常见安装目录。

Manifest 扫描不对 sidecar 的 command/cwd/env 设置解释器白名单或目录沙箱；可执行文件缺失等问题在 spawn 时返回。安装包与入口文件的校验见[外部插件合同](m10-external-plugins.md)。

## 生命周期

实现真源：[PluginSidecarManager](../../../src-tauri/src/plugin_sidecar.rs)。

| 触发 | 行为 |
|------|------|
| 应用启动、普通 `list_external_plugins` | 异步同步：启动缺失进程、停止已禁用进程、替换已退出进程；保留健康进程 |
| `set_external_plugin_enabled` | 持久化后同步该插件的 sidecar 与 background；不重启其他插件 |
| 启用时运行态同步失败 | 回滚为停用，清理该插件运行入口，向调用方返回错误 |
| `list_external_plugins(restartSidecars: true)` | 显式请求全量重启已启用的 sidecar |
| 卸载 | 先撤销启用状态，停止运行入口，再移除安装目录 |
| 正常退出 | `stop_all` 停止托管进程 |

`ready` 只记录日志；进程 spawn 成功即可进入托管集合。退出进程在后续同步时替换，当前实现没有独立的定时崩溃重试器。

停止时先发送 `shutdown`，最多等待约 500ms，再强制终止。Windows 使用 `taskkill /T /F`，并为每个 sidecar 持有 `KILL_ON_JOB_CLOSE` Job Object，覆盖宿主崩溃或强杀；Job 分配失败时写 warning。非 Windows 强制终止调用 `Child::kill`，不承诺回收任意派生进程。Windows 细节见[Job Object 清理](sidecar孤儿进程清理-Windows-Job-Object实现.md)。

## JSONL 协议

每行一条 JSON，以 `\n` 结束，消息使用 `v: 1`。stdout 是协议通道，stderr 单独逐行写 warning；普通调试文本应走 `log` 或 stderr。

### Sidecar → Host

| op | 字段 / 语义 |
|----|-------------|
| `ready` | 就绪日志 |
| `publish` | `event` 使用 `PluginPublishInput`；可带 `requestId`，成功时应答 `{ eventId }` |
| `resolve` | `eventId`：仅关闭本插件的 active 事件，resolution 为 `dismissed` |
| `log` | `level`、`message`、可选 `data` |
| `response` | 应答宿主 RPC：`requestId`、`ok`、`result` 或 `error` |
| `storage.get` / `storage.set` | `requestId`、`key`；set 另带 `value`，见[Storage 往返](sidecar-storage往返协议与Plugins-UI运行态约定.md) |
| `activity.get` | `requestId`；拉取 `{ active, at }` |
| `clipboard.write_text` | `requestId`、`text` |
| `shell.open_url` | `requestId`、`url`，仅 http/https |
| `config.get` / `config.set` | `requestId`；set 另带整对象 `config` |

能力请求统一回 `op: "response"`，具体字段与配置约定见[宿主能力 op](插件后台逻辑迁到sidecar-宿主能力op与不建WebView的约定.md)。`publish` 失败只记录 warning，不保证给 `requestId` 错误应答。

### Host → Sidecar

| op | 时机 / 语义 |
|----|-------------|
| `config` | 仅 spawn 时，且宿主已存有该插件配置时推送整包 `config` |
| `request` | `requestId`、`method`、`params`：来自主窗口设置中的 `plugin.sidecar.request()` |
| `response` | 应答 sidecar 的 Storage 或宿主能力请求 |
| `resolved` | Plugin 源事件 resolve 后投递；包括 action、dismiss、expired、superseded 等结果 |
| `shutdown` | 停止前请求优雅退出 |

宿主到 sidecar 的自定义 RPC 由主窗口发起，宿主等待应答最多 30 秒；进程停止或重启会让待处理 RPC 失败。运行期配置写入只广播配置变更事件，不自动追加 stdin `config`；需要实时同步时使用插件自定义 RPC 或主动 `config.get`。

`resolved` 包含 `eventId`、`eventType`、`kind`、事件 `payload`、`actionId`、`resolutionKind`、`resolutionPayload`。[Bus 转发](../../../src-tauri/src/bus.rs) 同时通知已存在的 background 窗与 sidecar；动作业务由插件处理。

## 身份与并发边界

- 读 stdout 的线程由宿主绑定 `plugin_id`，不使用消息自报的 pluginId。
- `publish` 复用 [publish_plugin_event](../../../src-tauri/src/plugin_commands.rs)，source 固定为 `Plugin { name: plugin_id }`，校验启用状态、manifest `events` 和保留 kind。
- `resolve` 校验事件 source，不能关闭其他插件的事件。
- activity / clipboard / shell / config 请求要求插件已安装且启用。
- Storage 按宿主绑定的 plugin id 隔离，key 校验见[Storage 协议](sidecar-storage往返协议与Plugins-UI运行态约定.md)。
- stdout 与 stderr 使用独立读线程；stdin 写入由独立 mutex 串行化。
- `send_resolved` 与 `reply_sidecar` 在 running map 锁内只 clone stdin 句柄，释放 map 锁后再写管道；`send_resolved` 另开线程，避免 Toast action 热路径等待子进程读 stdin。

## 相关

- [外部插件合同](m10-external-plugins.md) — 扫描、入口、Blob 加载与设置面
- [宿主桌面 API](外部插件-settings调用宿主桌面能力-demo.md) — WebView facade 与 Rust 能力边界
- [插件中心](../../features/plugin-center/README.md) — 仓库安装、启停和设置界面
- [插件配置与运行数据](插件配置和运行数据必须分开存储.md) — 配置与 KV 的分工
- [插件开发入口](../../skills/external-plugin-authoring/README.md) — 独立插件仓库的开发文档