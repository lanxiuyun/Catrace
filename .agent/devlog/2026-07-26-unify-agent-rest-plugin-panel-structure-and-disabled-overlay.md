# 2026-07-26 统一 Agent 与久坐面板结构并统一禁用灰显

## Session goal
将久坐提醒（RestPluginPanel）的结构改成与 Agent 通知（AgentPluginPanel）一致，并把两者共用的面板外壳与 Section 卡片抽离为可复用组件；同时让所有插件（内置 + 外部）在禁用时统一灰显但可见。

## Completed
- 在 `Plugins.vue` 中为内置面板和外部插件内容区统一添加 `disabled-overlay` 遮罩，`is-disabled` 时灰显并阻断交互。
- 新增 `PluginPanelShell.vue` 统一面板外壳（`panel-content` + `panel-body` 布局）。
- 新增 `PluginSection.vue` 统一 Section 标题、描述与卡片容器。
- 重构 `AgentPluginPanel.vue` 与 `RestPluginPanel.vue`，使用公共组件并删除各自的 `empty-state` 与重复外壳样式。
- 移除 `disabled-overlay` 的 `cursor: not-allowed`（只遮交互，不改变光标）。
- 按功能拆分为 4 个 git commit 提交。
- `pnpm vue-tsc --noEmit` 通过。

## Key file changes

| File | Change |
|------|--------|
| `src/views/mainWindow/Plugins.vue` | 内置/外部插件内容区加禁用灰显遮罩；新增 `.plugin-detail-wrapper`、`.plugin-detail-content.is-disabled`、`.disabled-overlay` 样式 |
| `src/components/plugins/PluginPanelShell.vue` | 新增：面板外壳公共组件 |
| `src/components/plugins/PluginSection.vue` | 新增：Section 卡片公共组件 |
| `src/components/plugins/AgentPluginPanel.vue` | 使用公共组件；删除 empty-state 与重复外壳/section 样式；内容始终渲染 |
| `src/components/plugins/RestPluginPanel.vue` | 使用公共组件；删除 empty-state 与重复外壳/section 样式；内容始终渲染 |
