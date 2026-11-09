# Event SDK（外部 localhost HTTP）

本机回环 HTTP API，让外部脚本把 Toast 事件写入 Catrace Event Bus。**不是**插件市场，也不是正式 npm/pypi 包。

## 一句话

`127.0.0.1:23457` + Bearer token → `source=sdk` / `kind=sdk` / `display_mode=toast` → `SdkToastCard`。

## 涉及文件

- [event_http.rs](../../../src-tauri/src/event_http.rs) — HTTP 服务、鉴权、限流、Tauri commands
- [bus.rs](../../../src-tauri/src/bus.rs) — `EventBus::get`（HTTP get/patch/resolve）
- [lib.rs](../../../src-tauri/src/lib.rs) — 启动 `event_http::start_server`、注册 commands
- [event.rs](../../../src-tauri/src/event.rs) — `EventSource::Sdk`
- [SdkToastCard.tsx](../../../src/components/SdkToastCard.tsx) — 通用 sdk Toast 卡
- [EventSdkCard.tsx](../../../src/app/pages/debug/EventSdkCard.tsx) — React 调试面板（开关/token/轮换）
- [Debug.tsx](../../../src/app/pages/Debug.tsx) — 挂载 Event SDK 面板
- [busEvents.ts](../../../src/app/windows/toast/busEvents.ts) — `kind: sdk` 监听、原地更新、action resolve
- [tauri.ts](../../../src/api/tauri.ts) — `getEventSdkStatus` / `setEventSdkEnabled` / `rotateEventSdkToken`
- [demo kit](../../../tools/event-sdk/) — 外部脚本调用示例

## 关键约定

1. **仅 loopback**；无浏览器 CORS；插件专用 HTTP 服务由各自 sidecar 管理
2. **默认启用**；关闭后写入 503，`GET /v1/health` 仍可探活（无 token）
3. 外部请求 **强制** `source=sdk`、`kind=sdk`、`display_mode=toast`；保留 kind（rest/agent/permission/update/rest-timer/sdk）→ 403
4. list/get/resolve **只允许 sdk source** 事件
5. 限流：10 req/s、5 publish/s
6. Toast 内容只走 bus；hub **不**渲第二张卡
7. sdk 同 `event.id` / `dedupe_key` **原地 PATCH 更新**（勿被 `seenBusEventIds` 挡掉）
8. Action 点击本地 resolve；**无** webhook 回调
9. 管理 UI 在 **调试页**，使用 React `DebugPanel` 与 Radix 控件，不进设置拖拽网格

## API 速查

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/health` | 否 |
| POST | `/v1/events` | Bearer |
| GET | `/v1/events` | Bearer（仅 active sdk） |
| GET/PATCH | `/v1/events/:id` | Bearer |
| POST | `/v1/events/:id/resolve` | Bearer |

Publish：`title` 必填；可选 `body` / `level` / `sticky` / `actions` / `progress` / `dedupe_key` / …

## 子文档

- [外部脚本如何发一条-sdk-Toast-与进度更新.md](外部脚本如何发一条-sdk-Toast-与进度更新.md)
- 架构：[m9-event-http-api.md](../../architecture/desktop-event-os/m9-event-http-api.md)

## 相关

- [[desktop-event-os]] · [[toast-window]] · [[agent-notification]]
