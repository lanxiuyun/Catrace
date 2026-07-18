# 2026-07-18 — 审批卡未点时 session 变化导致 agent 线程挂死

> 关联：P6 真审批，见 [devlog 2026-07-17-p6-permission-approve-deny](../devlog/2026-07-17-p6-permission-approve-deny.md)。

## 症状

Claude 触发 `PermissionRequest` → Catrace 弹出琥珀色审批卡。用户**没点 Allow/Deny**，但会话侧发生变化（新 prompt / 同 session 新审批 / 卡片被栈顶挤掉），Claude 侧 hook 线程一直挂着，表现为「卡死」。

## 根因

`/permission` 是阻塞 HTTP：接收线程轮询 `PENDING_PERMISSIONS`，直到 UI `resolve_permission` 或 540s 超时才回响应。

以下路径会**拆掉审批卡 UI，却不写 decision**：

1. **`UserPromptSubmit` 自动销项** — `dismissAgentSession` 只清 sticky agent 卡，**不碰** `kind=permission` 卡；即便清了卡，后端 pending 也不动。
2. **同 session 新 `/permission` 顶上来** — 旧 pending 仍挂着，旧卡也还在。
3. **`MAX_NOTIFICATIONS` 挤栈 / 关窗** — `removeNotification` 直接删卡，不 `resolve`。

结果：Claude 的 http hook 一直等响应 → agent 线程卡死（最多等到 540s，体感已是挂死）。

## 修复

| 层 | 改动 |
|----|------|
| `agent_hook.rs` | `timeout_pending_permissions_for_session`：按 session 把未决策 pending 标 `timeout` |
| | `UserPromptSubmit`：先 timeout 该 session 的 pending，再 dismiss UI |
| | 新 `/permission`：先 timeout 同 session 旧 pending + dismiss 旧卡，再挂新请求 |
| | `resolve_permission`：已有 decision 不覆盖（取消与点击竞态，先到者胜） |
| | `take_permission_decision`：取走后从 map 删除，避免残留 |
| `reminder_toast.rs` | `dismiss_agent_session_toast` 注释标明也管审批卡 UI |
| `ReminderToast.vue` | `dismissAgentSession` 同时关同 session 的 permission 卡 |
| | `removeNotification`：permission 卡被任何路径移除时 `resolvePermission(..., 'timeout')` 兜底 |

timeout 仍回 `{}`，Claude 回退终端原生审批，**绝不替用户 deny**。

## 验证

- `cargo check` ✅
- `pnpm vue-tsc --noEmit` ✅
- 真机：弹审批卡 → 同会话再发一句 prompt → 卡应消失、Claude 应回退终端或继续，不再永久挂起
