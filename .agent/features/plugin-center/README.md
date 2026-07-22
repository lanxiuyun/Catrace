# 插件中心

插件页面提供左侧插件导航、启用状态排序，以及右侧统一的插件详情面板结构。

## Files involved

- `src/views/Plugins.vue` — 左侧插件中心、搜索、状态读取、排序和实时刷新。
- `src/components/plugins/RestPluginPanel.vue` — 久坐提醒插件详情面板。
- `src/components/plugins/TimerPluginPanel.vue` — 定时提醒插件详情面板。
- `src/components/plugins/AgentPluginPanel.vue` — Agent 通知插件详情面板。
- `src/api/tauri.ts` — 读取定时提醒和 Agent 插件启用状态。

## Sub-docs

- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md) — 状态来源、排序规则和面板边界。
