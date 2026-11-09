# Catrace — Agent Guide

> AI 助手导航入口。详细文档见 [.agent/manifest.yaml](.agent/manifest.yaml)。

## 项目概述

Catrace 是一款桌面端事件 OS：以统一事件协议承载休息提醒、通知聚合与自定义插件，后台静默监听键鼠感知行为信号。所有信息保存在本地，不上传数据。

架构：[Desktop Event OS](.agent/architecture/desktop-event-os/README.md)。所有窗口与外部插件 UI 使用 React + Radix Themes，共享状态使用 zustand，详见[前端架构](.agent/architecture/react-migration/README.md)。

**插件生态**：外部插件在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护。插件中心按固定 commit 下载到 `app_data/plugins/`，安装后默认停用，用户通过开关启用。

## 关键规则

- **PR 使用中文**：创建或更新 Pull Request 时，标题和描述均用中文撰写。
1. **先读代码再改** — Rust 主组合在 [lib.rs](src-tauri/src/lib.rs)；Event/Signal 在 `event.rs` / `bus.rs` / `signal.rs`；主窗在 [src/app/pages/](src/app/pages/)，独立窗在 [src/app/windows/](src/app/windows/)，共享组件与业务状态在 [src/components/](src/components/) / [src/stores/](src/stores/)
2. **跨平台** — 任何平台相关代码必须 `#[cfg]` 隔离，标配降级方案
3. **不要自动启动 dev server** — 先跑 `pnpm typecheck` / `pnpm build` / `cargo check`
4. **前端尺寸用 rem** — `1rem = 16px`，例外：1px 边框、blur、SVG viewBox
5. **简单配置用 Store 插件** — 非业务核心的前端配置走 `@tauri-apps/plugin-store`，不进 SQLite
6. **修改版本号** — 用 `pnpm version:set <x.y.z>`，勿手改单文件。说明见 [version-management](.agent/reference/version-management.md)
7. **Event 渲染单源** — Toast 内容经 Event Bus，由独立 Toast 窗渲染；主窗 hub 只观察，不渲染第二张卡
8. **前端验证用 Playwright** — 连已运行的 `pnpm tauri dev`（`http://localhost:1420`）；不写 browser preview；除非用户明确叫你去前端验证，否则不要进行前端验证
9. **临时 Playwright 测试放 `e2e-temp/`** — 该目录已被 `.gitignore` 忽略，用于一次性探索性验证
10. **批量改文档/源码必须保换行与 BOM** — 禁止 `Path.write_text` / 整文件 decode→encode 重写去只改路径或短字符串。Windows 仓库混有 LF / CRLF，部分 `.md` 带 UTF-8 BOM；整文件重写会让 `git diff` 变成「全文修改」。正确做法：
    - 优先用能保原文件字节的编辑（`Edit` / 精确补丁）
    - 脚本批量替换时用 **二进制** 读写真：`raw.replace(old_bytes, new_bytes)`，勿先按文本规范化换行
    - 改完立刻 `git diff --numstat`：若出现整文件 `N N` 且内容只应改 1 行 → 停手，从 HEAD 恢复后按字节重做
    - 有意全文重写的文件（新建 README 等）可另论；路径回写、manifest 小补丁不行
11. **插件改在 catrace-plugin** — 插件代码在独立仓库 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin) 维护，需要修改时单独 clone。宿主通过插件中心按仓库 commit 安装到 `app_data/plugins/`。提交流程见规则 14；插件开发流程见[插件仓库 README](https://github.com/lanxiuyun/catrace-plugin/blob/main/README.md) / [SKILL](https://github.com/lanxiuyun/catrace-plugin/blob/main/SKILL.md)。
12. **知识写 features，不堆 decisions** — `.agent/features/` 写现行功能怎么用。只有「为什么必须这样、规避什么 bug」才作为该 feature 的补充段落。`.agent/decisions/` 已清空，不要再往里写。
13. **知识沉淀分仓库** — **插件相关的知识（feature 子文档、devlog、bug 记录）一律写插件仓库 `catrace-plugin` 的 `.agent/`**（自带 `manifest.yaml`，随插件仓库提交）；宿主根 `.agent/` 只放宿主侧知识。沉淀前先判断：只在这个插件成立 → 插件仓库；涉及宿主多模块协作 → 宿主 `.agent/`。
14. **按功能提交，标题就是更新说明** — 修改只落在工作区；只有用户明确要求「提交 / commit」后，才提交已完成的功能。宿主与插件分别在各自仓库按功能提交，不因插件仓库的内部提交另开宿主提交。提交标题用通俗、用户看得懂的功能描述，直接说明用户获得了什么。每个完成的功能（含同类微调）合并为一组提交。push 同理需用户点头。
15. **给用户的终端命令必须开箱即跑** — 汇报里的命令一律写全绝对路径（脚本/文件用绝对路径），做到用户新开一个终端、原样粘贴就能执行；不依赖当前目录、上文里的 cd 或路径省写。且必须兼容 PowerShell（用户默认终端）：换目录写 `cd D:\workspace\Catrace`，cmd 跨盘才用 `pushd`，**禁止 cmd 专属语法**（`cd /d`、`%VAR%` 等，在 PowerShell 里直接报错）。多终端协作（如终端 1 起 dev、终端 2 跑脚本）时，每个命令块都要自带完整路径并写清先后顺序
16. **官网更新说明只增不删** — 每次发版在 `website/latest/` 时间线最上方新增一条节点，首行固定 `版本号 - 一句改动摘要。`（版本号与本次发布一致，如 `26.10.15 - 提醒卡片首次弹出即可显示在最前。`，不用日期）；不写「发布 Catrace x.y.z」这类发版公告，明细只列本次新增改动，旧节点原样保留。先改 `preview.html`，确认后再同步 `index.html`。格式与节点模板见 [auto-update 发布链路](.agent/features/auto-update/README.md#发布链路)
