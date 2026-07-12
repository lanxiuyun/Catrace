# 事件三态策略（off / auto / sticky）与 sticky 合并行为

## 为什么是三态而不是开关

通知分两种性质：**状态播报**（会话开始、开始思考——错过无损失）和**召唤用户回来**（任务完成、出错、等待输入——agent 停了在等你）。开关只能二选一，三态让用户把召唤型设为常驻、播报型设为自动消失或关闭。

## 配置存储

- 键：`agent_event_modes`（SQLite settings 表），值为 `{event: mode}` JSON
- 启动时 `agent_hook::start_server` 加载进内存 `EVENT_MODES`
- 命令：`get_agent_event_modes` / `set_agent_event_mode`（校验事件名和 mode 合法性）
- 全局总开关 `agent_notification_enabled` 与事件策略独立：总开关关 → 全部不弹

## 默认值（agent_hook.rs `default_event_mode`）

| 事件 | 默认 | 性质 |
|------|------|------|
| SessionStart | off | 播报 |
| UserPromptSubmit | off | 播报 |
| Stop | sticky | 召唤 |
| StopFailure | sticky | 召唤 |
| Notification | sticky | 召唤 |

策略在**归一化后**的事件上生效（Gemini 的 AfterAgent 归一化为 Stop，走 Stop 的策略）。

## 去重规则

- `auto`：同 (session_id, event) 8 秒内只弹一次（DEDUP_TTL）
- `sticky`：**不去重**——召唤型事件每次都要让用户看到；重复事件由前端合并进同一张卡片而不是丢弃

## 前端 sticky 行为（ReminderToast.vue）

- `remainingMs = 0`，不启动自动消失定时器，无进度条，hover 不干预生命周期
- 只能手动点 × 关闭
- **合并**：已存在 sticky agent 卡时，新 sticky 事件不新建卡片，而是把事件追加到该卡的 `pendingEvents`；≥2 个时标题变「N 个会话在等你」（i18n `agent.titlePending` / `bodyPending`）
- 合并只针对 `mode === 'sticky'` 的 agent 卡；auto 卡照常独立入栈

## payload 字段

Rust eval 给前端的 JSON：`{ kind: "agent", event, agentState, mode }`，`mode` 决定前端走 auto 还是 sticky 分支。
