# 2026-08-11 插件抽离 catrace-plugin 仓库与仓库文档/skill

## Session goal

把 `tools/plugin-demo/` 的插件搬到独立仓库 `catrace-plugin`，宿主用 submodule 挂载，并补齐插件仓库的 README（完整开发流程）与开发 skill。

## Completed

- 确认 7 个插件文件均为合法 UTF-8/JSON（之前 PowerShell 显示的 GBK 是控制台码页假象）。
- `catrace-plugin` 仓库：`.gitignore`（忽略 `**/runtime/state.json`）+ 新 README + 全部 7 个插件，提交 `456e54e` 并推送 `main`。
- 宿主 `tools/plugin-demo` 删除 → submodule 指向 `catrace-plugin@456e54e`，提交 `ad34f84`（分支 `catraceV2`，未推送）。
- 处理运行中 `catrace.exe` + sidecar 对 `bt-music` 目录的锁，释放后完成迁移。
- 插件仓库根新增 `README.md`（架构决策/合同/ui/settings/background/sidecar/测试/自检/发布完整流程）与 `SKILL.md`（开发 skill，后从 `skills/` 移根），提交 `8c45846` / `7294f7a` / `f866b3a`，未推送。

## Remaining

- 宿主仓库 `catraceV2` 分支待推送（ahead 1）。
- 插件仓库 3 个 docs 提交待推送。
- 可选：`catrace-plugin/SKILL.md` 软链到全局 skills 目录让 AI 自动加载。

## Key file changes

| File | Change |
|------|--------|
| `catrace-plugin/.gitignore` | 忽略 `**/runtime/state.json` 运行时产物 |
| `catrace-plugin/README.md` | 完整插件开发流程：架构决策 → manifest → 各文件合同 → 测试 → 自检 → 发布 |
| `catrace-plugin/SKILL.md` | 开发 skill（仓库根），含自检清单与反模式 |
| `Catrace/.gitmodules` | 新增 `tools/plugin-demo` → catrace-plugin |
| `Catrace/tools/plugin-demo` | 由本地目录改为 submodule 挂载 |
| `Catrace/tauri.conf.json` / `plugins.rs` | **未改**，路径沿用 `tools/plugin-demo` |

## 沉淀

- 决策：`decisions/2026-08-11-插件抽离到catrace-plugin仓库并以submodule挂在tools-plugin-demo.md`
- 参考：`reference/windows-PowerShell控制台GBK码页导致UTF8字节误判.md`（跨项目可复用）
