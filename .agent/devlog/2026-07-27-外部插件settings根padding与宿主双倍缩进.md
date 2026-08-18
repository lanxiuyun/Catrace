# 2026-07-27 外部插件 settings 根 padding 与宿主双倍缩进

## Session goal

对齐定时提醒外部插件与内置插件详情布局；沉淀外部 `settings.mjs` 开发约定。

## Completed

- 确认差异来自 timer `settings.mjs` 窄屏残留 `@media` 根 padding，非宿主对外部另开路径。
- 去掉 `tools/plugin-demo/timer/settings.mjs` 中该 media 块。
- 更新 m10 / plugin-center / app-shell / plugin-demo README / 决策补充，写清 settings 布局合同与反例。

## Remaining

- 无（本轮文档 + 示例 CSS）。

## Key file changes

| File | Change |
|------|--------|
| `tools/plugin-demo/timer/settings.mjs` | 删除窄屏根 padding |
| `.agent/architecture/desktop-event-os/m10-external-plugins.md` | settings 布局合同 |
| `.agent/features/plugin-center/插件详情内容区外壳收归宿主-…` | 窄屏权威值 + 反例 |
| `tools/plugin-demo/README.md` | 外部 settings 布局一节 |
