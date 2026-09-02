# 插件中心

左侧插件导航 + 启用排序 + 右侧统一详情：顶栏开关由宿主固定，**内容边距/宽度由宿主 `.plugin-detail` 统一**，面板组件只出业务。

## Files involved

- `src/views/mainWindow/Plugins.vue` — 容器：导航、`.plugin-detail` 外壳、内置/外部详情、禁用灰显、本地安装。
- `src/components/plugins/PluginNavRail.vue` — 左侧导航（搜索、列表、刷新、安装文件夹/zip、打开目录）。
- `src/components/plugins/PluginPanelHeader.vue` — 详情顶栏（图标 + 标题/副标题 + 开关）。
- `src/components/plugins/PluginSection.vue` — Section 卡片（标题 + 描述 + 白底容器）。
- `src/components/plugins/RestPluginPanel.vue` — 久坐业务面板。
- `src/components/plugins/AgentPluginPanel.vue` — Agent 业务面板。
- `tools/plugin-demo/timer/settings.mjs` — 外部 settings 参考（内联编辑、边距归宿主）。
- `src/plugins/pluginRuntime.ts` — 外部插件 Vue/naive/UI runtime 注入。
- `src/api/tauri.ts` — 插件启用与外部异常状态。
- `src-tauri/src/plugin_commands.rs` / `plugins.rs` — 外部插件与异常观测；enable 走 `sync_plugin`。
- `src-tauri/src/plugin_sidecar.rs` — sidecar 启停；开关只动一颗，刷新才 `schedule_sync_force`。

## Sub-documents

- [插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md](插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md) — **当前**内容区布局与面板边界（含外部 settings 勿叠根 padding / 窄屏反例）。
- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md) — 状态来源、排序、顶栏边界。
- [插件中心-sidecar本机进程徽章与信任文案展示.md](插件中心-sidecar本机进程徽章与信任文案展示.md) — 插件页**不**展示本机进程 / Native 技术标签。
- [插件异常标签如何判定和保持不拦截.md](插件异常标签如何判定和保持不拦截.md) — 异常 Tag 与观测。
- [插件开关只启停当前sidecar-刷新按钮才按enable全量重启.md](插件开关只启停当前sidecar-刷新按钮才按enable全量重启.md) — 外部 sidecar 生命周期：开关 / 关开自己 / 刷新全量。
- [插件开关必须在持久化成功后再刷新列表.md](插件开关必须在持久化成功后再刷新列表.md) — 开关与列表时序。
- [插件面板和导航栏组件化拆分.md](插件面板和导航栏组件化拆分.md) — header / nav-rail 拆分。
- [unify-plugin-panel-shell-and-section-for-agent-rest-panels.md](unify-plugin-panel-shell-and-section-for-agent-rest-panels.md) — 历史：PluginPanelShell 已废弃。
- [plugin-activity-getRecords-历史分钟记录.md](plugin-activity-getRecords-历史分钟记录.md) — 外置插件读过往热力图：`plugin.activity.getRecords`。

外部插件 naive 注入与 teleport 约定见 [[timer-plugin]] / [[m10-external-plugins]]。

## 启用即信任 / 开发目录

- 用户启用外部插件 = 信任其本地代码（含 sidecar）。**不**做逐项权限弹窗。宿主仍强制：窗口 label 推导 plugin id、禁用即停能力、Event 所有权、`storage` 按插件隔离。
- Debug：`tools/plugin-demo`（git submodule）junction 到 `app_data/plugins/<id>`。改 demo 即时生效。Windows 上先关 app / 杀 sidecar 再动目录，否则 junction 目标被锁。
- 克隆宿主必须 `git submodule update --init --recursive`，否则插件目录是空的。插件改动提交到 `catrace-plugin`，宿主只更新 submodule 指针。