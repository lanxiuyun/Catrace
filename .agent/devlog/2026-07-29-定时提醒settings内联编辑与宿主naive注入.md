# 2026-07-29 定时提醒 settings 内联编辑与宿主 naive 注入

## Session goal

把定时提醒插件设置页对齐系统设置观感；解决弹窗/样式问题；护眼示例规则产品化。

## Completed

- 宿主注入 `__CATRACE_NAIVE__` / `__CATRACE_UI__`（`pluginRuntime.ts`）
- timer settings 改用 naive 组件 + 系统色板
- **放弃 NModal**：卡片内联新建/编辑；关闭规则折叠 content
- 紧凑 4 行编辑器；定点用时/分输入
- 护眼：固定标题/模式/休息重置；**间隔可改**；始终一条
- 列表排序：启用 → 间隔/定点 → 分钟或最早定点
- 删除二次确认；去掉全局测试按钮
- 去掉 `mode=active` 旧兼容

## Pending

- 多 tag 视觉区分度仍可再加强
- Step3 runtime 路线图其它项

## Key file changes

| File | Change |
|------|--------|
| `src/plugins/pluginRuntime.ts` | 新建：注入 Vue/naive/UI globals |
| `src/plugins/loadExternalPlugins.ts` | 改用 `ensurePluginRuntime` |
| `src/components/PluginHostCard.vue` | 同上 |
| `src/vite-env.d.ts` | global 类型 |
| `tools/plugin-demo/timer/settings.mjs` | 内联编辑 + 排序 + 护眼锁定 |
| `tools/plugin-demo/timer/background.mjs` | 去掉 active legacy |
| `.agent/architecture/.../m10-external-plugins.md` | naive 注入 + teleport 陷阱 |
