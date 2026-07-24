# Catrace — Agent Guide

> AI 助手导航入口。详细文档见 [.agent/manifest.yaml](.agent/manifest.yaml)。

## 项目概述

Catrace 是一款桌面端工具，帮助用户平衡工作与休息。后台静默监听键鼠，连续活跃超阈值时通过系统提醒用户休息。不上传数据，所有信息保存在本地。

正在演进为 **Desktop Event OS**（事件协议 + Bus + Signal 行为感知）。Step 2 计划真源：  
[.agent/architecture/desktop-event-os/step2-roadmap-event-core-and-signal-core.md](.agent/architecture/desktop-event-os/step2-roadmap-event-core-and-signal-core.md)

## 关键规则

1. **先读代码再改** — Rust 主组合在 `src-tauri/src/lib.rs`；Event/Signal 在 `event.rs` / `bus.rs` / `signal.rs`；前端在 `src/views/`、`src/components/`、`src/stores/`
2. **跨平台** — 任何平台相关代码必须 `#[cfg]` 隔离，标配降级方案
3. **不要自动启动 dev server** — 先跑 `pnpm vue-tsc --noEmit` / `pnpm build` / `cargo check`
4. **前端尺寸用 rem** — `1rem = 16px`，例外：1px 边框、blur、SVG viewBox
5. **简单配置用 Store 插件** — 非业务核心的前端配置走 `@tauri-apps/plugin-store`，不进 SQLite
6. **修改版本号** — 先读 [version-management](.agent/reference/version-management.md)
7. **Event 双写** — Toast 仍是可见权威；bus 失败不挡 Toast；hub 不渲染第二张卡
8. **前端验证用 Playwright** — 连已运行的 `pnpm tauri dev`（`http://localhost:1420`）；不写 browser preview；除非用户明确叫你去前端验证，否则不要启动 dev server/preview
9. **临时 Playwright 测试放 `e2e-temp/`** — 该目录已被 `.gitignore` 忽略，用于一次性探索性验证
