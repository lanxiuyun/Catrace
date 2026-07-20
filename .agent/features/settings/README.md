# 设置页

卡片式设置容器，支持拖拽排序。

## 涉及文件

- `src/views/Settings.vue` — 页面容器
- `src/components/settings/SettingRow.vue` — 通用设置行
- `src/components/settings/SliderControl.vue` — 滑块+数值
- `src/components/settings/ReminderSettingsCard.vue` — 提醒偏好
- `src/components/settings/MediaSettingsCard.vue` — 视频与音乐
- `src/components/settings/SystemSettingsCard.vue` — 语言/自启/更新
- `src/components/settings/NotificationSettingsCard.vue` — 模式/全屏背景/文案/测试
- `src/components/settings/LinksSettingsCard.vue` — 相关链接
- `src/components/settings/WaterSettingsCard.vue` — 喝水提醒（UI 延后，`settingsSurface: none`）
- `src/components/settings/EyeSettingsCard.vue` — 护眼提醒（同上）
- `src/components/settings/AgentSettingsCard.vue` — Agent 旧设置卡壳（逻辑已迁 `AgentPluginPanel`）
- `src/components/plugins/AgentPluginPanel.vue` — Agent 功能插件详情
- `src/components/plugins/RestPluginPanel.vue` — 久坐功能插件详情

## 卡片规范

- 响应式网格布局，右上角拖拽把手，高度撑满 Grid 行
- 拖拽排序持久化（Tauri Store 插件保存顺序）
- 仅「提醒偏好」左侧文字固定 13rem，其余自适应
- 间距统一 rem 单位
- MediaSettingsCard：排除列表 500ms 防抖自动保存，「重置为默认」按钮在标题右侧

## 插件设置卡（registry）

系统设置页核心卡（notification/media/signal/system/links）仍本地声明。

**Event SDK 管理卡不在设置页**，在调试页（`Debug.vue` + `EventSdkSettingsCard.vue`），避免与产品配置拖拽网格混放。

带 `SettingsComponent` 且 `settingsSurface === 'settings'` 的插件由 `usePluginRegistry().getSettingsPlugins('settings')` 动态挂载，并入拖拽排序键 `settings_group_order`。

当前：
- `rest` / `agent` → `settingsSurface: plugins`（功能插件页详情）
- `water` / `eye` → `settingsSurface: none`（后端强制关，UI 延后）
- 系统设置页暂无 registry 插件卡（架构保留）

注册入口：`src/plugins/registerBuiltins.ts`（主窗 `main.ts` mount 前调用）。
