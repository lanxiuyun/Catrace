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
8. **前端验证用 Playwright** — 连已运行的 `pnpm tauri dev`（`http://localhost:1420`）；不写 browser preview；除非用户明确叫你去前端验证，否则不要进行前端验证
9. **临时 Playwright 测试放 `e2e-temp/`** — 该目录已被 `.gitignore` 忽略，用于一次性探索性验证
10. **批量改文档/源码必须保换行与 BOM** — 禁止 `Path.write_text` / 整文件 decode→encode 重写去只改路径或短字符串。Windows 仓库混有 LF / CRLF，部分 `.md` 带 UTF-8 BOM；整文件重写会让 `git diff` 变成「全文修改」。正确做法：
    - 优先用能保原文件字节的编辑（`Edit` / 精确补丁）
    - 脚本批量替换时用 **二进制** 读写真：`raw.replace(old_bytes, new_bytes)`，勿先按文本规范化换行
    - 改完立刻 `git diff --numstat`：若出现整文件 `N N` 且内容只应改 1 行 → 停手，从 HEAD 恢复后按字节重做
    - 有意全文重写的文件（新建 README 等）可另论；路径回写、manifest 小补丁不行
