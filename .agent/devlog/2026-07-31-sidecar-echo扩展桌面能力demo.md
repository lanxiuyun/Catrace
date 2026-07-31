# 2026-07-31 sidecar-echo 扩展桌面能力 Demo

## Session goal

把现有 sidecar-echo 扩展成可验证外部插件 Settings 与宿主桌面能力的完整 Demo。

## Completed

- 新增通用 Settings → sidecar JSONL request/response RPC；Rust 不解释具体 method。
- Settings 自动读取并展示 Node sidecar 环境变量。
- 文件/目录选择、程序启动和 HTTP GET 均由插件 Node runtime 实现。
- 增加选择可执行文件、传参启动并显示 PID。
- 增加 Node fetch HTTP GET 与响应展示。
- 保留原 sidecar 定时 Toast、action resolved 回传能力。
- 通过 Rust、前端类型、插件 ESM 语法与 manifest JSON 检查。
- 真机确认环境变量读取、文件选择、文件夹选择、程序启动和 HTTP GET 均正常。

## Pending

- M15.3 sidecar storage request/response 与插件中心 runtime 状态仍按路线图推进。

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/plugin_sidecar.rs` | 增加唯一通用 request/response RPC 管道 |
| `src-tauri/src/lib.rs` | 注册通用 `plugin_sidecar_request` |
| `tools/plugin-demo/sidecar-echo/settings.mjs` | 通过通用 RPC 使用能力 |
| `tools/plugin-demo/sidecar-echo/runtime/main.mjs` | 插件自己的环境、对话框、进程和网络实现 |
| `tools/plugin-demo/sidecar-echo/manifest.json` | 版本升级并声明 settings |
