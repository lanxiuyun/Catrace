# 2026-07-17 Agent sticky 自动销项 + 多会话前往只销当前

## Session goal

按 clawd-on-desk 机制完善 agent 通知：用户已回到会话时自动撤 sticky 待办；聚合卡「前往」不应关掉整张卡。

## Completed

- `UserPromptSubmit` 到达时，**先于**事件三态策略判断，按 `session_id` 调用 `dismiss_agent_session_toast` → 前端 `window.dismissAgentSession` 移除 sticky 条目
- 即使 `UserPromptSubmit` 默认 `mode=off` 不弹卡，销项仍生效（用户回到终端 = 待办完成）
- `AgentToastCard` 多会话「前往」成功后 `emit('dismissEntry')` 只销当前 session，单条仍整卡关闭
- 文档同步：README / event-display-policy / agent-toast-card / manifest current

## Remaining

- 实测自动销项与多会话前往
- Windows hook 命令包装（powershell / commandWindows）仍未做
- 发版前升版本号 26.7.16

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/agent_hook.rs` | UserPromptSubmit → dismiss_agent_session_toast |
| `src-tauri/src/reminder_toast.rs` | 新增 `dismiss_agent_session_toast` |
| `src/views/ReminderToast.vue` | `dismissAgentSession` + window 暴露；聚合 dismiss-entry |
| `src/components/AgentToastCard.vue` | dismissEntry 事件；多会话 goto 只销条目 |
