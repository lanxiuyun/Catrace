# 2026-07-30 插件可选 Native Sidecar（插件自带脚本/二进制，宿主只托管原语）

## Status

Accepted（设计已定；M15.1–M15.3 已实现：lifecycle + storage 往返 + Plugins UI runtime + 信任文案）

## Context

M11 后台是 **隐藏 WebView + 浏览器 JS**（见 [2026-07-23-step3-插件后台运行时用隐藏webview窗口](2026-07-23-step3-插件后台运行时用隐藏webview窗口.md)）。能力边界是：

- ✅ `setInterval` / `fetch` / `WebSocket` / `plugin_publish_event` / storage / log
- ❌ 无 `child_process`、无任意 OS API、无 npm native、无真 Node

结果：蓝牙耳机连接、启动听歌软件、读 WMI/注册表、跑 PowerShell 等，要么 **改 Rust 开业务洞**，要么 **插件做不了**。

并行决策 [2026-07-24-step3-宿主能力改为随具体插件按需提供](2026-07-24-step3-宿主能力改为随具体插件按需提供.md) 要求「有真实插件再补 API」。若长期按「每个业务一个 `plugin_*`」推进，宿主会变成插件需求垃圾场，和「几十个第三方插件」目标冲突。

用户明确目标：**插件内可带 native/脚本，避免业务能力总改 Rust。**

## Decision

### 1. 分层：WebView 编排 + 可选 Sidecar 干活

| 层 | 跑什么 | 职责 |
|----|--------|------|
| **Card** `ui.mjs` | Toast WebView | 渲染 + 即时 UI |
| **Background** `background.mjs` | `plugin-bg-*` 隐藏 WebView | 编排、读 activity/config、publish 事件、订 sidecar 消息 |
| **Sidecar**（可选） | 插件自带进程 | OS/native/脚本：蓝牙、spawn 应用、WMI、本地工具链 |

**默认仍可只有 background**（现有 timer/demo-timer 不变）。  
**需要本机能力时**才声明 sidecar，**不**把主 WebView 改成 `nodeIntegration`，**不**整仓迁 Electron。

### 2. 宿主只提供平台原语，不提供业务 API

Rust **允许**沉淀的是原语，例如：

- 启停 sidecar、管道/IPC、生命周期与崩溃回收
- 已有：`plugin_publish_event` / storage / config / log / activity
- 窄可选：`plugin_open_path`（若希望统一走 opener 审计；否则 sidecar 自 spawn）

Rust **禁止**为单个插件加业务洞，例如：

- `plugin_bluetooth_*`、`plugin_wmi_*`、`plugin_launch_qq_music`、`plugin_registry_*`

业务逻辑永远在插件 sidecar / 脚本里。

### 3. Sidecar 启动模型（v1）

manifest 可选字段 `sidecar`（名可微调，实现时以架构文为准）：

```json
{
  "sidecar": {
    "command": "node",
    "args": ["runtime/main.js"],
    "cwd": "."
  }
}
```

或打包二进制：

```json
{
  "sidecar": {
    "command": "./bin/bt-music-watch.exe",
    "args": []
  }
}
```

规则：

1. **仅**插件 **enabled** 时启动；disable / 卸载 / 退出 → **杀进程树**。
2. `command`, `args`, `cwd`, and env follow enable-means-trust: no interpreter allowlist, path-escape check, or absolute-path restriction. Relative commands resolve from the plugin root; bare names use system `PATH`.
3. Manifest scanning parses structure only. A command that cannot start is reported as a runtime error and does not prevent listing the plugin.
4. Host identity variables such as `CATRACE_PLUGIN_ID` and the protocol version are injected last and override manifest values.
5. **不**内置 Node/Python 运行时二进制（保持 2026-07-23「不 +40MB」）；要 Node 生态 = 用户机器有 Node，或插件自带 exe。
6. fingerprint：manifest + entry 文件 mtime/hash 变 → 重启 sidecar（与 background 窗重建对齐）。

### 4. Bridge 协议（sidecar ↔ 宿主）

v1：**一行一条 JSON，stdin/stdout**（简单、跨语言、好测）。

Sidecar → Host（stdout）：

```json
{"v":1,"op":"publish","event":{...同 plugin_publish 字段...}}
{"v":1,"op":"log","level":"info","message":"...","data":{}}
{"v":1,"op":"storage.set","key":"k","value":...}
{"v":1,"op":"storage.get","key":"k","id":"req-1"}
{"v":1,"op":"ready"}
{"v":1,"op":"error","message":"..."}
```

Host → Sidecar（stdin）：

```json
{"v":1,"op":"storage.get.result","id":"req-1","ok":true,"value":...}
{"v":1,"op":"config","value":{...整包 plugin config...}}
{"v":1,"op":"resolved","eventId":"...","actionId":"open-player","kind":"completed"}
{"v":1,"op":"shutdown"}
```

约束：

- `publish` 的 `kind`/`eventType` 仍走 manifest `events` + `allows_event`；source 由 Rust 填 Plugin id。
- sidecar **不能**自报 plugin id；进程由宿主按插件 id 拉起，身份绑定该 id。
- v1 **不**把任意 shell 字符串从 WebView 丢给 sidecar 当命令；sidecar 入口固定为 manifest。
- 日志/异常活跃观测复用 M11.1 思路（burst 等标 anomaly，不默认杀）。

### 5. 与 background.mjs 的关系

两种合法写法（文档都支持，demo 推荐 A）：

- **A. Sidecar 直接 publish**（少跳）：设备事件全在 sidecar，background 可省略或只做轻量。
- **B. Sidecar → background 再 publish**：sidecar 只 `log`/自定义 op `notify`；background 订阅后 `plugin_publish_event`（UI 编排更集中）。

v1 bridge 至少实现 A；B 可用 host 把 sidecar 行转 `catrace:plugin-sidecar` emit 到 `plugin-bg-<id>`。

Toast action → sidecar：沿用已有 `catrace:plugin-event-resolved`；宿主在 resolve Plugin 源事件时 **同时** 写一行 `resolved` 到该插件 sidecar stdin（若在跑）。

### 6. 信任与安全

与 [启用即信任](2026-07-23-step3-本地插件采用启用即信任而非逐项权限授权.md) 一致并写进产品文案：

> 启用带 sidecar 的插件 ≈ 允许该包装在本机拉起其声明的进程（脚本/二进制）。只装信任来源。

硬边界仍在 Rust：

- 不伪造 source / 不跨插件 storage  
- 禁用即杀进程  
- 不在 v1 提供「任意 command 字符串从远程配置注入」

**不做**：插件市场签名、逐项 OS 权限弹窗、Chromium sandbox  comms sidecar（sidecar 本就在沙箱外）。

### 7. 与旧决策的关系

| 旧决策 | 关系 |
|--------|------|
| 2026-07-23 隐藏 WebView 后台 | **仍成立**：默认 background 仍是 WebView；sidecar **可选增强**，不替换 M11 |
| 2026-07-23 「不做独立 Node 进程」 | **收窄**：不内置/不强制 Node；**允许**插件自带或系统解释器 sidecar |
| 2026-07-24 按需提供宿主能力 | **升级解释**：按需补的是 **原语**（open_path / sidecar 托管），不是业务 API；业务进插件 |
| M12 列表里的 `plugin_open` | 仍可做窄原语；**优先**让 sidecar 自 spawn，open_path 为「无 sidecar 的纯 background 插件」服务 |

## Consequences

### 正

- 蓝牙听歌、设备热插拔、本地工具链等 **零业务 Rust**  
- 第三方插件增长时宿主 API 面稳定  
- 保留 Tauri 体积与现有 Toast/M11 路径  

### 负 / 成本

- 要做进程管理、stdio 半包、崩溃重启、Windows 杀进程树  
- 依赖系统 `node`/`pwsh` 时有环境差异；纯 exe 插件无此问题  
- 恶意插件危害面 = 本机任意代码（启用即信任已接受，文案需醒目）  
- 双 JS 世界（WebView + 可选 Node）调试比纯 WebView 复杂  

### 明确不做（本决策范围）

- 整仓 Electron / Rubick 式 `nodeIntegration: true` 主世界  
- 内嵌 Node/deno 二进制进安装包  
- 为蓝牙等写宿主业务 command  

## Implementation pointer

真源：[plugin-native-sidecar-runtime.md](../architecture/desktop-event-os/plugin-native-sidecar-runtime.md)  
路线图回写：[step3-roadmap-plugin-runtime.md](../architecture/desktop-event-os/step3-roadmap-plugin-runtime.md) → **M15**

## Demo 验收（实现后）

1. [x] `tools/plugin-demo/sidecar-echo`：sidecar 每 15s stdout `publish` → Toast；action echo roundtrip 留卡刷新；dismiss 卸卡  
2. [x] disable 插件 → 进程消失（任务管理器 / 宿主 log）  
3. [ ] `tools/plugin-demo/bt-music`（可先 mock）：sidecar 模拟「设备连接」→ Toast → action → sidecar 启动记事本/配置路径  
4. [~] 恶意 `command: "../other/evil.exe"` → **按产品决策不做扫描期拒绝**；spawn 失败记运行时错误即可  

实现指针补充：commit `ecb5e3e`；Toast sticky action 约定见 features/toast-window 子文档。  
