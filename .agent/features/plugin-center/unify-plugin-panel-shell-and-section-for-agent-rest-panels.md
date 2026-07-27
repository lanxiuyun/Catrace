# （历史）Agent / 久坐曾共用 PluginPanelShell

> **已过时。** 当前约定见 [插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md](插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md)。

## 当时做了什么

Rest / Agent 面板布局重复，抽过：

- `PluginPanelShell.vue` — `max-width: 64rem` + padding + gap
- `PluginSection.vue` — section 标题 + 白卡片（**仍在用**）

禁用态改为父级 `Plugins.vue` 灰显 + overlay，面板内不再 `empty-state`。

## 为何废弃 Shell

宿主占位、Shell、外部 `settings.mjs` 三处重复同一边距。外壳应收归 `Plugins.vue` 的 `.plugin-detail`，面板只出业务。`PluginPanelShell.vue` 已删除。
