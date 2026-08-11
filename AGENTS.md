# Catrace — Agent Guide

> AI 助手导航入口。详细文档见 [.agent/manifest.yaml](.agent/manifest.yaml)。

## 项目概述

Catrace 是一款桌面端事件 OS：以统一事件协议承载休息提醒、通知聚合与自定义插件，后台静默监听键鼠感知行为信号。所有信息保存在本地，不上传数据。

已演进为 **Desktop Event OS**（事件协议 + Bus + Signal 行为感知 + 插件生态），**Step 2–4 已全部关账**。架构与里程碑：  
[.agent/architecture/desktop-event-os/README.md](.agent/architecture/desktop-event-os/README.md)

**插件生态**：外部插件已抽离到独立仓库 `catrace-plugin`（github.com/lanxiuyun/catrace-plugin），以 git submodule 挂在 `tools/plugin-demo/`（debug 自动 junction 到 `app_data/plugins/`，release 由 `tauri.conf.json` 打包）。开发插件见该仓库根 `README.md` / `SKILL.md`。

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
11. **插件改在 catrace-plugin** — 克隆宿主后先 `git submodule update --init --recursive`，否则 `tools/plugin-demo/` 为空。插件代码只在其仓库维护：直接编辑 `tools/plugin-demo/<id>/`（即插件仓库 checkout）→ commit 推 catrace-plugin `main` → 宿主 `git add tools/plugin-demo` 更新 submodule 指针。插件开发完整流程见插件仓库 `README.md` / `SKILL.md`
