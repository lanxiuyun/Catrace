# ADR：M6 验收后先做本机 Event HTTP，不做插件市场

- **日期：** 2026-07-20
- **状态：** Accepted

## 背景

路线图曾把 M9（外部 SDK / HTTP）标为暂缓。M6 已验收；产品仍需要本地脚本推 Toast 的务实通道，又不想上正式 SDK 包或插件市场。

## 决策

立刻做 **M9 = loopback HTTP Event API**：

1. 端口 **23457**，默认 **ON**，与 agent_hook **23456** 分离
2. Bearer token；外部发布强制 `source/kind/display_mode`
3. 本切片不做 SSE/webhook（记为 M9.1）
4. demo kit 仅 `tools/event-sdk/`
5. 管理 UI 放在 **调试页**（非设置拖拽卡、非插件）

## 后果

- 外部自动化无需 Tauri 绑定即可推事件
- 攻击面限制在回环 + token + 限流
- Action 反馈现阶段只能本地 resolve / 轮询 GET
- 设置页保持产品配置；调试页承载开发者/集成入口
