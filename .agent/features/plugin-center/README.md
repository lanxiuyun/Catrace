# 插件中心

插件页面提供左侧插件导航、启用状态排序，以及右侧统一的插件详情面板结构。

## Files involved

- `src/views/Plugins.vue` — 左侧插件中心、搜索、状态读取、排序和实时刷新。
- `src/components/plugins/RestPluginPanel.vue` — 久坐提醒插件详情面板。
- `src/components/plugins/TimerPluginPanel.vue` — 定时提醒插件详情面板。
- `src/components/plugins/AgentPluginPanel.vue` — Agent 通知插件详情面板。
- `src/api/tauri.ts` — 读取插件启用状态和外部插件异常状态。
- `src-tauri/src/plugin_commands.rs` — 按插件观测事件、Storage 写入和内存活动。
- `src-tauri/src/plugins.rs` — 保存本次运行中的异常状态。

## Sub-docs

- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md) — 状态来源、排序规则和面板边界。
- [插件异常标签如何判定和保持不拦截.md](插件异常标签如何判定和保持不拦截.md) — 资源活动判定、实时 Tag 数据流和“不限流、不丢弃”约定。
