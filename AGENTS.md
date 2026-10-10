# Catrace — Agent Guide

> AI 助手导航入口。详细文档见 [.agent/manifest.yaml](.agent/manifest.yaml)。

## 项目概述

Catrace 是一款桌面端事件 OS：以统一事件协议承载休息提醒、通知聚合与自定义插件，后台静默监听键鼠感知行为信号。所有信息保存在本地，不上传数据。

已演进为 **Desktop Event OS**（事件协议 + Bus + Signal 行为感知 + 插件生态），**Step 2–4 已全部关账**。架构与里程碑：  
[.agent/architecture/desktop-event-os/README.md](.agent/architecture/desktop-event-os/README.md)

**插件生态**：外部插件已抽离到独立仓库 `catrace-plugin`（github.com/lanxiuyun/catrace-plugin），以 git submodule 挂在 `tools/plugin-demo/`（debug 自动 junction 到 `app_data/plugins/`，release 由 `tauri.conf.json` 打包）。开发插件见该仓库根 `README.md` / `SKILL.md`。

## 关键规则

- **PR 使用中文**：创建或更新 Pull Request 时，标题和描述均用中文撰写。
1. **先读代码再改** — Rust 主组合在 `src-tauri/src/lib.rs`；Event/Signal 在 `event.rs` / `bus.rs` / `signal.rs`；前端在 `src/views/`、`src/components/`、`src/stores/`
2. **跨平台** — 任何平台相关代码必须 `#[cfg]` 隔离，标配降级方案
3. **不要自动启动 dev server** — 先跑 `pnpm vue-tsc --noEmit` / `pnpm build` / `cargo check`
4. **前端尺寸用 rem** — `1rem = 16px`，例外：1px 边框、blur、SVG viewBox
5. **简单配置用 Store 插件** — 非业务核心的前端配置走 `@tauri-apps/plugin-store`，不进 SQLite
6. **修改版本号** — 用 `pnpm version:set <x.y.z>`，勿手改单文件。说明见 [version-management](.agent/reference/version-management.md)
7. **Event 双写** — Toast 仍是可见权威；bus 失败不挡 Toast；hub 不渲染第二张卡
8. **前端验证用 Playwright** — 连已运行的 `pnpm tauri dev`（`http://localhost:1420`）；不写 browser preview；除非用户明确叫你去前端验证，否则不要进行前端验证
9. **临时 Playwright 测试放 `e2e-temp/`** — 该目录已被 `.gitignore` 忽略，用于一次性探索性验证
10. **批量改文档/源码必须保换行与 BOM** — 禁止 `Path.write_text` / 整文件 decode→encode 重写去只改路径或短字符串。Windows 仓库混有 LF / CRLF，部分 `.md` 带 UTF-8 BOM；整文件重写会让 `git diff` 变成「全文修改」。正确做法：
    - 优先用能保原文件字节的编辑（`Edit` / 精确补丁）
    - 脚本批量替换时用 **二进制** 读写真：`raw.replace(old_bytes, new_bytes)`，勿先按文本规范化换行
    - 改完立刻 `git diff --numstat`：若出现整文件 `N N` 且内容只应改 1 行 → 停手，从 HEAD 恢复后按字节重做
    - 有意全文重写的文件（新建 README 等）可另论；路径回写、manifest 小补丁不行
11. **插件改在 catrace-plugin** — 克隆宿主后先 `git submodule update --init --recursive`，否则 `tools/plugin-demo/` 为空。插件代码只在其仓库维护：直接编辑 `tools/plugin-demo/<id>/`（即插件仓库 checkout）。插件改动与宿主 submodule 指针统一纳入用户要求提交的功能变更中；不得因插件仓库内部先产生 commit 就单独提交宿主的 submodule 指针。提交流程与标题要求见规则 14。插件开发完整流程见插件仓库 `README.md` / `SKILL.md`
12. **知识写 features，不堆 decisions** — `.agent/features/` 写现行功能怎么用。只有「为什么必须这样、规避什么 bug」才作为该 feature 的补充段落。`.agent/decisions/` 已清空，不要再往里写。
13. **知识沉淀分仓库** — **插件相关的知识（feature 子文档、devlog、bug 记录）一律写插件子仓库 `tools/plugin-demo/.agent/`**（自带 `manifest.yaml`，随插件仓库提交）；宿主根 `.agent/` 只放宿主侧知识。沉淀前先判断：只在这个插件成立 → 插件仓库；涉及宿主多模块协作 → 宿主 `.agent/`。
14. **按功能提交，标题就是更新说明** — 修改只落在工作区；只有用户明确要求「提交 / commit」后，才提交已完成的功能。插件仓库内部 commit 只是实现过程：用户未要求提交功能前，不因插件仓库 commit 或 submodule 指针变化单独提交宿主。用户要求提交时，插件实现以功能为单位在插件仓库提交；宿主只在同一功能提交中更新 submodule 指针，不为指针更新另开一笔提交。两仓库的提交标题都用通俗、用户看得懂的功能描述，直接说明用户获得了什么；功能描述就是 commit 标题，禁止用「更新 submodule 指针」等实现细节作标题。每个完成的功能（含同类微调）合并为一组提交。push 同理需用户点头。
15. **给用户的终端命令必须开箱即跑** — 汇报里的命令一律写全绝对路径（脚本/文件用绝对路径），做到用户新开一个终端、原样粘贴就能执行；不依赖当前目录、上文里的 cd 或路径省写。且必须兼容 PowerShell（用户默认终端）：换目录写 `cd D:\workspace\Catrace`，cmd 跨盘才用 `pushd`，**禁止 cmd 专属语法**（`cd /d`、`%VAR%` 等，在 PowerShell 里直接报错）。多终端协作（如终端 1 起 dev、终端 2 跑脚本）时，每个命令块都要自带完整路径并写清先后顺序
