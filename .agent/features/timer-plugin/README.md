# 定时提醒插件（timer）

第一方外部插件：自定义间隔 / 每日定点提醒，配置与调度全在插件包内；护眼是其中一条固定示例规则。

## 一句话

插件中心 → 定时提醒：多规则列表 + 卡片内联编辑；后台分钟对齐调度，经 Event Bus 出 Toast。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/timer/manifest.json` | id=`timer`，settings/background/ui |
| `tools/plugin-demo/timer/settings.mjs` | 规则列表 UI、内联编辑、排序、护眼示例锁定 |
| `tools/plugin-demo/timer/background.mjs` | 调度、休息重置、action 副作用 |
| `tools/plugin-demo/timer/ui.mjs` | Toast 卡 |
| `src/plugins/pluginRuntime.ts` | 宿主注入 `__CATRACE_VUE__` / `__CATRACE_NAIVE__` / `__CATRACE_UI__` |
| `src/plugins/loadExternalPlugins.ts` | Blob 加载 settings/ui |
| `src-tauri/src/plugin_commands.rs` | `plugin_get_last_real_rest` 等 |

Debug 构建 junction：`tools/plugin-demo/timer` → `app_data/plugins/timer`。

## 子文档

- [定时提醒-settings内联编辑与规则排序约定.md](定时提醒-settings内联编辑与规则排序约定.md) — 列表/编辑/排序/护眼锁定
- [外部插件如何使用宿主注入的-naive-ui.md](外部插件如何使用宿主注入的-naive-ui.md) — runtime globals 与 teleport 陷阱

## 相关

- [[eye-reminder]] — 护眼作为 timer 预设的产品说明与调度语义
- [[plugin-center]] — 详情外壳与顶栏开关
- [[m10-external-plugins]] — 外部插件加载合同
- [[toast-window]] — `payload.auto_hide_ms` / sticky
- [[reminder]] — 久坐 `break_minutes` 供真休息判定
