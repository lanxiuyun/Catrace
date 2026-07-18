# Agent 通知

接收 AI agent（Claude Code / Codex / Gemini / Kimi）hook 推送的状态事件，按用户配置的三态策略复用 [[toast-window]] 弹出卡片；Claude **PermissionRequest** 走阻塞 `/permission` 真审批；设置页提供每 agent 一键安装/卸载。

## 链路

```
agent 触发 hook
  ├─ 状态事件 → catrace-agent-hook.cjs → POST :23456/state
  │     ├─ UserPromptSubmit：timeout 该 session 挂起审批 + 销 sticky/permission 卡（即使 mode=off）
  │     └─ 策略过滤 / auto 去重 / transcript 摘要 + ai-title 会话名
  │           → reminder_toast eval addToastNotification({kind:"agent", sessionTitle, …})
  │
  └─ PermissionRequest（Claude type:http）→ POST :23456/permission（阻塞）
        → 挂起 PENDING_PERMISSIONS + 琥珀色 PermissionToastCard
        → Allow/Deny/timeout → 手写 HTTP 决策（timeout 回 {} 让 Claude 回退终端）
```

默认策略：召唤型（Stop / StopFailure / Notification）= sticky；播报型 off。PermissionRequest **不走三态**，装了 http hook 即代批。

HTTP **每请求一线程**（permission 阻塞不得卡住后续 /state）。本机测试页需要 CORS，见子文档。

## 涉及文件

- `src-tauri/src/agent_hook.rs` — HTTP（23456）、三态、去重、安装器、transcript 摘要/title、`/permission` 挂起与 timeout、CORS、并行 accept、`open_agent_session`、提示音
- `src-tauri/resources/catrace-agent-hook.cjs` — 状态 hook 脚本（**必须 .cjs**）；透传 `session_title`；PermissionRequest **不**走此脚本
- `src-tauri/resources/agent-notify.wav` — 内置提示音
- `src-tauri/src/reminder_toast.rs` — `create_agent_toast_window` / `create_agent_permission_window` / `dismiss_agent_session_toast`
- `src/views/ReminderToast.vue` — 栈生命周期、高度重算、permission 移除兜底 timeout、`dismissAgentSession`
- `src/components/AgentToastCard.vue` — 项目/事件/会话 title 分层、聚合、前往、layout 事件
- `src/components/PermissionToastCard.vue` — Allow / Deny / 前往终端
- `src/components/settings/AgentSettingsCard.vue` — 开关、安装、事件策略、提示音
- `src/api/tauri.ts` — invoke 封装（含 `resolvePermission`）
- `tools/agent-hook-tester/` — 本地网页测试器（直连 23456）

## 子文档

- [roadmap-and-progress.md](roadmap-and-progress.md) — P0–P8 路线图与进度
- [event-display-policy-off-auto-sticky-and-sticky-merge-behavior.md](event-display-policy-off-auto-sticky-and-sticky-merge-behavior.md) — 三态与 sticky 合并
- [agent-toast-card-content-interaction-and-component-boundary.md](agent-toast-card-content-interaction-and-component-boundary.md) — 内容来源、交互、组件边界、提示音
- [agent-卡片信息分层-项目事件会话title-与-sticky合并后窗口高度重算.md](agent-卡片信息分层-项目事件会话title-与-sticky合并后窗口高度重算.md) — **卡面信息架构 + 合并后高度纪律**
- [permission-挂起时-session变化必须-timeout释放-与-HTTP请求并行.md](permission-挂起时-session变化必须-timeout释放-与-HTTP请求并行.md) — **P6 挂起释放 + 并行 accept + CORS**
- [本地网页直连-agent-hook-测全链路-CORS与测试页.md](本地网页直连-agent-hook-测全链路-CORS与测试页.md) — 测试页用法与设计取舍
- [files-to-change-when-adding-a-new-agent-hook-target.md](files-to-change-when-adding-a-new-agent-hook-target.md) — 新增 agent 接入清单
- [hook-install-development-guide.md](hook-install-development-guide.md) — 改安装/脚本前必读
