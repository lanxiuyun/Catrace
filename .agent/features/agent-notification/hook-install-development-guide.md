# Agent Hook 安装与改造开发指南

> 面向后续改 `agent_hook.rs` / `catrace-agent-hook.cjs` 的实现者。
> 机制总览见 [README.md](README.md)；clawd-on-desk 对照见 [agent-hook-integration-per-agent](../../reference/agent-hook-integration-per-agent-claude-code-codex-gemini-kimi-opencode-openclaw-hermes.md)；新增 agent 改动清单见 [files-to-change-when-adding-a-new-agent-hook-target.md](files-to-change-when-adding-a-new-agent-hook-target.md)。
>
> 调研来源：`C:\work_sapce\clawd-on-desk` 的 `hooks/*-install.js`、`agents/*.js`、`docs/guides/setup-guide.md`、`docs/project/agent-runtime-architecture.md`，对照 Catrace 当前实现（2026-07）。

## 1. 目标与边界

Catrace agent 通知只做 **A 派：命令 hook**：

1. 把 `catrace-agent-hook.cjs` 释放到 `app_data_dir/hooks/`
2. 按 agent 把「事件 → 启动该脚本的 command」合并进对方配置
3. 脚本读 stdin JSON → 事件归一化 → `POST 127.0.0.1:23456/state`
4. Rust 侧按用户三态策略（off/auto/sticky）决定是否弹 Toast

**不做 / 暂不接：**

| 能力 | clawd | Catrace |
|------|-------|---------|
| 阻塞式权限审批 `POST /permission` | Claude/Codex/Qwen 等 | 否 |
| 端口漂移 + runtime.json | 23333–23337 | 固定 **23456** |
| 进程内插件派（OpenCode / OpenClaw / Hermes） | 有 | 否，另评估 |
| 全量状态机动画 | 宠物状态 | 仅通知卡片 |

**纪律：**

- hook 脚本失败必须静默 `exit 0`，短超时，绝不阻塞 agent
- 只改带 marker `catrace-agent-hook` 的条目；用户其它 hook 原样保留
- 配置目录不存在 = 该 agent 未装 → 跳过；不要误创无关配置
- 写配置：tmp + rename 原子写；优先备份（clawd 有，Catrace 多数路径尚无 backup）

## 2. 端到端链路（Catrace）

```
agent 生命周期事件
  → 各 agent 配置里的 command hook
  → node app_data_dir/hooks/catrace-agent-hook.cjs
      stdin JSON（事件名优先 hook_event_name；argv[2] 仅调试兜底）
      EVENT_ALIASES 归一化 → EVENT_TO_STATE 过滤
  → POST 127.0.0.1:23456/state
  → agent_hook.rs：开关 / 事件策略 / auto 去重 8s / transcript 摘要
  → reminder_toast.rs → AgentToastCard
```

核心文件：

| 文件 | 职责 |
|------|------|
| `src-tauri/src/agent_hook.rs` | HTTP 服务、策略、安装/卸载/检测、open session |
| `src-tauri/resources/catrace-agent-hook.cjs` | 通用 hook 脚本（`include_bytes!` 内嵌；**必须 .cjs**，根 package.json 是 type:module） |
| `src/components/settings/AgentSettingsCard.vue` | 安装 UI |
| `src/api/tauri.ts` | invoke 封装 |

## 3. 四 agent 安装规格（改代码时的真源）

### 3.1 Claude Code（+ Claude Desktop 共用）

| 项 | 值 |
|----|-----|
| 配置 | `~/.claude/settings.json` |
| 入口 | `hooks.<Event>[]` |
| entry 形状 | `{ matcher: "", hooks: [{ type: "command", command, async: true, timeout: 5 }] }` |
| 事件（Catrace 注册） | `KNOWN_EVENTS`：SessionStart / UserPromptSubmit / Stop / StopFailure / Notification |
| payload | stdin JSON；**事件名在 `hook_event_name`，不在 argv** |
| 权限 | clawd 另注册 `type: "http"` 的 PermissionRequest；Catrace **不注册** |
| 免费覆盖 | Claude Desktop 读同一份 settings → 接好 Code 即覆盖 Desktop |

**clawd 关键、Catrace 尚未完全跟上的坑：**

1. **Windows 命令包装**：Claude Code 在 Windows 默认用 bash 跑 hook。clawd 写  
   `{ shell: "powershell", command: "& \"node\" \"script.js\" ... }`。  
   Catrace 当前 `build_hook_command` 只写 `node "path"`，Windows 上可能静默失败。
2. **WSL**：命令应 **不带引号** 的 plain 形式；引号会被当成可执行文件名一部分。
3. **node 绝对路径**：macOS/Linux 上 agent 给 hook 的 PATH 极简，裸 `node` 找不到 Homebrew/nvm。应解析绝对路径；解析失败时保留已有绝对路径，勿用裸 `node` 覆盖。
4. **版本门控事件**（可选增强）：PreCompact/PostCompact ≥2.1.76，StopFailure ≥2.1.78；版本未知时不要乱写未知事件。
5. **废弃事件**：不要注册 `WorktreeCreate`（会破坏 `claude -w`）。
6. **合并策略**：按 marker 做字段级 sync（更新 command/timeout），不是「有 marker 就 skip」——否则脚本路径/node 路径变更后配置会陈旧。Catrace 当前是 skip-if-present。

### 3.2 Codex CLI

| 项 | 值 |
|----|-----|
| 配置 | `~/.codex/hooks.json`（独立文件） |
| feature | `~/.codex/config.toml` 的 `[features] hooks = true`（旧 key `codex_hooks` 应迁移，**不可把用户显式 false 改回 true**） |
| entry 形状 | `{ hooks: [{ type: "command", command, timeout }] }`（无 matcher 也可） |
| 事件（Catrace） | SessionStart / UserPromptSubmit / Stop |
| clawd 完整事件 | 另含 PreToolUse / PostToolUse / PermissionRequest |
| payload | stdin JSON；session 常与 `~/.codex/sessions/**/rollout-*.jsonl` 的 UUID 对齐 |
| fallback | clawd 还有 JSONL 轮询；Catrace 不做 |

**平台坑：**

1. **Windows**：Codex 用 PowerShell 执行 command 字符串。裸 `"node" "hook.js"` 会 exit 1。clawd 用  
   `& "node" "hook.js"`，并在 win32 写 **`command` + `commandWindows`** 双字段（共享 `CODEX_HOME` 时 WSL 走 `command`，Windows 走 `commandWindows`）。
2. **PermissionRequest**：timeout 建议 600s；Catrace 不做权限则不要注册。
3. **state 事件 timeout**：clawd 用 30s；Catrace 安装也是 30。
4. **feature 写入**：Catrace `ensure_codex_hooks_feature` 只要文件里出现 `hooks` 字样就保守不动——正确方向，但重复 install 可能叠多个 `[features]` 段（已知粗糙点，改时应用 clawd 的按行解析 `[features]` 表逻辑）。

### 3.3 Gemini CLI

| 项 | 值 |
|----|-----|
| 配置 | `~/.gemini/settings.json` |
| entry 形状 | `{ matcher: "*", hooks: [{ name: "catrace", type: "command", command }] }` |
| 事件（Catrace 注册） | SessionStart / BeforeAgent / AfterAgent / Notification |
| clawd 另有 | BeforeTool / AfterTool / SessionEnd / PreCompress |
| payload | `hook_event_name` 或 **argv 事件名**（clawd 安装时把 event 放进 command 参数） |
| 脚本映射 | `BeforeAgent→UserPromptSubmit`，`AfterAgent→Stop`（见 `EVENT_ALIASES`） |

**关键坑：**

1. **gating hook 必须 stdout JSON**：BeforeAgent / BeforeTool 等若不打印 `{"decision":"allow"}`（或等价），会卡住 agent。Catrace 脚本当前 **从不写 stdout**——若以后注册 BeforeTool，必须先改脚本。
2. entry 需要 `name`（clawd 用 `"clawd"`，Catrace 用 `"catrace"`）便于 disabled 列表与去重。
3. 目录 `~/.gemini` 不存在则跳过安装。

### 3.4 Kimi（双代）

| 项 | 旧 Kimi CLI (Python) | Kimi Code (TS) |
|----|----------------------|----------------|
| 配置 | `~/.kimi/config.toml` | `~/.kimi-code/config.toml` 或 `$KIMI_CODE_HOME/config.toml` |
| 形状 | TOML `[[hooks]]` | 同左，**z.strict()** |
| 允许 key | event / command / matcher / timeout | **仅这 4 个**；多 key / 未知事件 / timeout 越界会 **整段 hooks 全丢**（含用户自己的） |
| 事件（Catrace） | SessionStart / UserPromptSubmit / Stop / Notification | 同左 |
| clawd 完整 | + PostToolUseFailure 等；Code 另 + PermissionRequest / PermissionResult / Interrupt | |
| 命令引号 | 单引号 literal，避免 Windows `\` 转义 | 同左；**不要** `VAR=x cmd` 前缀（Windows spawn shell 下失效） |
| 安装策略 | 目录不存在跳过；两代都没有才报错 | 同左 |

**改造注意：**

1. 卸载必须 **按 `[[hooks]]` 块扫描**，块结束于下一个 `[...]` / `[[...]]`，不能只匹配到下一个 `[[hooks]]`，否则会吞用户后续 `[server]` 等表。
2. 已装检测：块内 command 含 marker。
3. 幂等更新：clawd 会 strip 全部 catrace/clawd 块再重写，避免重复 PreToolUse；Catrace 是「有 marker 整文件 skip」，**脚本路径变更后不会更新**。
4. 脚本侧 `PostToolUseFailure→StopFailure` 映射已有；但 install 未注册 PostToolUseFailure 时该映射无入口。

## 4. 通用 hook 脚本约定

文件：`src-tauri/resources/catrace-agent-hook.cjs`

```text
读 stdin（≤2s）→ JSON.parse
event = argv[2] || payload.hook_event_name
event = EVENT_ALIASES[event] || event
state = EVENT_TO_STATE[event]  // 无映射则 exit 0
POST { event, state, session_id, cwd, transcript_path, prompt } → :23456/state
任何错误 exit 0
```

当前归一化表：

| 原始事件 | 归一化 |
|----------|--------|
| BeforeAgent | UserPromptSubmit |
| AfterAgent | Stop |
| PostToolUseFailure | StopFailure |
| SessionStart / UserPromptSubmit / Stop / StopFailure / Notification | 自身 |

**改脚本规则：**

- 只加「用户可能订阅的」低频事件；PreToolUse 等高频事件默认忽略
- 新增 agent 原生事件名 → 先加 `EVENT_ALIASES`，再决定是否进 `KNOWN_EVENTS` 设置页
- 若某 agent 要求 stdout 决策 JSON，按 **agent + 事件** 分支写 stdout，默认仍静默
- 不要依赖仓库相对路径；运行时路径是 app_data_dir 释放副本

## 5. Rust 安装器结构（`agent_hook.rs`）

```text
SUPPORTED_AGENTS = claude | codex | gemini | kimi
ensure_hook_script()           // 每次安装覆盖释放 .cjs
install_agent_hooks(agent)     // match 分发
uninstall_agent_hooks(agent)
is_agent_hook_installed(agent)

// 共享
build_hook_command()           // 当前：node "abs-path"
entry_contains_catrace_hook()  // 扫 command 或 hooks[].command 含 marker
read_json_settings / write_json_settings
uninstall_json_hooks / is_json_hook_installed

// 分 agent
install_claude_hooks / install_codex_hooks / install_gemini_hooks / install_kimi_hooks
ensure_codex_hooks_feature
kimi strip / dual path
```

HTTP 侧：

- 只收 `POST /state`
- `KNOWN_EVENTS` 驱动设置页策略；**与 install 注册的原生事件可以不同**（Gemini 注册 BeforeAgent，策略仍配 UserPromptSubmit）
- sticky 不去重；auto 按 `(session_id, event)` 8s 去重

## 6. 与 clawd 对照：Catrace 已知缺口（改代码优先序）

按「用户是否真的收不到通知」排序：

| 优先级 | 缺口 | 影响 | 建议方向 |
|--------|------|------|----------|
| P0 | Windows Claude/Codex 命令未按 PowerShell/`&` 包装 | Windows 上 hook 可能根本不跑 | `build_hook_command` 按 agent+platform 分支；Codex 写 `commandWindows` |
| P0 | node 非绝对路径 | mac/Linux 打包环境 hook 找不到 node | 解析 PATH / 常见安装位置；失败保留已有绝对路径 |
| P1 | 已安装则 skip，不 sync command | 升级 app 后脚本路径/参数陈旧 | marker 命中后做字段级更新（clawd `syncCommandHook` 模式） |
| P1 | Gemini gating 未回 stdout | 若扩展 BeforeTool 会卡 agent | 扩展前先改 cjs |
| P2 | Codex `[features]` 粗暴追加 | 可能重复 section | 行级解析 features 表，迁移 `codex_hooks`→`hooks`，尊重 false |
| P2 | 无配置备份 | 写坏 settings 难恢复 | write 前 `.bak` 或 clawd 式 backup |
| P3 | Kimi 未注册 Code 原生 Permission* | 权限类通知缺失（Catrace 本就不做审批，仅通知可选） | 若产品要「权限等待」提示再加，仍只 /state |
| P3 | Claude 版本门控 / 废弃事件清理 | 低版本未知事件风险 | 可选 |
| P3 | session_id 前缀 / agent_id | 多 agent 卡片难区分来源 | payload 加 `agent` 字段，安装时 command 传 agent id 或脚本嗅探 |

## 7. 安全修改流程

### 7.1 改安装逻辑

1. 先读目标 agent 在 clawd 的 `hooks/*-install.js` + `agents/*.js`，确认配置路径、entry 形状、事件表、平台命令
2. 改 `agent_hook.rs` 对应 `install_*` / 事件表 / `build_hook_command`
3. 若事件名变化：同步 `catrace-agent-hook.cjs` 的 `EVENT_ALIASES` / `EVENT_TO_STATE`
4. 若新用户可见事件：`KNOWN_EVENTS` + `default_event_mode` + 设置页 + i18n
5. 手动验证：
   - 干净环境 install → 配置出现 marker 条目
   - 再 install → 幂等，不重复条目（理想：command 变更会更新）
   - uninstall → 只删 marker 条目，用户其它 hook 仍在
   - 真机跑一轮对应 agent，确认 Toast；**curl 自编 payload 不够**（尤其 Claude）

### 7.2 改 hook 脚本

1. 改 `src-tauri/resources/catrace-agent-hook.cjs`
2. 重新 install 或确保 `ensure_hook_script` 被调用（当前 install 会覆盖释放）
3. 确认扩展名仍是 **`.cjs`**

### 7.3 新增第 5 个命令 hook agent

按 [files-to-change-when-adding-a-new-agent-hook-target.md](files-to-change-when-adding-a-new-agent-hook-target.md) 清单执行；先判定是否 A 派。

## 8. 手工验证清单（四 agent）

```bash
# 开发态：从设置页点安装，或后续若暴露 CLI 再测
# 检查配置是否含 catrace-agent-hook

# Claude
#   %USERPROFILE%\.claude\settings.json  → hooks.Stop 等

# Codex
#   %USERPROFILE%\.codex\hooks.json
#   %USERPROFILE%\.codex\config.toml    → hooks = true

# Gemini
#   %USERPROFILE%\.gemini\settings.json → hooks.BeforeAgent 等，name=catrace

# Kimi
#   %USERPROFILE%\.kimi\config.toml 与/或 %USERPROFILE%\.kimi-code\config.toml
#   [[hooks]] 块 command 含 catrace-agent-hook
```

真机：

1. 启动 Catrace，agent 通知总开关开，Stop/Notification 为 sticky
2. 在对应 CLI 完成一轮对话 / 触发 notification
3. 应出现 Toast；关闭 sticky 卡片；再触发 auto 事件验证去重

## 9. 参考路径（clawd-on-desk）

| 主题 | 路径 |
|------|------|
| Claude 安装 | `hooks/install.js` |
| Claude 脚本 | `hooks/clawd-hook.js` |
| Codex 安装 | `hooks/codex-install.js` + `codex-install-utils.js` |
| Codex 脚本 | `hooks/codex-hook.js` |
| Gemini 安装/脚本 | `hooks/gemini-install.js` / `gemini-hook.js` |
| Kimi 安装/脚本 | `hooks/kimi-install.js` / `kimi-hook.js` |
| Agent 能力声明 | `agents/claude-code.js` `codex.js` `gemini-cli.js` `kimi-cli.js` |
| 用户向安装说明 | `docs/guides/setup-guide.md` |
| 运行时数据流 | `docs/project/agent-runtime-architecture.md` |

## 10. 一句话总则

**每个 agent 只信自己的配置文件形状和平台 spawn 规则；共享的只有 marker 纪律、原子写、静默短超时脚本、以及归一化后的 `/state` 协议。** 改 Catrace 时优先补 P0 平台命令与 node 路径，再谈 sync 与事件扩展。
