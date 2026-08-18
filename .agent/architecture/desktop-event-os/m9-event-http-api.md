# M9 — 外部 Event HTTP API

> 状态：骨架已合入并完成进度链路真机验证（2026-07-20）。SSE/webhook 延后 **M9.1**。  
> 前置：M6 已验收后解封本里程碑。

## 目的

外部进程（脚本、本地 agent、CI 辅助）需要 **loopback** 写入桌面 Toast，不经 Tauri invoke，也不能冒充内部生产者（rest/water/…）。

## 表面契约

| 项 | 值 |
|----|-----|
| Bind | `127.0.0.1:23457` only |
| Stack | `tiny_http`（与 agent_hook `:23456` 同族、端口分离） |
| 默认 | **启用**（`event_sdk_enabled=true`） |
| 鉴权 | Bearer；DB `event_sdk_token` 首次自动生成 |
| CORS | 无 |
| 强制字段 | `source=sdk`、`kind=sdk`、`display_mode=toast` |
| 限流 | 10 req/s；5 publish/s |

## 路由

- `GET /v1/health` — 无鉴权
- `POST /v1/events` — 发布
- `GET /v1/events` — 仅 active **sdk**
- `GET|PATCH /v1/events/:id`
- `POST /v1/events/:id/resolve`

## UI

- **调试页** `EventSdkSettingsCard`（`n-card`，与通知测试/Signal 同风格）
- `SdkToastCard`：`ReminderToast` bus 监听
- 同 id / `dedupe_key` 原地更新
- hub 只存事件，**不**渲 Toast 卡

## Demo

[`tools/event-sdk/README.md`](../../../tools/event-sdk/README.md)

## 代码

- `src-tauri/src/event_http.rs`
- `src-tauri/src/bus.rs`（`EventBus::get`）
- `src/components/SdkToastCard.vue`
- `src/components/settings/EventSdkSettingsCard.vue`（入口在 Debug）

## 范围外（M9.1+）

- SSE / webhook action 回调
- 浏览器 CORS 演示
- 正式 npm/pypi 包
- 插件市场（M10）

## 功能索引

- [[event-sdk]]
