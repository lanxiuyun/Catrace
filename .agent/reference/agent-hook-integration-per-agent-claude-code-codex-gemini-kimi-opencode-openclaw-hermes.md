# 各 AI agent 的 hook 接入方式（clawd-on-desk 实现）

> 配套文档：[clawd-on-desk-agent-notification-mechanism.md](clawd-on-desk-agent-notification-mechanism.md)（整体机制）。
> 本文深入 clawd-on-desk `hooks/` 目录的源码，对比 7 种 agent 的接入差异。结论先行：**不一样，分三派**。

## 三派接入方式

| 派别 | Agent | 本质 |
|---|---|---|
| **A. 命令 hook 派** | Claude Code、Claude Desktop、Codex、Gemini | 往 agent 的配置文件里注册「事件 → shell 命令」，agent 触发事件时 spawn 一个 Node 脚本，脚本读 stdin JSON 后 POST 给 clawd |
| **B. 进程内插件派** | OpenCode、OpenClaw、Hermes | 不写配置注册命令，而是把插件目录注册给 agent，插件代码**运行在 agent 进程内部**，直接调 agent 的事件 API，再 fetch 给 clawd |

> **Claude Desktop 与 Claude Code 共用一套 hook**：Claude Desktop 内置了相同的 agent 运行时，读同一份 `~/.claude/settings.json`，为 Claude Code 安装的 hook 对 Desktop 同样生效（Catrace 实测：Desktop 会话能正常触发通知）。clawd 代码库没有单独的 Desktop 接入，原因即在此——无需单独接。

## A 派逐个看

### Claude Code（`install.js` + `clawd-hook.js`）

- **配置**：`~/.claude/settings.json` → `hooks.<Event>[]`，每条 `{ matcher, hooks: [{ type: "command", command, async, timeout }] }`
- **事件**：SessionStart / SessionEnd / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / Stop / SubagentStart / SubagentStop / Notification / Elicitation；按版本门控 PreCompact、PostCompact（≥2.1.76）、StopFailure（≥2.1.78）
- **payload**：stdin JSON，事件名在 `hook_event_name` 字段（**不在 argv**——Catrace 接入时踩过这个坑）
- **特殊**：PermissionRequest 不用命令 hook，而是 `type: "http"` 的阻塞式 HTTP hook（`http://127.0.0.1:23333/permission`，timeout 600s），Claude Code 等响应决定 allow/deny
- **命令格式的平台坑**（`buildCommandHookSpec`）：
  - Windows：必须 `{ shell: "powershell", command: "& \"node\" \"script.js\"" }`——Claude Code 在 Windows 默认用 bash 跑 hook
  - WSL：必须**不带引号**的 plain 形式，否则引号被当成可执行文件名的一部分，静默失败
  - macOS/Linux：引号包裹的 shell 形式（打包应用路径含空格）
- **node 路径**：要解析绝对路径——macOS/Linux 上 Claude Code 以极简 PATH 跑 hook，找不到 Homebrew/nvm 的 node
- **合并策略**：按 marker（`clawd-hook.js`）识别自家条目，sync 字段级更新；写前备份、原子写；版本不够的 versioned hook 主动移除；deprecated hook（WorktreeCreate，会破坏 `claude -w`）按 marker 清理

### Codex（`codex-install.js` + `codex-install-utils.js` + `codex-hook.js`）

- **配置**：`~/.codex/hooks.json`（独立文件，不是 config.toml；但需在 config.toml 启用 `hooks` feature key，旧版叫 `codex_hooks`）
- **事件**：SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / Stop——名字与 Claude Code 对齐，是 7 种里最接近的
- **payload**：stdin JSON；session_id 需要从 transcript 文件名（`rollout-*-<uuid>.jsonl`）提取并加 `codex:` 前缀归一化
- **平台坑**：Windows 上 Codex 用 PowerShell 执行 command 字符串，裸引号形式会 exit 1，必须用 `&` 调用符；WSL 共享配置时 POSIX 侧命令走 Windows node.exe interop（保证 127.0.0.1 是 Windows 回环）
- **权限**：PermissionRequest 命令 hook timeout 600 秒（其它事件 30 秒），脚本内长轮询等 clawd 决策

### Gemini CLI（`gemini-install.js` + `gemini-hook.js`）

- **配置**：`~/.gemini/settings.json` → `hooks.<Event>[]`，entry 结构带 `name: "clawd"` 字段
- **事件名完全不同**，hook 内做映射（`HOOK_MAP`）：

  | Gemini 事件 | 映射到 clawd |
  |---|---|
  | BeforeAgent | UserPromptSubmit (thinking) |
  | BeforeTool / AfterTool | PreToolUse / PostToolUse (working) |
  | AfterAgent | AfterAgent (idle) |
  | SessionStart / SessionEnd / Notification / PreCompress | 同名 |

- **payload**：stdin JSON，`hook_event_name` 或 argv 兜底；session_id 加 `gemini:` 前缀
- **特殊**：BeforeTool/BeforeAgent 是 gating hook，**必须向 stdout 打印 JSON**（`{"decision":"allow"}`）否则阻塞 agent——这是命令 hook 派里唯一要回 stdout 的

### Kimi（`kimi-install.js` + `kimi-hook.js`）——双代兼容

- **配置**：TOML 不是 JSON，且有两代产品：
  - 旧 Kimi CLI（Python）：`~/.kimi/config.toml`
  - Kimi Code（TS 重写）：`~/.kimi-code/config.toml`（尊重 `KIMI_CODE_HOME`）
  - 都是 `[[hooks]]` 数组：`{ event, matcher, command, timeout }`
- **事件**：与 Claude Code 同名同语义（13 个）；Kimi Code 额外有原生 PermissionRequest / PermissionResult / Interrupt
- **坑 1（schema 严格）**：Kimi Code 的 HookDefSchema 是 z.strict()，任何多余 key / 未知事件 / 超范围 timeout 会让它**丢弃整个 hooks 段**——包括用户自己写的。install 只写白名单 4 个 key，timeout 钳到 [1, 600]
- **坑 2（旧 CLI 无权限事件）**：旧 Python CLI 没有 PermissionRequest，hook 里靠工具名启发式（shell/write_file 等 PreToolUse 时闪 notification）模拟
- **坑 3（TOML 解析）**：识别自家条目用正则扫 `command = "..."`，不引入 TOML 解析器

## B 派逐个看

### OpenCode（`opencode-install.js` + `opencode-plugin/`）

- **注册**：`~/.config/opencode/opencode.json` 的 `"plugin"` 数组追加插件目录绝对路径（1.3.13 不会自动扫 plugins 目录）
- **运行**：`index.mjs` 在 opencode 进程内（Bun 运行时）执行，零依赖，用 Bun 内置 fetch
- **不变式**：fire-and-forget（事件回调绝不 await fetch）；同状态去重；端口自愈发现（缓存 → runtime.json → 全端口扫描）
- **权限桥**：opencode TUI 没有外部 HTTP 监听，clawd 无法从外部调它的 API。插件自己起 `Bun.serve()` 小桥（32 字节随机 token 鉴权），clawd POST 决策到桥，桥在进程内调 Hono router

### OpenClaw（`openclaw-install.js` + `openclaw-plugin/`）

- **注册**：`~/.openclaw/openclaw.json`（尊重 `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH`），写入插件声明 `openclaw.plugin.json`（activation.onStartup）
- **运行**：`index.js` 进程内，hook 名是 snake_case：`session_start` / `model_call_started` / `model_call_ended` / `before_tool_call` / `after_tool_call` / `before_compaction` / `after_compaction` / `session_end`
- 端口发现同样走 `~/.clawd/runtime.json` + 候选扫描

### Hermes（`hermes-install.js` + `hermes-plugin/`）

- **注册**：**不改用户的 config.yaml**（YAML 且用户所有）。优先 `hermes plugins enable clawd-on-desk` CLI；CLI 不可用时复制插件文件到 `~/.hermes/plugins/clawd-on-desk/`（Windows 可能用 `%LOCALAPPDATA%\hermes`）并报可修复错误。支持多 profile 目录扫描
- **运行**：Python 插件（`plugin.yaml` 声明 8 个 hook + `__init__.py`），stdlib-only（urllib），hook 回调里绝不抛异常
- **事件映射**：`pre_llm_call`→UserPromptSubmit、`post_llm_call`→Stop、`pre/post_tool_call`→Pre/PostToolUse；`on_session_end` 每轮对话结束都触发（按 Stop 处理），`on_session_finalize` 才是真正的 SessionEnd

## 总结：哪些一样，哪些本质不同

**几乎可复制（同派同构）**：Claude Code ↔ Codex。事件名、stdin JSON payload、`{matcher, hooks:[{type:command}]}` 结构一致，差异仅在配置文件路径/格式、命令的平台包装、session_id 归一化。

**同派但需适配层**：Gemini（事件名全不同 + 要回 stdout JSON）、Kimi（TOML + 双代 + strict schema + 旧代缺事件靠启发式）。

**本质不同（B 派）**：OpenCode / OpenClaw / Hermes 没有「配置文件注册命令」这回事，是 agent 插件体系——代码跑在 agent 进程里，用 agent 自己的事件 API， clawd 只提供 HTTP 端点和插件目录。每接一个就是写一个新插件，没有命令 hook 可复用。

**免费得来**：Claude Desktop 与 Claude Code 共用 `~/.claude/settings.json` 和 agent 运行时，接好 Claude Code 即自动覆盖 Desktop。

## 对 Catrace 的启示

1. 若要支持 Codex：改配置文件为 `~/.codex/hooks.json` + config.toml feature key，其余几乎照搬现有 `agent_hook.rs`
2. Gemini/Kimi 需要在 hook 脚本里加事件名映射表（参考各自的 HOOK_MAP）
3. OpenCode 系要换思路：写进程内插件而不是命令 hook，投入产出比需另评估
4. 所有 A 派 install 的共同纪律值得保留：marker 识别自家条目、原子写 + 备份、平台命令格式分支、node 绝对路径解析
