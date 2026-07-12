# 新增一个 agent hook 接入要改的所有位置

以 Codex / Gemini / Kimi（2026-07 接入）为参照。各 agent 的机制差异详见 [agent-hook-integration-per-agent](../../../reference/agent-hook-integration-per-agent-claude-code-codex-gemini-kimi-opencode-openclaw-hermes.md)。

## 前置判断

先确认目标 agent 属于哪一派：

- **命令 hook 派**（写配置文件注册命令）：复用现有模式，改动量小
- **进程内插件派**（OpenCode / OpenClaw / Hermes）：要写 agent 进程内插件，现有 `install_agent_hooks` 模式不适用，需另评估

## 改动清单（命令 hook 派）

1. **`src-tauri/src/agent_hook.rs`**
   - `SUPPORTED_AGENTS` 加 agent id
   - `agent_hook_events()` 加该 agent 要注册的事件（用 agent 原生事件名）
   - 新增 `install_xxx_hooks` / 配置路径函数；JSON 配置可复用 `uninstall_json_hooks` / `is_json_hook_installed`，非 JSON（如 TOML）需自带卸载/检测
   - `install_agent_hooks` / `uninstall_agent_hooks` / `is_agent_hook_installed` 的 match 加分支
2. **`src-tauri/resources/catrace-agent-hook.cjs`**
   - 事件名与 Claude Code 不一致时，`EVENT_ALIASES` 加映射（归一化到 SessionStart/UserPromptSubmit/Stop/StopFailure/Notification）
3. **`src/api/tauri.ts`** — 一般无需改（API 已参数化 `agent: string`）
4. **`src/components/settings/AgentSettingsCard.vue`** — `agentNameKeys` 加显示名 key
5. **i18n**（zh-CN.ts / en-US.ts）— `settings.agent.nameXxx`
6. 若该 agent 有 Claude Code 没有的新事件需要独立策略：`KNOWN_EVENTS` + `default_event_mode` + 设置页 `eventNameKeys` + i18n `eventXxx`

## 各 agent 配置文件格式备忘

| agent | 配置文件 | entry 格式 | 坑 |
|-------|----------|-----------|-----|
| claude | `~/.claude/settings.json` | `{matcher:"", hooks:[{type,command,async,timeout:5}]}` | 事件名在 stdin `hook_event_name` 不在 argv；Claude Desktop 共用此配置，免费覆盖 |
| codex | `~/.codex/hooks.json` + `config.toml` 需 `[features] hooks = true` | `{hooks:[{type,command,timeout:30}]}` | Windows 原生 Codex 用 PowerShell 执行命令，裸 `node "path"` 可能失败（clawd 用 `&` 调用符 + commandWindows 双字段，Catrace 暂未做平台分支） |
| gemini | `~/.gemini/settings.json` | `{matcher:"*", hooks:[{name:"catrace",type,command}]}` | 事件名全不同（BeforeAgent/AfterAgent），靠脚本映射 |
| kimi | `~/.kimi/config.toml`（旧）+ `~/.kimi-code/config.toml`（新，尊重 KIMI_CODE_HOME） | TOML `[[hooks]]` 块：event/command/matcher/timeout | 单引号 literal 命令避免 Windows 路径转义；Kimi Code 是 z.strict() schema，只写白名单 4 个 key；目录不存在的代跳过，两代都没有则报错 |

## 共同纪律（clawd 实践，值得保留）

- marker（`catrace-agent-hook`）识别自家条目，安装幂等、卸载只删自家
- 原子写（tmp + rename）
- 配置目录不存在 = 该 agent 未安装，跳过而非报错（Kimi 两代全缺才报错）
