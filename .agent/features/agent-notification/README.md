# Agent 通知

接收 AI agent（Claude Code / Codex / Gemini / Kimi）hook 推送的状态事件，按用户配置的三态策略复用 [[toast-window]] 弹出卡片；设置页提供每 agent 一键安装/卸载。

## 链路

```
agent 触发 hook → 释放到 app_data_dir/hooks/catrace-agent-hook.cjs 的 Node 脚本
  → 读 stdin JSON（事件名在 hook_event_name，不在 argv！）→ 事件名归一化
  → POST 127.0.0.1:23456/state → agent_hook.rs 按事件策略过滤/去重
  → reminder_toast.rs eval window.addToastNotification({kind:"agent", mode})
```

## 涉及文件

- `src-tauri/src/agent_hook.rs` — HTTP 服务（tiny_http，固定端口 23456）、事件三态策略、去重、四个 agent 的安装/卸载/检测命令
- `src-tauri/resources/catrace-agent-hook.cjs` — hook 脚本（`include_bytes!` 内嵌，安装时释放到 app_data_dir）；**必须 .cjs**：仓库根 package.json 带 `type:module`，.js 会被 Node 当 ESM 导致 require 崩溃
- `src-tauri/src/reminder_toast.rs` — `create_agent_toast_window(event, state, mode)`
- `src/views/ReminderToast.vue` — agent 卡片渲染、sticky 常驻、多卡合并
- `src/components/settings/AgentSettingsCard.vue` — 设置页：全局开关、agent 安装列表、事件策略；开关关闭时安装列表和事件策略整段隐藏（单个 `v-if="enabled"` 包住）
- `src/api/tauri.ts` — 前端 invoke 封装

## 子文档

- [event-display-policy-off-auto-sticky-and-sticky-merge-behavior.md](event-display-policy-off-auto-sticky-and-sticky-merge-behavior.md) — 三态策略的存储/默认/去重规则，sticky 常驻与多卡合并的前端行为
- [files-to-change-when-adding-a-new-agent-hook-target.md](files-to-change-when-adding-a-new-agent-hook-target.md) — 新增一个 agent 接入要改的所有位置（以 Codex/Gemini/Kimi 为参照）
