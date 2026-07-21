# 设置页

卡片式设置容器，支持拖拽排序。

## 涉及文件

- `src/views/Settings.vue` — 页面容器
- `src/components/settings/SettingRow.vue` — 通用设置行
- `src/components/settings/SliderControl.vue` — 滑块+数值
- `src/components/settings/MediaSettingsCard.vue` — 视频与音乐
- `src/components/settings/SystemSettingsCard.vue` — 语言/自启/更新
- `src/components/settings/SignalSettingsCard.vue` — 行为采集
- `src/components/settings/LinksSettingsCard.vue` — 相关链接
- `src/components/settings/WaterSettingsCard.vue` — 喝水提醒（UI 延后；`settingsSurface: none`）
- `src/components/settings/EyeSettingsCard.vue` — 护眼提醒（同上）
- `src/components/settings/AgentSettingsCard.vue` — Agent 旧设置卡壳（逻辑已迁 `AgentPluginPanel`）
- `src/components/plugins/AgentPluginPanel.vue` — Agent 功能插件详情
- `src/components/plugins/RestPluginPanel.vue` — 久坐功能插件详情（节奏 / 内容 / 测试；当前仅 toast）

## 卡片规范

- 响应式网格布局，右上角拖拽把手，高度撑满 Grid 行
- 拖拽排序持久化（Tauri Store 插件保存顺序）
- 间距统一 rem 单位
- MediaSettingsCard：排除列表 500ms 防抖自动保存，「重置为默认」按钮在标题右侧

## 系统设置 vs 功能插件

| 面 | 内容 |
|----|------|
| 系统设置 core | `media` / `signal` / `system` / `links` |
| 功能插件 `rest` | 多久提醒、提醒文案、测试通知（**当前仅 toast**；fullscreen 暂不提供 UI） |
| 功能插件 `agent` | Hook / 事件模式 / 提示音 |
| 调试页 | Event SDK（不进设置拖拽网格） |

**久坐提醒的展示方式与内容不在系统设置**，统一在 `RestPluginPanel`。

带 `SettingsComponent` 且 `settingsSurface === 'settings'` 的插件由 `usePluginRegistry().getSettingsPlugins('settings')` 动态挂载。

当前：
- `rest` / `agent` → `settingsSurface: plugins`
- `water` / `eye` → `settingsSurface: none`
- 系统设置页暂无 registry 插件卡（架构保留）

注册入口：`src/plugins/registerBuiltins.ts`（主窗 `main.ts` mount 前调用）。

## 子文档

- [设置页按-plugin-registry-挂载插件设置卡.md](设置页按-plugin-registry-挂载插件设置卡.md) — registry 挂载与 settingsSurface
- [久坐提醒配置从系统设置收敛到-RestPluginPanel.md](久坐提醒配置从系统设置收敛到-RestPluginPanel.md) — 久坐配置从系统设置迁出
