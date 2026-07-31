# 外部插件 settings 通过通用 Sidecar RPC 调用桌面能力

`sidecar-echo` 不只验证 sidecar JSONL/Toast 生命周期，也验证插件 Settings 与独立 Node sidecar 的双向请求/响应。

## 正确边界

`src-tauri/src/plugin_sidecar.rs` 只提供通用 `plugin_sidecar_request(pluginId, method, params)` 管道：生成 requestId、写 stdin、匹配 stdout response、超时返回。Rust 不认识环境变量、文件对话框、程序启动或 HTTP 这些具体业务。

具体能力全部由 `tools/plugin-demo/sidecar-echo/runtime/main.mjs` 实现：

| Method | Node sidecar 实现 |
|--------|-------------------|
| `environment.get` | `process.env` |
| `dialog.pickFile` | Windows PowerShell / macOS osascript / Linux zenity 或 kdialog |
| `dialog.pickFolder` | 同上，切换目录选择模式 |
| `process.spawn` | `node:child_process.spawn`，返回 PID |
| `http.get` | Node `fetch`，返回状态、最终 URL、Content-Type 与正文 |

## JSONL RPC

Settings → sidecar stdin：

```json
{"v":1,"op":"request","requestId":"sidecar-echo-1","method":"http.get","params":{"url":"https://example.com"}}
```

sidecar stdout → Settings：

```json
{"v":1,"op":"response","requestId":"sidecar-echo-1","ok":true,"result":{"status":200}}
```

失败时返回 `ok:false` 和 `error`。宿主只按 requestId 路由，不解释 method。

## 文件

- `src-tauri/src/plugin_sidecar.rs` — 通用 request/response 管道
- `src-tauri/src/lib.rs` — 注册唯一通用 invoke command
- `tools/plugin-demo/sidecar-echo/settings.mjs` — Settings 发起通用 RPC
- `tools/plugin-demo/sidecar-echo/runtime/main.mjs` — 插件自己的桌面能力实现

## 约定

1. Settings 运行在主窗口，RPC command 仅接受 main window 调用，并校验插件已启用且 sidecar 正在运行。
2. 本地插件采用“启用即信任”；sidecar 本身就是本机代码，可读环境变量、访问网络和启动程序。
3. 新增插件业务能力时只改插件 runtime，不给 Rust 增加 `plugin_demo_*` 专用 command。
4. request 等待放在 blocking task，避免阻塞 Tauri async 主执行路径。
5. 当前 RPC 超时为 30 秒；适合交互和短操作，不用于长期流式任务。

## 验证

- `cargo check`
- `vue-tsc --noEmit`
- `node --check tools/plugin-demo/sidecar-echo/settings.mjs`
- `node --check tools/plugin-demo/sidecar-echo/runtime/main.mjs`
- 重启 Rust 应用后手测环境变量、文件/目录选择、程序启动和 GET。
