# 2026-07-17 — P4 Hook 安装可靠性

> 对应路线图 P4，见 [roadmap-and-progress.md](../features/agent-notification/roadmap-and-progress.md)。
> 改前参考 [hook-install-development-guide.md](../features/agent-notification/hook-install-development-guide.md) §6 缺口表。

## 背景

Windows 上 agent 跑 hook 的 shell 与 clawd-on-desk 不同，Catrace 原来统一写 `node "path"`，在干净 Windows 机上可能静默失败（hook 根本不跑，通知「像没做」）。同时安装是 skip-if-present，脚本路径/node 路径变更后配置陈旧。

## 改动（全部在 `src-tauri/src/agent_hook.rs`）

| 项 | 实现 |
|----|------|
| **Claude Windows 包装** | `claude_hook_spec`：win32 写 `shell: "powershell"` + `command: "& \"node\" \"script\""`；POSIX 用 node 绝对路径 + 引号形式 |
| **Codex 双字段** | `codex_hook_spec`：win32 写 `commandWindows`（`&` 调用符）+ `command`（WSL plain、`\`→`/`）；共享 `CODEX_HOME` 时各走各的 |
| **node 绝对路径** | `resolve_node_path`（仅 POSIX 有实现）：先查 PATH，再兜底 Homebrew(`/opt/homebrew` `/usr/local`)/nvm/fnm/volta 常见位置 |
| **不覆盖已有绝对路径** | `command_uses_absolute_node`：sync 时若新 command 解析不到绝对 node 而已有 command 是绝对路径，则保留旧 command |
| **字段级 sync** | `find_catrace_entry_mut` + `catrace_hook_obj_mut`：marker 命中后更新 command/timeout/shell/commandWindows，不再 skip-if-present |
| **Codex feature 表** | `ensure_codex_hooks_feature` 改为行级解析 `[features]` 段：迁移 `codex_hooks`→`hooks`、尊重显式 `false`、不叠段 |
| **写前备份** | `backup_file` → `<file>.bak`，覆盖 Claude/Codex hooks.json/Codex config.toml/Gemini/Kimi；备份失败仅记日志不阻断 |
| **Kimi sync** | 已装时 strip 全部 catrace `[[hooks]]` 块再重写（command 随路径更新） |

## 关键决策

- **`resolve_node_path` 在 Windows 返回 `None`**：Windows 走 PowerShell `& "node"` 已可用，无需绝对路径；`#[allow(dead_code)]` 标注仅为 POSIX 服务。
- **Claude spec 用整份 JSON（含 `shell`）而非字符串 command**：Windows 必须显式 `shell: "powershell"`，POSIX 下 sync 时主动 `remove("shell")` 避免残留。
- **备份失败不阻断安装**：备份是尽力而为的保险，不该因为 `.bak` 写不进就装不上 hook。

## 验证

- `cargo check` 通过（Windows target）
- `pnpm vue-tsc --noEmit` 通过（invoke 返回值新增 `synced_*` 字段，前端未消费该字段，无类型破坏）
- 真机实测（干净 Windows 装 Claude hook → Stop 出卡）留给 P5

## 下一步

P5 实测与发版收口：真 Claude/Codex/Gemini/Kimi 各触发一轮，确认 Windows 上 Stop 必出卡、重装后 command 随 app_data 更新，然后升版本号。
