# 2026-07-18 — P6 权限审批卡不弹：一下午的排查与根因

> 根因细节见 [bugs/2026-07-18-permission-card-not-popping-event-field-missing](../bugs/2026-07-18-permission-card-not-popping-event-field-missing.md)。

## 会话目标

P6 真审批（Claude Allow/Deny）真机联调：让 Claude Code 的 `PermissionRequest` 走 Catrace 的阻塞 `/permission`，弹出琥珀色审批卡。

## 现象

- `curl` / 测试脚本 POST `/permission` → 审批卡**正常弹出**、决策正常返回。
- 真实 Claude Code 触发 → **不弹卡**，Claude 停在终端原生 `Yes/No` 框。

## 排查走过的弯路（按顺序）

1. **以为是端口被 clawd 抢**：发现 settings.json 里 PermissionRequest 同时指向 23333（clawd）和 23456（Catrace），Claude 双发。清掉 clawd 的 hook 只留 Catrace。
2. **以为是会话没重启**：Claude 启动时加载 hook，改了 settings 要新会话才生效。
3. **以为有第二个进程抢 23456**：netstat / Get-Process 确认只有一个 catrace.exe。
4. **以为窗口没显示**：`adjustWindowSize` 日志显示 afterSize/afterPos 正常、前端 `visible=true`。
5. **最后给 `handle_request` 入口加日志** + 给 JSON 解析失败打 `err`，**立刻真相大白**：`/permission` body 缺 `event` 字段，`serde` 必填校验失败，静默 400。

## 真正的根因

`AgentHookPayload.event` 必填，但 Claude 的 http hook 直发 body 只有 `hook_event_name`、没有 `event`。`curl` 测试手动加了 `event`，把 bug 掩盖了。

## 顺手解决的干扰项

| 项 | 处理 |
|----|------|
| clawd 与 Catrace 抢 23333 / hook 重复注册 | 清理 settings.json，只留 Catrace 的 23456；端口固定 23456（clawd 探测段 23333–23337 之外） |
| 测试脚本走旧 P3 路径 | `test-catrace-hook.ps1` 改 POST `/permission`（阻塞），body 与真实 Claude 对齐 |
| 排查全靠猜 | `handle_request` 入口加「收到请求」主日志；解析失败打 err+body |

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `src-tauri/src/agent_hook.rs` | `event` 改 `#[serde(default)]` + 新增 `hook_event_name` 兜底；解析失败打 err+body；入口加「收到请求」日志 |
| `src-tauri/src/reminder_toast.rs` | 建窗协程各分支补日志（临时） |
| `src/views/ReminderToast.vue` | `addToastNotification` / permission 分支 / `adjustWindowSize` 补 `log_frontend`（临时） |
| `test-catrace-hook.ps1` | `/permission` 步骤改阻塞式，body 对齐真实 Claude |

## 结论与教训

**跨软件 HTTP 联调，开发初期就要把「请求入口日志 + 解析失败原因」写好。** 这次若第一天就有这两行日志，10 分钟定位，而不是一下午。详见 bugs 文档的「教训」节。

临时调试日志（`debug_log_hit` 落盘、前端 `log_frontend`）在 P5 收口前应清理或降级。
