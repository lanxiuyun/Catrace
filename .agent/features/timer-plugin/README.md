# 定时提醒插件（timer）

第一方外部插件：自定义间隔 / 每日定点提醒，配置与调度全在插件包内；护眼是其中一条固定示例规则。

## 一句话

插件中心 → 定时提醒：多规则列表 + 卡片内联编辑；后台分钟对齐调度，经 Event Bus 出 Toast。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/timer/manifest.json` | id=`timer`，settings/background/ui |
| `tools/plugin-demo/timer/settings.mjs` | 规则列表 UI；经注入 `plugin` facade 调 config/events/setEnabled |
| `tools/plugin-demo/timer/background.mjs` | 调度、休息重置、action 副作用；经 `plugin` facade |
| `tools/plugin-demo/timer/ui.mjs` | Toast 卡（纯 Vue render；颜色来自 payload） |
| `tools/plugin-demo/timer/assets/notify.wav` | 默认提示音 |
| `src/plugins/pluginApi.ts` | Rubick 风格 `plugin` facade + `wrapPluginSource` |
| `src/plugins/pluginRuntime.ts` | 宿主注入 Vue/naive/UI + `__CATRACE_CREATE_PLUGIN_API__` |
| `src/plugins/loadExternalPlugins.ts` | Blob 加载 settings/ui，注入 `plugin` |
| `src-tauri/src/plugin_api/` | 通用宿主 API（event / activity / audio / getPluginDir） |

Debug 构建 junction：`tools/plugin-demo/timer` → `app_data/plugins/timer`。

## 子文档

- [定时提醒-settings内联编辑与规则排序约定.md](定时提醒-settings内联编辑与规则排序约定.md) — 列表/编辑/排序/护眼锁定
- [定时提醒-toast颜色与提示音规则字段.md](定时提醒-toast颜色与提示音规则字段.md) — accent / 默认 wav / plugin.audio
- [外部插件如何使用宿主注入的-naive-ui.md](外部插件如何使用宿主注入的-naive-ui.md) — runtime globals 与 teleport 陷阱

## 相关

- [[eye-reminder]] — 护眼作为 timer 预设的产品说明与调度语义
- [[plugin-center]] — 详情外壳与顶栏开关
- [[m10-external-plugins]] — 外部插件加载合同
- [[toast-window]] — `payload.auto_hide_ms` / sticky
- [[reminder]] — 久坐 `break_minutes` 供真休息判定
