# 2026-07-17 — P6 权限真审批（Claude Allow/Deny）

> 对应路线图 P6，见 [roadmap-and-progress.md](../features/agent-notification/roadmap-and-progress.md)。
> 机制对照 clawd `src/server-route-permission.js` / `src/permission.js` / `hooks/install.js`。

## 起因

P3「只通知」的 PermissionRequest sticky 卡有个闭环漏洞：**在终端 Allow/Deny 后卡片不会销**。
因为批准后 agent 走的是 `PreToolUse → PostToolUse`，**没有 `UserPromptSubmit`**（用户没敲新 prompt），
而销卡只由 UserPromptSubmit 触发。clawd 根本没这问题——它 PermissionRequest 用 `type:"http"` 阻塞 hook 代批，
卡片消失=用户点按钮=回决策，三位一体。为彻底闭环，从 P3 直接跳到 P6 真审批。

## 链路

```
Claude PermissionRequest hook（type:"http"，timeout 600s）
  → POST 127.0.0.1:23456/permission
  → handle_permission：into_writer 拿 raw writer 挂起，登记 PENDING_PERMISSIONS
  → create_agent_permission_window 弹独立审批卡（PermissionToastCard，琥珀色）
  → 用户点 Allow/Deny → resolve_permission invoke 写决策
  → 接收线程轮询（150ms）取到决策 → 手写 HTTP 响应
       {hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow|deny"}}}
  → 540s 超时回 {} → Claude 回退终端审批
```

## 关键实现决策

| 决策 | 理由 |
|------|------|
| **`into_writer` 而非暂存 `Response`** | tiny_http `Request::respond` 消费 Request、无法跨线程暂存到 Mutex。`into_writer` 给出 `Box<dyn Write+Send>` raw 流，接收线程一直持有，决策到达后手写 `HTTP/1.1 200` 响应行+头+体。 |
| **接收线程内轮询（150ms），不 spawn 新线程** | tiny_http 默认每连接一个线程，阻塞在 `handle_request` 里循环只占用该连接的线程，不挡其他请求。 |
| **超时回 `{}` 而非 deny** | 回退终端原生审批，绝不替用户 deny。Claude 收到空/无 hookSpecificOutput 会走自己的终端 UI。 |
| **独立审批卡，不混待办 sticky** | 审批是「现在就要决策」，待办是「回来处理」，语义不同；卡带 Allow/Deny/前往终端三键。 |
| **安装时清 PermissionRequest 旧 command hook** | 避免 P3 command hook 与 P6 http hook 双发（clawd 同款 stale 清理）。url 作 http hook 的 marker 做幂等 sync。 |
| **Codex/Kimi 回退终端** | v1 只做 Claude；它们的旧 PermissionRequest command hook 重装时被清除，审批回 agent 原生 UI。二期再接。 |
| **无独立「审批开关」** | v1 装了 http hook 就代批；不想代批就不装/卸载。二期再加开关。 |

## 改动文件

- `src-tauri/src/agent_hook.rs`：`/permission` 分支、`handle_permission`、`PENDING_PERMISSIONS`、`resolve_permission`、
  `build_permission_response_body`、Claude http hook 注册+stale 清理、Codex/Kimi 旧 hook 清除、`KNOWN_EVENTS` 移除 PermissionRequest
- `src-tauri/src/reminder_toast.rs`：`create_agent_permission_window`
- `src-tauri/resources/catrace-agent-hook.cjs`：移除 PermissionRequest 映射（不再走 command 脚本）
- `src/components/PermissionToastCard.vue`：新审批卡（Allow/Deny/前往终端 + 决策/超时结果态）
- `src/views/ReminderToast.vue`：`kind=permission` 分支（常驻、不自动隐藏、不合并且不参与 sticky 合并）
- `src/api/tauri.ts`：`resolvePermission`
- `AgentToastCard.vue` / `AgentSettingsCard.vue` / i18n：清理 P3 只通知版的 PermissionRequest 残留

## 端口修正（2026-07-18）

P6 期间曾把 `AGENT_HOOK_PORT` 从 23456 改成 clawd 的 23333，理由记为「kimi 只往 23333 发」。
**这是错的**：clawd 的 `/state` 探测与 `PermissionRequest(http)` 都占用 23333，二者共存时
Catrace `tiny_http` 绑定 23333 失败 → 服务没起来 → 通知静默失效；即便绑上，决策也进了 clawd 的
服务器而非 Catrace。已改回 **23456**（clawd 探测范围 23333–23337，23456 不冲突，两者独立）。
同步三处：`agent_hook.rs` / `catrace-agent-hook.cjs` / `settings.json` 的 PermissionRequest url，
并移除 clawd 的 23333 permission hook（避免两个阻塞 http hook 抢答），clawd 的 `/state` 宠物 hook 保留。

## 验证

- `cargo check` ✅（Windows target，无警告）
- `pnpm vue-tsc --noEmit` ✅
- 真机复测（Claude 跑 Bash → 卡出 → Allow 继续 / Deny 拒绝 / 超时回退）留给 P5

## 下一步

P5 实测发版：重点真机复测 P6 三种决策路径 + 重装后 http hook 生效，然后升版。
P6 二期：Codex/Kimi 审批接入、独立「在 Catrace 审批」开关。
