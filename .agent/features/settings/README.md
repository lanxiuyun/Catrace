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

### 拖拽约束与回归验证

- 拖拽控制在 [settingsCardSorting.ts](../../../src/app/lib/settingsCardSorting.ts)。保留 Sortable 实时换位与 200ms 动画；fallback 副本挂到 body，不参与网格。不使用松手才换位的蓝框预览。
- 根因不仅是占位卡片的 `pointer-events: none`：不同高度卡片跨行移动时，CSS Grid 会重新计算整行高度，静止鼠标下的目标也随之变化，从而不断反向重排。真实设置页可复现 1→3、1→4；关闭动画也不能解决。只修点击穿透仅能缓解同一行的交换。
- `onMove` 只允许真实指针移动驱动插入；`onChange` 在实际插入后消费本次移动。距离上次换位不足 8 CSS px 时禁止再次换位，防止 fallback 定时命中检测在鼠标静止时继续重排。反向插入还要求真实反向手势或明显转弯，防止持续正向移动时因行高变化自动回跳。
- 用捕获阶段的 `pointermove` 跟踪真实手势转向；不能把“距上次换位位置的位移”当作当前移动方向，否则指针越过换位位置后回拖会被误判。不要同时注册 mousemove：其取整坐标与 pointermove 的小数坐标可能被误认为微小反向移动。8px 是手势防抖阈值，不是布局尺寸。
- 原占位卡片不设置点击穿透，浮动副本由 Sortable 自行设置。松手后先恢复拖动前 DOM 顺序，再让 React 按新顺序提交并保存，保留输入框及卡片实例；离页/松手清理指针监听。移出网格保留已经完成的换位，与原实时排序语义一致。
- Sortable 1.15 的 `destroy()` 调用无事件参数的 `_onDrop()`，会跳过 fallback 副本清理。销毁前捕获本实例的 `Sortable.ghost` / `Sortable.clone`，销毁后显式移除，避免拖动中离页残留浮动卡片。
- [settings-card-sorting.spec.ts](../../../e2e/settings-card-sorting.spec.ts) 连接运行中的设置页，16 个场景验证两列 1→3（顶部/中部）、1→4、4→1、左右、单列、三列、移出网格，以及换位后主动回拖/横向转弯、同页连续排序、拖动中离页再进入、点击手柄不拖动。断言松手前已换位、直线手势不反向、静止与 ±2px 抖动不新增换位、松手后保留顺序及 React 卡片实例。原贡献者报告全套重复两次共 32 项通过；浏览器环境未验证原生 Tauri Store 持久化，本次移植未重跑界面测试。
- 修复来自 [YHQY-Dev 的原提交 2f0fb91](https://github.com/YHQY-Dev/Catrace/commit/2f0fb916b42262d5b9c465616d5c91d481fbef7b)，对应 [PR #104](https://github.com/lanxiuyun/Catrace/pull/104)。

## 布局与控件约定

- 页面自己用 [PageScroll.tsx](../../../src/app/components/PageScroll.tsx) 承担滚动；主窗壳不加第二层纵向滚动条。
- 页面标题只保留给读屏，视觉上用侧栏选中项表明当前位置。
- 卡片是响应式网格，同一行等高；组名保持次级小字，不加装饰图标，右侧留给拖拽把手。
- 设置卡保留瓦片阴影；概览/调试是平铺报告面板，两种卡片角色分别由各自样式管理。
- 相邻设置行由 CSS 画分隔线，内容块使用 `.ct-settings-block` 接续分隔。文案列伸缩、控件列按内容定宽，避免控件挤压覆盖文字。
- 宿主设置控件统一用 HeroUI（`Button` / `Switch` / `Select` / `Input` / `TextArea` / `Slider` / `Chip`）；白色卡片里的输入框与下拉用 `variant="secondary"`，不要再覆写 HeroUI 的 `--field-*` token。链接卡是 HeroUI `Button variant="secondary"`，不再是自定义 `<button>`。
- 颜色用于状态与链接图标，卡片表面保持中性；尺寸统一 rem。

## 功能设置的归属

- **久坐提醒**：节奏、提醒内容、Toast/全屏方式、全屏背景和测试提醒由 [Plugins.tsx](../../../src/app/pages/Plugins.tsx) 与 [RestSettings.tsx](../../../src/app/pages/plugins/RestSettings.tsx) 管理，不进系统设置网格。
- **外部插件**：启用后的 React SettingsComponent 由 [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) 直接挂载，使用宿主共享 React 与 **Radix**（插件 UI 尚未迁移到 HeroUI）。安装与信任见[插件中心](../plugin-center/README.md)。
- **Event SDK**：管理面板挂在调试页，见 [Event SDK](../event-sdk/README.md)。

宿主主题、语言与 zustand 状态协作见 [React 前端架构](../../architecture/react-migration/README.md)。
