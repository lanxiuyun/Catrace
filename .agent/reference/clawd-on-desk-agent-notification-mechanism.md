# clawd-on-desk 的 Agent 通知机制

> 参考项目：[clawd-on-desk](../../../clawd-on-desk)（Electron 桌面宠物）。本文记录它如何让 AI agent（Claude Code / Codex / Copilot / Gemini 等）把状态实时推到桌面端，Catrace 的 agent 通知功能即参考此机制简化而来。
> 配套文档：[agent-hook-integration-per-agent-claude-code-codex-gemini-kimi-opencode-openclaw-hermes.md](agent-hook-integration-per-agent-claude-code-codex-gemini-kimi-opencode-openclaw-hermes.md)（各 agent 接入方式的源码级对比）。

## 整体链路

```
agent（Claude Code 等）
  │  生命周期事件触发 hook（settings.json 里注册的命令）
  ▼
hook 脚本（Node.js，读 stdin JSON payload）
  │  HTTP POST 127.0.0.1:23333/state（或 /permission）
  ▼
桌面端内置 HTTP 服务器 → 状态机（按 session 跟踪，多会话取最高优先级）
  │  IPC → 渲染进程
  ▼
展示：宠物动画切换 / 权限气泡 / 托盘闪烁 / 音效 / Session HUD / Dashboard
```

## Agent 端：hook 如何接入

以 Claude Code 为例，`hooks/install.js` 把命令合并写入 `~/.claude/settings.json`（不覆盖已有 hooks）：

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/clawd-hook.js", "async": true, "timeout": 5 }] }]
  }
}
```

关键事实（Catrace 接入时踩过坑）：

- **事件名不在命令行参数里**，而在 stdin JSON 的 `hook_event_name` 字段中。clawd-hook.js 从 stdin 读事件；只读 `process.argv[2]` 会永远拿不到事件名。
- hook 脚本必须**短超时、失败静默退出**，任何异常都不能阻塞 agent。
- 同一套安装器模式适配了 8+ 种 agent，差异只在配置文件位置：

| Agent | 配置文件 |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Codex CLI | `~/.codex/config.json` |
| Copilot CLI | `~/.copilot/hooks/hooks.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/hooks.json` |
| Kimi | `~/.kimi/config.toml` |
| opencode | `~/.config/opencode/opencode.json` |

## 桌面端：HTTP 接收

- 端口 **23333-23337 自动漂移**，实际绑定端口写入 `~/.clawd/runtime.json` 供 hook 发现。
- 两个端点：
  - `POST /state` — 非阻塞状态事件，立即返回 200
  - `POST /permission` — **阻塞式**：Claude Code 的 PermissionRequest hook 会等 HTTP 响应决定 allow/deny；桌面端挂起响应，弹出气泡等用户点击后才回复；DND 模式下 destroy 连接让 Claude Code 回退到终端提问

## 事件 → 状态映射

| 事件 | 状态 |
|---|---|
| SessionStart | idle |
| UserPromptSubmit | thinking |
| PreToolUse / PostToolUse | working |
| Stop | attention（完成庆祝）|
| SubagentStart | juggling |
| Notification / PermissionRequest | notification |

`/state` 的 payload 字段（供参考，Catrace 只用了其中三个）：`state`、`session_id`、`event`、`agent_id`、`cwd`、`tool_name`、`transcript_path`、`session_title`、`context_usage`、`assistant_last_output`。

## 展示层

- **状态动画**：渲染进程收 IPC 后切换 SVG/GIF/APNG；支持眼球跟随鼠标、边缘缩起、DND
- **权限气泡**：浮动卡片，Allow / Deny / Always Allow，支持 Elicitation 多选表单、Plan Review
- **Session HUD**：宠物旁的迷你会话列表（状态点、标题、上下文用量）
- **Dashboard**：完整会话管理面板，按主机分组（本地 / WSL / SSH）

## Catrace 的取舍

Catrace 只复刻了最小子集，差异对照：

| clawd-on-desk | Catrace |
|---|---|
| 端口 23333-23337 漂移 + runtime.json | 固定 23456（单例应用无端口竞争） |
| /state + /permission 双端点 | 仅 /state，不做阻塞式权限批准 |
| 8 种 agent 安装器 | 仅 Claude Code |
| 宠物动画 / 气泡 / HUD / Dashboard | 复用现有 Toast 窗口加一种卡片类型 |
| 全量 payload 字段 | 仅 `event` / `state` / `session_id` |

相关实现见 `src-tauri/src/agent_hook.rs` 与 [toast-window](../features/toast-window/README.md)。
