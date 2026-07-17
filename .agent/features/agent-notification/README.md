# Agent 通知

接收 AI agent（Claude Code / Codex / Gemini / Kimi）hook 推送的状态事件，按用户配置的三态策略复用 [[toast-window]] 弹出卡片；设置页提供每 agent 一键安装/卸载。

## 链路

```
agent 触发 hook → 释放到 app_data_dir/hooks/catrace-agent-hook.cjs 的 Node 脚本
  → 读 stdin JSON（事件名在 hook_event_name，不在 argv！）→ 事件名归一化
  → POST 127.0.0.1:23456/state → agent_hook.rs
      ├─ UserPromptSubmit：按 sessionId 自动销 sticky 待办（即使 mode=off）
      └─ 事件策略过滤 / auto 去重 / transcript 摘要（PermissionRequest 用 tool_name 兜底）
  → reminder_toast.rs eval window.addToastNotification({kind:"agent", mode})
```

默认策略：召唤型（Stop / StopFailure / Notification / PermissionRequest）= sticky；播报型 off。设置页可改。PermissionRequest **只通知不审批**。

## 涉及文件

- `src-tauri/src/agent_hook.rs` — HTTP 服务（tiny_http，固定端口 23456）、事件三态策略、去重、四个 agent 的安装/卸载/检测命令；transcript 摘要生成；`open_agent_session` 前往会话；提示音设置/读取；`UserPromptSubmit` 自动销项
- `src-tauri/resources/catrace-agent-hook.cjs` — hook 脚本（`include_bytes!` 内嵌，安装时释放到 app_data_dir）；**必须 .cjs**：仓库根 package.json 带 `type:module`，.js 会被 Node 当 ESM 导致 require 崩溃
- `src-tauri/resources/agent-notify.wav` — 内置提示音（180ms / 880Hz），释放到 app_data_dir/sounds/
- `src-tauri/src/reminder_toast.rs` — `create_agent_toast_window(...)` / `dismiss_agent_session_toast(session_id)`
- `src/views/ReminderToast.vue` — 通知栈生命周期；agent 卡片渲染下沉到 AgentToastCard；`window.dismissAgentSession`
- `src/components/AgentToastCard.vue` — agent 卡片：项目名+摘要标题、聚合展开式列表、前往会话、全部已读；多会话「前往」只销当前条目
- `src/components/settings/AgentSettingsCard.vue` — 设置页：全局开关、agent 安装列表、事件策略、提示音设置；开关关闭时安装列表和事件策略整段隐藏（单个 `v-if="enabled"` 包住）
- `src/api/tauri.ts` — 前端 invoke 封装

## 子文档

- [roadmap-and-progress.md](roadmap-and-progress.md) — **完整开发计划与进度**（P0–P8：待办 Toast → 真审批 → 交互小窗；已完成/待做/验收）
- [event-display-policy-off-auto-sticky-and-sticky-merge-behavior.md](event-display-policy-off-auto-sticky-and-sticky-merge-behavior.md) — 三态策略的存储/默认/去重规则，sticky 常驻与多卡合并的前端行为
- [agent-toast-card-content-interaction-and-component-boundary.md](agent-toast-card-content-interaction-and-component-boundary.md) — 卡片内容来源（transcript 摘要）、交互动作、按 sessionId 合并粒度、与 toast-window 的组件边界、提示音链路
- [files-to-change-when-adding-a-new-agent-hook-target.md](files-to-change-when-adding-a-new-agent-hook-target.md) — 新增一个 agent 接入要改的所有位置（以 Codex/Gemini/Kimi 为参照）
- [hook-install-development-guide.md](hook-install-development-guide.md) — **改 hook 安装/脚本前必读**：四 agent 配置规格、平台坑、与 clawd 缺口、安全修改流程
