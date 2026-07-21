# 久坐提醒配置从系统设置收敛到 RestPluginPanel

## 一句话

「多久提醒、提醒什么、以什么方式提醒」只在功能插件 `RestPluginPanel` 配置；系统设置不再挂通知卡。

## UI 入口

| 入口 | 组件 | 内容 |
|------|------|------|
| 功能插件 → 久坐 | `src/components/plugins/RestPluginPanel.vue` | 节奏 / 方式 / 文案 / 全屏 / 测试 |
| 系统设置 | `src/views/Settings.vue` | 仅 media / signal / system / links |

## RestPluginPanel 区块

1. **节奏** — `window_minutes` / `break_minutes` / `snooze_interval_minutes`
2. **内容** — `reminder_title` / `reminder_body`
3. **测试** — `testNotification`；测试按钮位于提醒内容卡片外部，不渲染通知预览

> 2026-07-21：当前版本久坐插件**仅支持 toast 通知提醒**。UI 不再提供模式选择/全屏配置；
> 后端 `show_notification` 固定走 Event Bus toast；`get/set_reminder_mode` 将非 toast 钳制为 toast。
> 全屏/popup 窗口基础设施仍保留，待后续重新接入。

插件 UI 开关仍用前端 Store：`plugin_rest_ui_enabled`（非业务核心，不进 SQLite）。

## 代码变更

| 文件 | 变更 |
|------|------|
| `src/components/plugins/RestPluginPanel.vue` | 承接原通知卡能力 |
| `src/views/Settings.vue` | core 去掉 `notification` |
| `src/components/settings/NotificationSettingsCard.vue` | 删除 |
| `src/i18n/locales/zh-CN.ts` / `en-US.ts` | `plugins.rest.*` 文案；设置副标题 |
| `src/plugins/registerBuiltins.ts` | `rest` 仍 `settingsSurface: 'plugins'` |

## 后端

**不改键名**，避免迁移：

- `get_config` / `set_config`
- `get_reminder_mode` / `set_reminder_mode`
- `get_reminder_text` / `set_reminder_text`
- fullscreen settings API

## 与媒体卡关系

`MediaSettingsCard` 留在系统设置：播放/排除列表是宿主能力，全屏休息会用到，但不是 rest 插件私有配置。

## 相关决策

- [[decisions]] `2026-07-21-久坐提醒配置归功能插件不进系统设置.md`
- 设置挂载约定： [设置页按-plugin-registry-挂载插件设置卡.md](设置页按-plugin-registry-挂载插件设置卡.md)
