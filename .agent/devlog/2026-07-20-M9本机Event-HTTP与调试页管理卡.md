# 2026-07-20 M9 本机 Event HTTP 与调试页管理卡

## 会话目标

M6 已验收后落地 **M9 外部 Event HTTP**（非插件市场）；补 demo kit；管理入口放调试页并统一 n-card 风格。

## 完成

- `event_http.rs`：`:23457` loopback、Bearer、强制 sdk 字段、限流、health/publish/list/get/patch/resolve
- bus `get`；lib 启动与 commands
- `SdkToastCard` + ReminderToast sdk 原地更新
- demo kit `tools/event-sdk/`
- 管理卡从设置拖拽网格 **迁到调试页**，并改成 Debug 同款 `n-card`
- 真机：`progress.mjs` 创建→PATCH 进度→resolve 消失
- 知识沉淀：feature `event-sdk`、架构 m9 文、ADR、本 devlog

## 待办

- 可选补测：401 / 403 保留 kind / 关闭后 503
- **M9.1**：SSE / webhook
- **M10**：插件生态（与 HTTP SDK 分离）

## 关键文件

| 文件 | 变更 |
|------|------|
| `src-tauri/src/event_http.rs` | HTTP Event API |
| `src-tauri/src/bus.rs` | `EventBus::get` |
| `src-tauri/src/lib.rs` | 启动与 command 注册 |
| `src/components/SdkToastCard.vue` | sdk Toast UI |
| `src/components/settings/EventSdkSettingsCard.vue` | 调试 n-card 管理 |
| `src/views/Debug.vue` / `Settings.vue` | 入口迁移 |
| `src/views/ReminderToast.vue` | sdk kind |
| `tools/event-sdk/*` | demo |
