# 2026-07-21 久坐配置收敛到插件与 debug 自动链接 plugin-demo

## 目标

1. 澄清设置 IA：系统设置 vs 久坐功能插件
2. 把久坐 when/what/how 收敛进 `RestPluginPanel`
3. dev 启动自动 link `tools/plugin-demo`，少手工拷贝

## 完成

- `RestPluginPanel` 扩展：节奏、toast/fullscreen、文案、全屏背景、预览与测试
- 删除 `NotificationSettingsCard`；系统设置 core = media/signal/system/links
- i18n `plugins.rest.*`
- debug-only `ensure_dev_plugin_links`：plugin-demo → app_data/plugins（junction/symlink，不覆盖实目录）
- 决策与功能文档沉淀

## 未做 / 后续

- 可选：提交本轮代码
- 可选：彻底删除 popup 代码路径（决策仍 pending）
- 可选：rest 配置键命名空间化（当前有意保持旧键）
- M10.2 iframe/ACL；M9.1 SSE/webhook

## 关键文件

| 文件 | 变更 |
|------|------|
| `src/components/plugins/RestPluginPanel.vue` | 配置 UI 收敛 |
| `src/views/Settings.vue` | 去掉 notification core |
| `src/components/settings/NotificationSettingsCard.vue` | 删除 |
| `src-tauri/src/plugins.rs` | debug auto-link |
| `src/i18n/locales/*.ts` | 文案 |
