# 外部 Event HTTP API

本机脚本通过 loopback HTTP 写入宿主 Bus，不经 Tauri invoke，也不能冒充宿主内部生产者。

| 项 | 合同 |
|---|---|
| Bind | `127.0.0.1:23457` |
| 默认 | 启用；关闭后写请求拒绝，health 可探活 |
| 鉴权 | Bearer token，DB 首次生成 |
| 浏览器 | 无 CORS |
| SDK 发布 | source=sdk、kind=sdk、display_mode=toast |
| 流控 | 10 req/s、5 publish/s |

支持 health、publish、active list、get、patch 与 resolve。带 plugin_id 的请求另校验安装、启用、事件声明和所有权，详见 [event_http.rs](../../../src-tauri/src/event_http.rs) 与[功能文档](../../features/event-sdk/README.md)。

## 前端与验证

[EventSdkCard.tsx](../../../src/app/pages/debug/EventSdkCard.tsx) 在调试页提供开关／token／轮换；[busEvents.ts](../../../src/app/windows/toast/busEvents.ts) 水合并原地更新事件，[SdkToastCard.tsx](../../../src/components/SdkToastCard.tsx) 渲染通用卡。主窗 Event Hub 只观察，不弹第二张卡。

外部调用示例见 [tools/event-sdk](../../../tools/event-sdk/README.md)。Action 通过 resolve 记录生命周期，没有 webhook 回调或 SSE 推流。
