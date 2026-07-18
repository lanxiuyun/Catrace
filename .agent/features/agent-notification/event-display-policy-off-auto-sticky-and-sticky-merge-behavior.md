# 事件三态策略（off / auto / sticky）与 sticky 合并行为

## 为什么是三态而不是开关

通知分两种性质：**状态播报**（会话开始、开始思考——错过无损失）和**召唤用户回来**（任务完成、出错、等待输入——agent 停了在等你）。开关只能二选一，三态让用户把召唤型设为常驻、播报型设为自动消失或关闭。

## 配置存储

- 键：`agent_event_modes`（SQLite settings 表），值为 `{event: mode}` JSON
- 启动时 `agent_hook::start_server` 加载进内存 `EVENT_MODES`
- 命令：`get_agent_event_modes` / `set_agent_event_mode`（校验事件名和 mode 合法性）
- 全局总开关 `agent_notification_enabled` 与事件策略独立：总开关关 → 全部不弹

## 默认值（agent_hook.rs `default_event_mode`）

设计原则：**召唤型 sticky、播报型 off**；用户可在设置页逐事件改 off / auto / sticky，不钉死。

| 事件 | 默认 | 性质 |
|------|------|------|
| SessionStart | off | 播报 |
| UserPromptSubmit | off | 播报（仍参与自动销 sticky） |
| Stop | sticky | 召唤：完成 / 等你输入 |
| StopFailure | sticky | 召唤：错误 / 异常 |
| Notification | sticky | 召唤：助手喊你 |
| PermissionRequest | （不在三态表） | Claude 走阻塞 `POST /permission` 真审批，不进 `KNOWN_EVENTS` |

策略在**归一化后**的事件上生效（Gemini 的 AfterAgent 归一化为 Stop，走 Stop 的策略）。

PermissionRequest（P6）：Claude `type:"http"` → `/permission` 阻塞 + 独立审批卡。  
挂起期间同 session 的 `UserPromptSubmit` / 新审批会 timeout 释放旧连接，见  
[permission-挂起时-session变化必须-timeout释放-与-HTTP请求并行.md](permission-挂起时-session变化必须-timeout释放-与-HTTP请求并行.md)。

## 去重规则

- `auto`：同 (session_id, event) 8 秒内只弹一次（DEDUP_TTL）
- `sticky`：**不去重**——召唤型事件每次都要让用户看到；重复事件由前端合并进同一张卡片而不是丢弃

## 前端 sticky 行为（ReminderToast.vue）

- `remainingMs = 0`，不启动自动消失定时器，无进度条，hover 不干预生命周期
- 只能手动点 × 关闭
- **合并**：已存在 sticky agent 卡时，新 sticky 事件不新建卡片，而是按 sessionId 刷新/追加 `agentEntries`；≥2 个时顶栏「N 个会话在等你」
- 合并只针对 `mode === 'sticky'` 的 agent 卡；auto 卡照常独立入栈
- **合并后必须 `adjustWindowSize`**，否则窗口高度不涨、底部按钮被裁（见 [agent-卡片信息分层-…](agent-卡片信息分层-项目事件会话title-与-sticky合并后窗口高度重算.md)）
- **自动销项**：同 session 的 `UserPromptSubmit` 即使 mode=off，也 timeout 挂起审批 + 从前端清 agent 条目与 permission 卡。见 [agent-toast-card-content-interaction-and-component-boundary.md](agent-toast-card-content-interaction-and-component-boundary.md)

## payload 字段

Rust eval 给前端的 JSON：`{ kind: "agent", event, agentState, mode }`，`mode` 决定前端走 auto 还是 sticky 分支。
