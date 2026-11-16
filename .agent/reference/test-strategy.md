# 测试策略

## 默认验证顺序

先运行 `pnpm typecheck`，再运行 `pnpm test` 与 `pnpm build`。Rust 使用 cargo check／test，具体模块与测试数量以源码为准，不在文档缓存计数。

- [test-react-state.mjs](../../scripts/test-react-state.mjs)：zustand registry／Event Hub、语言与主题跨窗事件、bootstrap 身份分流。
- [scripts/](../../scripts/) 的 test-*.mjs：插件模块与安装来源等 source-backed 回归。
- [toast.test.mjs](../../src/app/windows/toast/toast.test.mjs)：Toast 纯逻辑、计时、Bus 和卸载资源回收。
- Rust 重点覆盖 block／提醒、Bus、插件安装安全与来源、平台通知和窗口纯逻辑。真实网络 smoke 与桌面焦点不能仅靠 mock 证明。

## UI 与原生窗口

只有用户明确要求时，才用 Playwright 连接已经运行的 Tauri 开发窗口；不自动启动 dev／preview，不以浏览器替身证明 Win32 焦点、DPI 或原生层级正确。

临时探索测试放 e2e-temp。UI 用 DOM／截图断言；多屏、缩放、首次点击、轻量模式重建与停止后台进程需各自的实机证据。纯模块测试使用 mock Tauri，不写用户 AppData、不联网、不操作桌面。
