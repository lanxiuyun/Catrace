# 设置页

系统设置是 React 卡片网格，支持拖拽排序。插件业务配置在功能插件页，Event SDK 管理在调试页。

## 核心卡与入口

[Settings.tsx](../../../src/app/pages/Settings.tsx) 通过固定映射挂载五张核心卡，不从 plugin registry 动态挂载设置卡。

| 键 | 内容与组件 |
|----|------------|
| `media` | 视频与音乐检测、排除列表：[MediaSettingsCard.tsx](../../../src/app/pages/settings/MediaSettingsCard.tsx) |
| `signal` | 行为采集：[SignalSettingsCard.tsx](../../../src/app/pages/settings/SignalSettingsCard.tsx) |
| `system` | 语言、主题、自启、静默、轻量、更新：[SystemSettingsCard.tsx](../../../src/app/pages/settings/SystemSettingsCard.tsx) |
| `sysNotify` | 系统通知转发：[SysNotifySettingsCard.tsx](../../../src/app/pages/settings/SysNotifySettingsCard.tsx) |
| `links` | 项目链接、问题反馈、日志目录：[LinksSettingsCard.tsx](../../../src/app/pages/settings/LinksSettingsCard.tsx) |

通用卡片与设置行是 [SettingsCard.tsx](../../../src/app/pages/settings/SettingsCard.tsx)、[SettingRow.tsx](../../../src/app/pages/settings/SettingRow.tsx)；布局在 [settings.css](../../../src/app/pages/settings.css)。

## 排序与保存

- SortableJS 用拖拽把手启动拖动，启用 `forceFallback`；输入框、按钮、滑块、开关和下拉控件不触发拖拽。
- 顺序写入 Tauri Store 的 `settings_group_order`，Store 由 [settingsStore.ts](../../../src/app/lib/settingsStore.ts) 提供。读取时去重、移除未知键，并补齐缺少的核心卡。
- 修改卡片集合时同步核心键与组件映射；保持排序归一化逻辑覆盖所有核心卡。
- 媒体排除列表 500ms 防抖自动保存，「重置为默认」放在列表标题右侧。
- 自动保存与开关切换以控件状态反馈成功；失败时才弹错误提示。共用自动保存逻辑见 [useAutoSaveSetting.ts](../../../src/app/pages/settings/useAutoSaveSetting.ts)。

## 布局与控件约定

- 页面自己用 [PageScroll.tsx](../../../src/app/components/PageScroll.tsx) 承担滚动；主窗壳不加第二层纵向滚动条。
- 页面标题只保留给读屏，视觉上用侧栏选中项表明当前位置。
- 卡片是响应式网格，同一行等高；组名保持次级小字，不加装饰图标，右侧留给拖拽把手。
- 设置卡保留瓦片阴影；概览/调试是平铺报告面板，两种卡片角色分别由各自样式管理。
- 相邻设置行由 CSS 画分隔线，内容块使用 `.ct-settings-block` 接续分隔。文案列伸缩、控件列按内容定宽，避免控件挤压覆盖文字。
- Radix 控件的 hover、光标和主题映射统一放在 [radix-theme.css](../../../src/app/radix-theme.css)，页面只定义自己的布局。
- 颜色用于状态与链接图标，卡片表面保持中性；尺寸统一 rem。

## 功能设置的归属

- **久坐提醒**：节奏、提醒内容、Toast/全屏方式、全屏背景和测试提醒由 [Plugins.tsx](../../../src/app/pages/Plugins.tsx) 与 [RestSettings.tsx](../../../src/app/pages/plugins/RestSettings.tsx) 管理，不进系统设置网格。
- **外部插件**：在插件中心的详情中配置，启用后的 Vue 设置组件经 [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) → [VueIsland.tsx](../../../src/app/legacy/VueIsland.tsx) 挂载。安装后由用户授权启用，安装、授权和开关见 [插件中心](../plugin-center/README.md)。
- **Vue 插件公共控件**：[SettingRow.vue](../../../src/components/settings/SettingRow.vue)、[SliderControl.vue](../../../src/components/settings/SliderControl.vue) 属于外部插件 UI 注入契约，不是系统设置卡。
- **Event SDK**：管理面板挂在调试页，见 [Event SDK](../event-sdk/README.md)。

宿主主题、语言与 React/Vue 运行时协作见 [React 前端架构](../../architecture/react-migration/README.md)。
