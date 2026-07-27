# 2026-07-27 插件页铺满高度与拆除 PluginPanelShell

## Session goal

修插件页高度不铺满；内容区外壳收归宿主，面板只出业务。

## Completed

- MainShell：只保留固定应用壳、单一 RouterView + KeepAlive，不再创建任何页面 scrollbar
- Dashboard / Settings / Debug：统一使用 `PageScroll`；PluginNavRail 的插件列表也复用 `PageScroll`；Plugins 右侧只滚 `plugin-scroll`
- 拆除 `PluginPanelShell`；`Plugins.vue` `.plugin-detail` 统一内置/外部占位外壳
- Rest/Agent 面板去 shell；timer demo 去掉重复 max-width/padding
- 清理 Plugins 多余 class（external-content / placeholder-content / external-body）
- 布局文档与 plugin-center README 同步
- Playwright 连接 `http://localhost:1420` 验证：插件页左侧列表 `PageScroll=1`、右侧详情 `plugin-scroll=1`，无页面级滚动；构造长详情后仅 content 位移，global header / panel header / rail 坐标不变；Settings `PageScroll=1 / plugin-scroll=0` 且可滚动

## Pending

- 已安装的用户目录 timer 包若仍双 padding，需重拷 demo 或手改 settings
- 其它主窗短页是否也依赖 content `height:100%`，有回归再收紧约定

## Key file changes

| File | Change |
|------|--------|
| `src/components/PageScroll.vue` | 普通页面复用的全高滚动壳 |
| `src/views/mainWindow/MainShell.vue` | 固定壳 + 单一 RouterView / KeepAlive，不创建 scrollbar |
| `src/views/mainWindow/Dashboard.vue` | 使用 PageScroll |
| `src/views/mainWindow/Settings.vue` | 使用 PageScroll |
| `src/views/mainWindow/Debug.vue` | 使用 PageScroll |
| `src/views/mainWindow/Plugins.vue` | 宿主 `.plugin-detail`；唯一右侧详情滚动区 |
| `src/components/plugins/PluginNavRail.vue` | 标题/搜索固定，列表复用 PageScroll |
| `src/components/plugins/RestPluginPanel.vue` | 只出业务 |
| `src/components/plugins/AgentPluginPanel.vue` | 只出业务 |
| `src/components/plugins/PluginPanelShell.vue` | 删除 |
| `tools/plugin-demo/timer/settings.mjs` | 去掉宿主已提供的边距 |
| `.agent/architecture/app-shell/*` | 布局约定更新 |
