# Sidecar 宿主能力 op 与运行入口约定

无界面的定时、活跃门控、存储和卡片动作处理优先放在 sidecar。只有声明 `background` 才创建隐藏 WebView；UI 卡片、设置组件和页面级能力继续使用 WebView。进程与传输合同见[Sidecar Runtime](plugin-native-sidecar-runtime.md)。

## 宿主能力请求

Sidecar 向 stdout 写请求，宿主经 stdin 返回 `response`。每个请求携带 `v: 1` 与唯一 `requestId`。

```json
{"v":1,"op":"activity.get","requestId":"a1"}
{"v":1,"op":"response","requestId":"a1","ok":true,"result":{"active":true,"at":123}}
```

| op | 请求字段 | 宿主结果 / 约束 |
|----|----------|----------------|
| `activity.get` | — | `{ active, at }`，`at` 为毫秒时间戳；全屏提醒开启时不活跃，否则键鼠计数或媒体活跃即活跃 |
| `clipboard.write_text` | `text` | 写系统剪贴板，成功 `result: true` |
| `shell.open_url` | `url` | 仅 http/https，成功 `result: true` |
| `config.get` | — | 已保存的配置对象，无配置时 `null` |
| `config.set` | `config` | JSON 对象，成功 `result: true`，并广播 `catrace:plugin-config-changed` |

失败应答形如：

```json
{"v":1,"op":"response","requestId":"a1","ok":false,"error":"..."}
```

实现真源：[SidecarOutput 与 handle_stdout_line](../../../src-tauri/src/plugin_sidecar.rs)。这些能力统一经 `ensure_sidecar_plugin_usable` 校验插件已安装且启用；身份来自宿主启动的进程绑定，不信消息自报 pluginId。Storage 的同形应答见[Storage 往返](sidecar-storage往返协议与Plugins-UI运行态约定.md)。

## 配置和启动

- Sidecar 应主动启动并准备读取 stdin，不能等待首条 `config`：宿主只在 spawn 时且已有持久化配置时推送该消息。首次启用可能没有任何配置推送。
- 运行期写配置广播的是宿主事件，不自动推 stdin `config`。插件可主动 `config.get`，或由设置页调用自定义 RPC 同步；RPC 合同见[Sidecar Runtime](plugin-native-sidecar-runtime.md)。
- `config.set` 是整对象替换。局部动作应先 `config.get`，修改需要的字段，再完整写回，以保留其他用户选项。
- `enabled` 由宿主启停入口管理。`config.set` 未显式携带它时，宿主保留已存值；开关使用 `plugin.setEnabled`，以执行持久化与进程生命周期同步。
- 请求超时由插件按业务设置；活跃门控无法取得快照时应明确处理未知状态，通知类门控宜 fail-open，避免静默丢通知。

## 卡片结果与后台入口

[Bus](../../../src-tauri/src/bus.rs) 对 Plugin 源事件的 resolve 结果同时通知已有的 background 窗和 sidecar。Sidecar 的 `op: "resolved"` 携带事件 payload 与动作字段，可直接依据 `actionId` 处理业务。background 通过 `catrace:plugin-event-resolved` 接收同一结果。

[PluginWindowManager](../../../src-tauri/src/plugin_window.rs) 只为有效、已启用且带 `background` 入口的插件创建隐藏窗。仅 sidecar 的插件不需要该窗，避免无界面逻辑额外占用一个 renderer。

后台 WebView 的 `plugin_report_memory` 样本不覆盖 sidecar 进程；宿主当前没有按 sidecar PID 采样内存的实现。事件发布和 Storage 写压力仍由宿主对应入口记录，不依赖后台窗。

插件内部的调度、动作实现与调试记录写入 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)；宿主只维护上述协议和运行入口边界。
