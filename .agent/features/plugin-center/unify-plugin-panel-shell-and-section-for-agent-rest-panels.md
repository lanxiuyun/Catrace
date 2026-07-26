# Agent 与久坐面板统一外壳和 Section 组件

## 背景
Agent 通知（`AgentPluginPanel.vue`）与久坐提醒（`RestPluginPanel.vue`）原本各自维护几乎完全相同的面板布局：
- `.agent-panel` / `.rest-panel` + `.panel-content` + `.panel-body`
- `.panel-section` + `.section-title` + `.section-card` + `.section-desc`
- 各自的 `.empty-state` 禁用占位

重复代码导致修改布局或视觉风格时需要改多处。

## 抽离出的公共组件

### `src/components/plugins/PluginPanelShell.vue`
负责面板级外壳：
- 根容器 `.plugin-panel-shell`：flex column，占满剩余高度。
- `.panel-content`：flex 1，承载滚动内容。
- `.panel-body`：固定最大宽度 `64rem`、水平居中、统一 padding 与 gap。

用法：
```vue
<plugin-panel-shell>
  <plugin-section title="...">...</plugin-section>
  <plugin-section title="..." description="...">...</plugin-section>
</plugin-panel-shell>
```

### `src/components/plugins/PluginSection.vue`
负责 Section 卡片容器：
- `section.plugin-section`：标题 + 卡片垂直排列。
- `.section-title`：统一的小字号、加粗、灰色调标题。
- `.section-card`：白色背景、浅灰边框、圆角、内阴影。
- 可选 `.section-desc`：卡片顶部的浅灰说明文字。

用法：
```vue
<plugin-section :title="t('...')" :description="t('...')">
  <div class="event-row">...</div>
</plugin-section>
```

## 重构后的面板约定

1. **不再处理 empty-state**：禁用态由父组件 `Plugins.vue` 统一加灰显遮罩，面板内部始终渲染业务内容。
2. **统一行布局**：业务行统一使用 `.event-row`（flex / space-between / align-center），行之间用 `border-top` 分隔。
3. **统一数值展示**：滑块旁的数值统一使用 `.value-display`（`min-width: 3.5rem`，右对齐，等宽数字）。
4. **保留业务特有样式**：Agent 的 `.agent-label`、久坐的 `.section-footer` 等仍保留在各自面板中。

## 禁用态统一实现

在 `Plugins.vue` 中：
- 内置面板渲染区套 `.plugin-detail-wrapper` > `.plugin-detail-content`，根据 `activeHeader.enabled` 添加 `.is-disabled`。
- 外部插件渲染区套 `.plugin-detail-wrapper` > `.external-content`，根据 `selectedExternal.enabled` 添加 `.is-disabled`。
- `.disabled-overlay` 绝对定位覆盖整个内容区，阻断鼠标交互但不改变光标。

## 影响范围
- `AgentPluginPanel.vue`：删除 empty-state、删除重复外壳/section 样式、使用公共组件。
- `RestPluginPanel.vue`：删除 empty-state、删除重复外壳/section 样式、使用公共组件。
- `TimerPluginPanel.vue`：结构保持现状，禁用态由父组件统一处理；其局部 `.is-disabled` 样式保留不影响功能。
- `Plugins.vue`：新增灰显遮罩与 wrapper 样式。
