# 插件详情边距由宿主统一，不再用 PluginPanelShell

## 背景

Rest/Agent 曾用 `PluginPanelShell` 统一 `64rem` 与 padding；外部无 settings 占位在 `Plugins.vue` 另写一套；timer `settings.mjs` 再写第三套。面板组件还夹杂布局职责。

## 决策

1. **唯一内容外壳**：`Plugins.vue` → `.plugin-detail`（max-width / 居中 / padding / gap）。
2. **面板只出业务**：内置 Vue 面板与外部 `settings.mjs` 不包 layout shell、不重复外层边距。
3. **保留** `PluginSection`（section 卡片）与 `PluginPanelHeader`（顶栏开关）。
4. **删除** `PluginPanelShell.vue`。

## 后果

- 新增内置/外部 settings 时默认继承宿主边距；需要全宽装饰再在业务层局部覆盖。
- 已装外部插件若仍自带大 padding，需改包或重拷 demo（宿主不再双倍缩进）。

## 关联

- [[plugin-center]] [插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md](../features/plugin-center/插件详情内容区外壳收归宿主-plugin-detail-面板只出业务.md)
- [[app-shell]] 插件页布局约定
