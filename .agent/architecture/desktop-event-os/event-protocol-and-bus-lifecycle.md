# Event Protocol 与 Bus 生命周期

## 协议要点

- `event_type`：稳定协议名，如 `reminder.water.due`
- `kind`：渲染族，对齐现有 toast kind（`water` / `agent` / …）
- `source`：判别联合 JSON  
  `{ "type": "internal" | "agent_hook" | "sdk" }` 或 `{ "type": "plugin", "name": "…" }`
- 生命周期：`status` active|resolved，`revision` 单调，`created_at`/`updated_at` ms
- `resolution.kind`：completed | dismissed | action | expired | superseded

## Commands（Tauri）

| Command | 作用 |
|---------|------|
| `publish_event` | 规范化 id/时间戳/revision，入库 registry，emit `catrace:event` |
| `update_event` | 白名单 patch（title/body/level/display_mode/actions/progress/sticky/payload/expires_at） |
| `resolve_event` | 置 resolved |
| `resolve_event_action` | 校验 action_id 后 resolve（**不**执行业务副作用） |
| `get_active_events` | 水合用 |

锁顺序：registry 内 mutate + clone → **放锁** → emit + broadcast。

## 前端 Hub

- 主窗口 `main.ts` 启动 `eventHub.startListening`（先 listen 再 `get_active_events`）
- Toast / reminder 窗 **不**启动 hub，避免双通道
- upsert 按 id；旧 revision 丢弃；resolved 历史有界

## 生产者双写范例（water）

```
title/body 算一次
  → bus.publish(BusEvent { event_type, kind: water, … })
  → reminder_toast::create_toast_window(…)   // 权威 UI
```

bus 失败只 log。后续 eye/rest/agent 照抄，permission 最后（阻塞语义敏感）。

## 扩展时

1. 新 `event_type` 写入协议约定（勿与 kind 混用）
2. 生产者：双写；勿让 hub 渲第二张卡
3. 需要 Action 业务：在生产者 command 里做，resolve 只记账
4. 插件 Card：远期 `pluginRegistry.getCardComponent`，本期 toast 仍 hardcode kind

相关：[[water-reminder]] · [[toast-window]] · [step2-roadmap…](step2-roadmap-event-core-and-signal-core.md)
