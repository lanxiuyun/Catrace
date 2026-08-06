# 2026-07-26 插件禁用态由父组件统一灰显而非面板内部隐藏

## Context
Agent 通知、久坐提醒、定时提醒三个内置插件面板原本各自处理禁用态：
- Agent 与久坐：禁用后隐藏业务内容，显示 `.empty-state` 占位文案。
- 定时提醒：禁用后局部灰显，但实现不一致。
- 外部插件：没有统一的禁用态视觉处理。

这导致同样的“禁用”语义有三种不同表现，且每个面板都维护一份 `empty-state` 模板和样式。

## Decision
将禁用态的视觉处理收敛到父组件 `Plugins.vue`：
- 面板内部始终渲染业务内容，不再根据 `enabled` 切换 empty-state。
- `Plugins.vue` 在 `<component>` 内置面板容器和 `external-content` 外部插件容器上，根据启用状态添加统一的灰显遮罩。
- 遮罩只负责阻断鼠标交互，不改变光标样式。

## Consequences
- **一致**：所有内置插件和外部插件禁用后表现统一（灰显但可见）。
- **简化**：面板组件不再维护 empty-state 模板和 `v-if="enabled"` 分支。
- **可扩展**：新增插件面板时，只要使用 `PluginPanelShell` / `PluginSection`，禁用态自动由父组件处理。
- **限制**：禁用态不逐元素加 `disabled` 属性，依赖遮罩阻断交互；键盘焦点可通过顶层开关控制，面板内部控件不再额外处理 disabled 属性。

## Related files
- `src/views/mainWindow/Plugins.vue` — 统一灰显遮罩实现
- `src/components/plugins/PluginPanelShell.vue` — 面板外壳公共组件
- `src/components/plugins/PluginSection.vue` — Section 卡片公共组件
