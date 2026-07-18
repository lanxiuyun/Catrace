# 2026-07-18 — 权限审批卡不弹：`/permission` body 缺 `event` 字段致 JSON 解析失败

> 关联：P6 真审批，见 [devlog 2026-07-17-p6-permission-approve-deny](../devlog/2026-07-17-p6-permission-approve-deny.md) 与 [devlog 2026-07-18-p6-permission-card-not-popping-debug](../devlog/2026-07-18-p6-permission-card-not-popping-debug.md)。

## 症状

Claude Code 触发 `Bash` 审批时，**Catrace 的琥珀色审批卡不弹**，Claude 反而停在终端原生 `Yes/No` 框。
但用 `curl` / 测试脚本 `test-catrace-hook.ps1` 手动 POST `/permission`，审批卡**能正常弹出**。

## 根因

`AgentHookPayload.event` 是**必填字段**（没有 `#[serde(default)]`）：

```rust
struct AgentHookPayload {
    event: String,          // ← 必填
    #[serde(default)] state: String,
    ...
}
```

两条路径的 body 不一样：

- **`/state`**：由我们自己的 hook 脚本 `catrace-agent-hook.cjs` 发送，body 里有 `event` → 解析成功。
- **`/permission`**：由 Claude 的 `type:"http"` hook **直发**，body 里**只有 `hook_event_name`，没有 `event`**（还多了 `prompt_id` / `permission_mode` / `effort` / `permission_suggestions` 等字段）→ `serde_json::from_str` 报 `missing field 'event'` → 走 400 提前 return → 永远到不了建窗那步。

`curl` 测试之所以「能成功」，是因为测试 body 里**手动写了 `"event":"PermissionRequest"`**，恰好绕过了这个 bug——**测试样例和真实请求不一致，把 bug 掩盖了**。

## 为什么排查绕了这么久

`handle_request` 里当时**没有日志**：请求到达 → 解析失败 → 400 return，全程静默。
表面现象是「请求好像没到 Catrace」，于是一路怀疑：端口被 clawd 抢、settings 没生效、会话没重启、有第二个进程、窗口层级……全部查完都是好的，最后加日志才发现是**解析失败**。

中间还叠加了几个**真实的干扰项**，让假象更逼真：

1. **clawd 与 Catrace 抢 23333**：clawd 的 `install:claude-hooks` 是 append 不覆盖，会反复把自己 hook 加回 settings.json，导致 PermissionRequest 同时指两个端口，Claude 双发、谁先回用谁。
2. **测试脚本过时**：旧脚本把 `PermissionRequest` 发到 `/state`（P3 只通知模式），而 P6 已改为 `/permission` 阻塞审批。

## 修复

1. `AgentHookPayload.event` 加 `#[serde(default)]`，并新增 `hook_event_name` 字段；
2. 解析后兜底：`event` 为空时用 `hook_event_name` 补齐；
3. JSON 解析失败时 `log_error!` 打出 `err` 和完整 `body`（不再静默 400）。

```rust
#[serde(default)] event: String,
#[serde(default)] hook_event_name: String,
// 解析后：
if payload.event.is_empty() { payload.event = payload.hook_event_name.clone(); }
```

## 教训（这次最值钱的）

1. **跨软件 HTTP 联调，开发初期就要在「请求入口」写详细日志**：每个请求到达、body 内容、解析结果、分支走向。这次若在写 `/permission` 的第一天就有 `log_info!("收到 POST /permission")` + 解析失败打 `err`，10 分钟就能定位，而不是一下午。
2. **测试样例必须和真实请求逐字段一致**，包括「真实请求**没有**哪些字段」。手搓一个「看着像」的 body 会让解析类 bug 隐形。
3. **反序列化外部输入，字段尽量 `#[serde(default)]`**，对「对端可能不发」的字段绝不能设为必填；解析失败一定要打错误+原始 body。
