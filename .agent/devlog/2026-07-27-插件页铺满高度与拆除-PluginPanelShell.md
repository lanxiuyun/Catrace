# 2026-07-27 插件页铺满高度与拆除 PluginPanelShell

## Session goal

修插件页高度不铺满；内容区外壳收归宿主，面板只出业务。

## Completed

- MainShell：`n-scrollbar` container/content `height: 100%`（min-height 无效已验证）
- 拆除 `PluginPanelShell`；`Plugins.vue` `.plugin-detail` 统一内置/外部占位外壳
- Rest/Agent 面板去 shell；timer demo 去掉重复 max-width/padding
- 清理 Plugins 多余 class（external-content / placeholder-content / external-body）
- 布局文档与 plugin-center README 同步

## Pending

- 已安装的用户目录 timer 包若仍双 padding，需重拷 demo 或手改 settings
- 其它主窗短页是否也依赖 content `height:100%`，有回归再收紧约定

## Key file changes

| File | Change |
|------|--------|
| `src/views/mainWindow/MainShell.vue` | scrollbar content/container `height:100%` |
| `src/views/mainWindow/Plugins.vue` | 宿主 `.plugin-detail`；删冗余 CSS |
| `src/components/plugins/RestPluginPanel.vue` | 只出业务 |
| `src/components/plugins/AgentPluginPanel.vue` | 只出业务 |
| `src/components/plugins/PluginPanelShell.vue` | 删除 |
| `tools/plugin-demo/timer/settings.mjs` | 去掉宿主已提供的边距 |
| `.agent/architecture/app-shell/*` | 布局约定更新 |
