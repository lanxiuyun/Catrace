# 2026-08-11 插件抽离到 catrace-plugin 仓库并以 submodule 挂在 tools/plugin-demo

- 状态：已落地（host 提交 `ad34f84`，catrace-plugin 提交 `456e54e`）
- 类型：仓库/模块边界决策，延续 `2026-07-21-debug启动自动junction链接plugin-demo.md`

## 背景

插件此前直接放在宿主仓库 `tools/plugin-demo/`，问题：

- git 只跟踪了 3 个插件（`timer` / `bt-music` / `sidecar-echo`）；另 4 个实验插件（`github-notify` / `linuxdo-notify` / `notify-demo` / `smsforwarder-notify`）**从未进过 git**，只是本地目录。
- 宿主有**两处硬依赖 `tools/plugin-demo` 路径**：
  - debug：`plugins.rs::ensure_dev_plugin_links` 扫描该目录下含 `manifest.json` 的目录，junction 到 `app_data/plugins/<id>`
  - release：`tauri.conf.json` `bundle.resources` 打包 `timer`/`bt-music`/`sidecar-echo` 三个目录
- 需求：插件移到独立仓库方便维护，且改动不该每次同步回宿主。

## 决策

插件迁到独立仓库 **`catrace-plugin`**（github.com/lanxiuyun/catrace-plugin），并以 **git submodule** 挂在宿主 `tools/plugin-demo`。

- `tools/plugin-demo` 路径不变 → debug junction 扫描、release resources 全部无需改动。
- submodule 工作树即在宿主 checkout 内，日常开发仍可直接在 `Catrace/tools/plugin-demo/` 编辑，commit 推插件仓库，宿主用指针锁版本。
- 插件仓库结构：插件目录直接放**根**（不要套 `plugins/` 子目录，否则 junction 扫描和 resources 映射全断）。

## 备选方案与取舍

| 方案 | 结论 |
|------|------|
| 本地 junction 指向新仓库 | 换机器 / CI / release 打包会断，不可移植 → 弃 |
| 双份 + 同步脚本 | 易漂移 → 弃 |
| **git submodule** | 版本锁定、跨平台、CI 友好、单一真源 → 选 |

代价：克隆宿主后需 `git submodule update --init --recursive`；插件仓库有改动后宿主需 `git add tools/plugin-demo` 更新指针。

## 仓库整理要点

- 7 个插件全部提交；实验插件原样进库。
- `.gitignore` 忽略 `**/runtime/state.json`：这是 sidecar 的**运行时个人数据**（`seen` 去重表 + `etag`/`lastModified` HTTP 缓存 + `savedAt`），不应入库。
- `开发计划.md` 个人笔记一并提交。
- 插件仓库根 `README.md`（完整开发流程）+ `SKILL.md`（开发 skill）。

## 操作要点与坑

- **Windows 目录锁**：运行的 `catrace.exe` + sidecar（`node runtime/main.mjs`）会锁住插件目录（junction 目标），导致 `Move-Item`/`Remove-Item` 报「目录被占用」。先关 app、杀 sidecar 再动目录。
- **换行差异**：autocrlf 会让同一仓库在 Windows checkout 出 CRLF；比对两棵目录用 `git diff --no-index` 或先统一换行，别直接用字节 hash 下结论。
- **UTF-8 判定**：PowerShell 控制台按 GBK 码页转码会让人误判文件编码，用 Node 严格解码验证，见 `../reference/windows-PowerShell控制台GBK码页导致UTF8字节误判.md`。

## 影响

- 宿主 `plugins.rs` / `tauri.conf.json` / `.agent` 中对 `tools/plugin-demo/...` 的引用全部照常解析。
- 克隆宿主的新协作者必须先 `git submodule update --init --recursive`，否则 `tools/plugin-demo` 为空，插件缺失。
- 后续新增插件流程见插件仓库 `README.md`（提交到插件仓库 + 宿主 `bundle.resources` 补行）。
