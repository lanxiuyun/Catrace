# Plugin Native Sidecar Runtime（M15）

> **设计真源**。决策：[2026-07-30-plugin-native-sidecar-runtime](../../decisions/2026-07-30-plugin-native-sidecar-runtime.md)  
> Status: M15.1–M15.2 真机验收通过（lifecycle + publish/log + resolved 回传 + sidecar-echo）；M15.3 storage/UI 未做；扫描期路径/解释器安全校验按产品决策不做
> 上级路线图：[step3-roadmap-plugin-runtime.md](step3-roadmap-plugin-runtime.md)

## 0. 一句话

**WebView background 继续编排；要动 OS 时插件自带 sidecar 进程；Rust 只托管进程 + 窄 bridge，不写业务洞。**

## 1. 为什么要有这层

| 压力 | 没有 sidecar | 有 sidecar |
|------|----------------|------------|
| 蓝牙耳机 → Toast → 开播放器 | 宿主加蓝牙 API + open API | 插件 `runtime/` 自己听设备、自己 spawn |
| 第 N 个硬件/脚本插件 | Rust 开第 N 个洞 | 宿主不动 |
| 信任模型 | 启用即信任但跑不了真本机代码 | 启用 = 允许声明的本地进程 |

M11 已解决「后台常驻 JS」。M15 解决「本机原生能力放哪」。

## 2. 进程拓扑

```
                    ┌─────────────────────────────┐
                    │  Catrace main (Rust/Tauri)  │
                    │  PluginManager              │
                    │  PluginWindowManager (M11)  │
                    │  PluginSidecarManager (M15) │
                    └──────────┬──────────────────┘
           enable+background   │   enable+sidecar
                ▼              │          ▼
     ┌──────────────────┐      │   ┌──────────────────┐
     │ plugin-bg-<id>   │      │   │ child process    │
     │ background.mjs   │◄─────┼──►│ (node/ps1/exe)   │
     │ (hidden WebView) │ emit │   │ stdio JSON lines │
     └────────┬─────────┘      │   └────────┬─────────┘
              │ publish        │            │ publish/log/storage
              ▼                │            ▼
     EventBus → Toast ui.mjs   │   同一套 allows_event / storage 命名空间
```

- 可只有 background、只有 sidecar、或两者都有。  
- Toast / settings **不**直接连 sidecar；经 Bus 与 resolved 回传。

## 3. manifest 扩展

在现有 M10/M11 字段上增加 **可选** `sidecar`：

```json
{
  "id": "bt-music",
  "name": "蓝牙听歌",
  "version": "0.1.0",
  "main": "ui.mjs",
  "background": "background.mjs",
  "settings": "settings.mjs",
  "events": ["bt-music", "kind:bt-music", "bt-music.connected"],
  "enabledByDefault": false,
  "sidecar": {
    "command": "node",
    "args": ["runtime/main.js"],
    "cwd": ".",
    "env": {
      "BT_MUSIC_DEBUG": "1"
    }
  }
}
```

| 字段 | 规则 |
|------|------|
| Field | Runtime rule |
|------|------|
| `command` | Passed to the OS process API. Relative paths use the plugin root; bare names use system `PATH` |
| `args` | Passed through unchanged |
| `cwd` | Defaults to `.` under the plugin root, but other paths are allowed |
| `env` | Optional string map; host `CATRACE_*` values are injected last |

Without `sidecar`, behavior is unchanged. Manifest scanning only parses structure; it does not apply path, interpreter allowlist, or environment-variable security checks. Spawn failures are runtime errors.

## 4. 宿主模块（实现）

| 模块 | 职责 | 状态 |
|------|------|------|
| `src-tauri/src/plugin_sidecar.rs` | 启停、stdout JSONL、stdin resolved/shutdown、杀进程树；写 stdin 不持 running 锁 | ✅ M15.1–M15.2 |
| `plugins.rs` | 解析 `sidecar` → `PluginSidecarSpec` / 列表；与 enable/rescan 同步 | ✅ |
| `plugin_commands.rs` | publish/log 入站与 background 共用校验路径 | ✅ publish/log；storage 待 M15.3 |
| `bus.rs` | resolve 后 `notify_plugin_resolved` → sidecar stdin | ✅ |
| `lib.rs` | `PluginSidecarManager` state；与 window 同一 schedule 点 | ✅ |
| Plugins UI / anomaly | sidecar 运行态展示 | ⏳ M15.3 |

启停触发与 M11 对齐：

- `initial_scan` / rescan / set_enabled / 退出  
- **禁止**在 `setup()` 同步长阻塞；`spawn_blocking` + 锁，同 `PluginWindowManager::schedule_sync`
- **扫描期不做**路径穿越 / 解释器 allowlist / env 安全校验（产品决策）；spawn 失败当运行时错误

## 5. Bridge 协议 v1

### 5.1 传输

- Windows / macOS / Linux：子进程 **stdin / stdout**  
- 文本 UTF-8，**JSON Lines**（一条 JSON + `\n`）  
- stderr：宿主按行 `plugin_log` level=warn（截断单行长度，防刷盘）  
- 缓冲：按行拆包；单行上限建议 1 MiB，超限记 anomaly 并丢该行  

### 5.2 Sidecar → Host

| op | 作用 | 备注 |
|----|------|------|
| `ready` | 握手完成 | 可选；超时未 ready 仅 log |
| `publish` | 发 Bus 事件 | body 同 `PluginPublishInput` 语义；source 由宿主填 |
| `log` | 写宿主日志 | |
| `storage.set` / `storage.get` | 私有 KV | get 需 `id` 关联响应 |
| `error` | 插件自报错误 | 可标 anomaly |

示例：

```json
{"v":1,"op":"publish","event":{
  "eventType":"bt-music.connected",
  "kind":"bt-music",
  "title":"耳机已连接",
  "body":"WH-1000XM5",
  "dedupeKey":"bt-music:connected",
  "actions":[{"id":"open-player","label":"打开听歌"}],
  "payload":{"deviceName":"WH-1000XM5"}
}}
```

### 5.3 Host → Sidecar

| op | 时机 |
|----|------|
| `config` | 启动后推送整包 config；config 变更可再推 |
| `storage.get.result` | 应答 get |
| `resolved` | 用户点 Toast action / dismiss（Plugin 源） |
| `shutdown` | 禁用前尽量优雅退出；随后仍 SIGKILL/taskkill 兜底 |
| `activity`（可选 v1.1） | 周期推送 activity 快照，免 sidecar 再调别的 |

### 5.4 身份

- 进程在 `PluginSidecarManager` 的 map 里键为 `plugin_id`  
- 入站 op **不**信任 JSON 内的 pluginId 字段（若有则忽略）  
- publish → `EventSource::Plugin { name: plugin_id }`

## 6. 生命周期状态机

```
disabled
   │ enable + sidecar 校验通过
   ▼
starting ──spawn fail──► error (UI 可见，可重试)
   │ ready 或首条合法 op
   ▼
running ──crash──► backoff restart（有限次数）──► error
   │ disable / app exit / fingerprint change
   ▼
stopping → (shutdown 宽限 e.g. 1s) → kill → disabled
```

- 与 background 窗：**独立**失败域。sidecar 挂了不自动毁 WebView；WebView 挂了不自动杀 sidecar（但 disable 两者都停）。  
- 重启策略 v1：崩溃后最多 3 次、指数退避；再失败标 anomaly + error，等用户 disable/enable。

## 7. Command execution contract

- Local plugins use the existing enable-means-trust model. The host does not restrict `command`, `args`, `cwd`, or plugin-provided environment variables.
- Relative commands resolve from the plugin root; bare names use system `PATH`; absolute paths are passed through.
- The host retains lifecycle boundaries only: start while enabled and terminate the process tree on disable, uninstall, or app exit.
- Host identity values such as `CATRACE_PLUGIN_ID` and `CATRACE_PROTOCOL_VERSION` are injected last, so manifest values with the same names do not take effect.
- Spawn failures are runtime errors and do not invalidate the plugin during manifest scanning.

## 8. 与现有能力的分工

| 需求 | 推荐落点 |
|------|----------|
| 定时提醒、读 activity、发 Toast | background.mjs（现有） |
| 蓝牙/USB/音频端点/WMI | **sidecar** |
| 启动播放器/打开目录 | sidecar `spawn` 或原语 `plugin_open_path` |
| 自定义 Toast UI | ui.mjs |
| 用户配置播放器路径 | settings.mjs → plugin_config |
| 连 napcat WebSocket | background `WebSocket` 即可，不必 sidecar |

`plugin_open_path`（若做）：

- 仅 background 窗 label 身份  
- 目标为绝对 path 或 `http(s):`；**不做** `cmd /c` 拼接  
- 有 sidecar 的插件可不用它

## 9. 插件作者指南（摘要）

### 最小 sidecar（Node）

`runtime/main.js`：

```js
import readline from 'node:readline'

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

send({ v: 1, op: 'ready' })
send({
  v: 1,
  op: 'log',
  level: 'info',
  message: 'sidecar up',
  data: { pluginId: process.env.CATRACE_PLUGIN_ID },
})

// 示例：定时 publish；真蓝牙在此替换
setInterval(() => {
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'sidecar-echo.tick',
      kind: 'sidecar-echo',
      title: 'Sidecar',
      body: 'hello from native runtime',
      dedupeKey: 'sidecar-echo:tick',
    },
  })
}, 15_000)

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.op === 'shutdown') process.exit(0)
  if (msg.op === 'resolved' && msg.actionId === 'open-player') {
    // spawn player from config — config 可由 host 推送
  }
})
```

### 目录

```
plugins/bt-music/
  manifest.json
  ui.mjs
  background.mjs          # 可选
  settings.mjs
  runtime/
    main.js
    package.json          # 可选；作者自管依赖，宿主不 npm install
```

宿主 **不** 在启用时执行 `npm install`（v1）。需要依赖：作者打 exe，或文档要求用户在插件目录自装。

## 10. Demo 包（实现里程碑附带）

| 包 | 目的 | 状态 |
|----|------|------|
| `tools/plugin-demo/sidecar-echo` | 无硬件：15s timer publish + action echo roundtrip + dismiss；disable 杀进程 | ✅ 真机验收 |
| `tools/plugin-demo/bt-music` | 目标场景；mock「模拟连接」→ Toast → open-player；可选 Windows PnP 轮询且 **必须** `DEVPKEY_Device_IsConnected=True`（配对≠连接） | ✅ 包已落地；模拟 + 真机 IsConnected 门控已手测 |

Debug junction 规则与现有 demo 相同（`ensure_dev_plugin_links`）。

**sidecar-echo 手测要点**：回传 Sidecar 后卡不消失且序号/payload 更新；点完成卸卡；连点不冻透明 toast 窗。  
Toast 约定见 [.agent/features/toast-window/插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md](../../features/toast-window/插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md)。

## 11. 实现顺序（建议切片）

1. ~~**Manifest parsing + spec**~~ ✅  
2. ~~**PluginSidecarManager 启停 + 杀进程树**~~ ✅  
3. ~~**stdout 行解析 → publish/log**~~ ✅  
4. ~~**stdin：shutdown + resolved 转发**~~ ✅  
5. **storage get/set 往返** ⏳ M15.3  
6. **Plugins UI：sidecar 状态 / 错误 / anomaly** ⏳ M15.3  
7. ~~**sidecar-echo demo 真机验收**~~ ✅（含 toast echo keep / dismiss 卸卡）  
8. **桌面能力完整 demo** ✅ 真机验收：`sidecar-echo/settings.mjs` 验证环境变量、文件/目录选择、启动程序、HTTP GET；见 [外部插件-settings调用宿主桌面能力-demo.md](外部插件-settings调用宿主桌面能力-demo.md)
9. **bt-music demo** ✅ 包已落地并手测（模拟全链路 + Windows `IsConnected` 真连接门控；见 [[bt-music]]）
10. （可选）`plugin_open_path` 给无 sidecar 插件
11. 信任文案补「sidecar = 本机任意代码」⏳

## 12. 完成定义（M15）

- [x] 启用含合法 `sidecar` 的插件会拉起进程；禁用后无残留子进程  
- [x] sidecar `publish` 与 background `plugin_publish_event` 同等校验（events 白名单、保留 kind）  
- [x] Missing command or interpreter produces a clear runtime error without crashing the host
- [x] Toast action resolve 能到达 sidecar stdin  
- [x] `sidecar-echo` 手测通过（回传留卡 / 完成卸卡 / 不冻窗）  
- [x] Settings → 通用 sidecar RPC → Node 桌面能力手测通过（环境 / 文件 / 目录 / 进程 / GET）
- [ ] 文档与 m10 信任说明更新「sidecar = 本机代码」  
- [x] **无** 蓝牙/业务专用 Rust API  
- [ ] sidecar storage request/response（M15.3）  
- [ ] Plugins UI runtime 状态（M15.3）  

## 13. 风险

| 风险 | 缓解 |
|------|------|
| 孤儿进程 | Job Object / 进程组；exit 钩子 |
| Malicious plugin | Enable-means-trust warning; no marketplace; install trusted sources only |
| Node 未安装 | 明确错误；推荐自带 exe 或 ps1 |
| stdio 死锁 | 读 stdout/stderr 独立线程；写 stdin 带队列 |
| 与「不内置 Node」冲突误解 | 文档写清：可选、外置、不进安装包 |
| 隐藏 WebView 决策被误读为推翻 | ADR 写明 M11 仍默认；sidecar 可选 |

## 14. 相关

- [m10-external-plugins.md](m10-external-plugins.md) — Card / settings / 信任  
- [step3-roadmap-plugin-runtime.md](step3-roadmap-plugin-runtime.md) — M11–M15  
- [2026-07-23-step3-插件后台运行时用隐藏webview窗口.md](../../decisions/2026-07-23-step3-插件后台运行时用隐藏webview窗口.md)  
- [2026-07-24-step3-宿主能力改为随具体插件按需提供.md](../../decisions/2026-07-24-step3-宿主能力改为随具体插件按需提供.md)  
- [2026-07-30-plugin-native-sidecar-runtime.md](../../decisions/2026-07-30-plugin-native-sidecar-runtime.md) — ADR  
- [../../bugs/2026-07-31-sidecar-echo回传动作导致toast卡死与完成关不掉.md](../../bugs/2026-07-31-sidecar-echo回传动作导致toast卡死与完成关不掉.md) — echo 回传卡死  
- [../../features/toast-window/插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md](../../features/toast-window/插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md) — sticky action 留卡规则  
- [../../devlog/2026-07-31-M15-sidecar运行时与echo演示及toast回传卡死修复.md](../../devlog/2026-07-31-M15-sidecar运行时与echo演示及toast回传卡死修复.md) — 本轮 devlog  
