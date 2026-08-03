# 插件中心

左侧插件导航 + 启用排序 + 右侧统一详情：顶栏开关由宿主固定，**内容边距/宽度由宿主 `.plugin-detail` 统一**，面板组件只出业务。

## Files involved

- `src/views/mainWindow/Plugins.vue` — 容器：导航、`.plugin-detail` 外壳、内置/外部详情、禁用灰显。
- `src/components/plugins/PluginNavRail.vue` — 左侧导航（搜索、列表、刷新、打开目录、sidecar Tag、信任文案）。
- `src/components/plugins/PluginPanelHeader.vue` — 详情顶栏（图标 + 标题/副标题 + 开关 + 可选本机进程 badge）。
- `src/components/plugins/PluginSection.vue` — Section 卡片（标题 + 描述 + 白底容器）。
- `src/components/plugins/RestPluginPanel.vue` — 久坐业务面板。
- `src/components/plugins/AgentPluginPanel.vue` — Agent 业务面板。
- `tools/plugin-demo/timer/settings.mjs` — 外部 settings 参考（内联编辑、边距归宿主）。
- `src/plugins/pluginRuntime.ts` — 外部插件 Vue/naive/UI runtime 注入。
- `src/api/tauri.ts` — 插件启用与外部异常状态。
- `src-tauri/src/plugin_commands.rs` / `plugins.rs` — 外部插件与异常观测。

## Sub-documents

- [插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md](插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md) — **当前**内容区布局与面板边界（含外部 settings 勿叠根 padding / 窄屏反例）。
- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md) — 状态来源、排序、顶栏边界。
- [插件中心-sidecar本机进程徽章与信任文案展示.md](插件中心-sidecar本机进程徽章与信任文案展示.md) — hasSidecar / sidecarRunning badge 与 trustNote。
- [插件异常标签如何判定和保持不拦截.md](插件异常标签如何判定和保持不拦截.md) — 异常 Tag 与观测。
- [插件开关必须在持久化成功后再刷新列表.md](插件开关必须在持久化成功后再刷新列表.md) — 开关与列表时序。
- [插件面板和导航栏组件化拆分.md](插件面板和导航栏组件化拆分.md) — header / nav-rail 拆分。
- [unify-plugin-panel-shell-and-section-for-agent-rest-panels.md](unify-plugin-panel-shell-and-section-for-agent-rest-panels.md) — 历史：PluginPanelShell 已废弃。

外部插件 naive 注入与 teleport 约定见 [[timer-plugin]] / [[m10-external-plugins]]。