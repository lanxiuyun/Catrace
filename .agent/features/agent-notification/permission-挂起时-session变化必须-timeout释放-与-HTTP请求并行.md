# 审批卡挂起时 session 变化必须 timeout 释放 + HTTP 请求并行

> 关联 bug：[2026-07-18-permission-hang-on-session-change](../../bugs/2026-07-18-permission-hang-on-session-change.md)  
> 关联 devlog：[2026-07-17-p6-permission-approve-deny](../../devlog/2026-07-17-p6-permission-approve-deny.md)

## 问题模型

`POST /permission` 是**阻塞**的：接收线程轮询 `PENDING_PERMISSIONS`，直到 UI `resolve_permission` 或 540s 超时才写 HTTP 响应。  
Claude 的 PermissionRequest http hook 一直等这个响应；不回 = agent 线程挂死。

任何「拆掉审批卡 UI 却不写 decision」的路径都会造成挂死：

| 路径 | 旧行为 | 现行为 |
|------|--------|--------|
| 同 session `UserPromptSubmit` | 只销 sticky agent 卡 | 先 `timeout_pending_permissions_for_session`，再 dismiss（含 permission 卡） |
| 同 session 新 `/permission` | 旧 pending 残留 | 新请求先 timeout 旧 pending + dismiss 旧卡 |
| `removeNotification`（挤栈/关窗/销项） | 只删 DOM | permission 卡强制 `resolvePermission(..., 'timeout')` |
| 用户点 Allow/Deny/前往 | 正常 | 不变；已有 decision 不覆盖（竞态先到者胜） |

timeout 响应 body 仍是 `{}`（无 `hookSpecificOutput`）→ Claude **回退终端审批**，绝不替用户 deny。

## 实现要点（agent_hook.rs）

```text
timeout_pending_permissions_for_session(session_id)
  → 遍历 PENDING_PERMISSIONS，同 session 且 decision=None 的标 "timeout"
  → 接收线程 take_permission_decision 取走后从 map 删除并回 {}

handle_permission
  → 登记新 id 前先 timeout 同 session 旧 pending
  → dismiss_agent_session_toast（清 UI）

UserPromptSubmit 分支（在 mode 过滤之前）
  → timeout_pending + dismiss_agent_session_toast
```

前端 `dismissAgentSession` 同步关 `kind=permission` 且 session 匹配的卡。  
后端已 timeout 时前端再 resolve 返回 false，无害。

## 第二个坑：串行 accept 卡死后续 /state

`tiny_http` 默认在**一个**循环里 `handle_request`。`/permission` 阻塞数分钟时，后面的 Stop / StopFailure 全排队，表现为「点完审批卡才一起刷 toast」。

**修法**：每个 incoming request `thread::spawn` 单独处理。  
permission 线程仍可阻塞；state 线程立刻 200 + 建窗。

```rust
for request in server.incoming_requests() {
    let app = app.clone();
    thread::spawn(move || handle_request(&app, request));
}
```

## 本地网页测试需要 CORS

浏览器（含 `file://` 打开的测试页）跨源 POST 本机 23456 会预检。  
`agent_hook` 对 OPTIONS 回 204 + CORS 头；`/state` 空响应与 `/permission` 手写响应都带：

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

Claude / Node hook 不读这些头，无影响。只监听 `127.0.0.1`，不扩大攻击面到局域网。

## 测试

仓库内 `tools/agent-hook-tester/index.html`（可双击或 `python tools/agent-hook-tester/server.py`）。  
推荐场景：**S5 审批被 prompt 取消**、**S6 同 session 顶替**、审批中途点 Stop（应立刻弹 sticky）。
