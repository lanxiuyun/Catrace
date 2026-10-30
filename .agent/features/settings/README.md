# 设置页

卡片式设置容器，支持拖拽排序。

## 涉及文件

- `src/app/pages/Settings.tsx` — 页面容器（React，网格 + Sortable 拖拽排序）
- `src/app/pages/settings/SettingRow.tsx` — 通用设置行
- `src/app/pages/settings/MediaSettingsCard.tsx` — 视频与音乐
- `src/app/pages/settings/SignalSettingsCard.tsx` — 行为采集
- `src/app/pages/settings/SystemSettingsCard.tsx` — 语言 / 主题 / 自启 / 静默 / 轻量 / 更新
- `src/app/pages/settings/SysNotifySettingsCard.tsx` — 系统通知转发
- `src/app/pages/settings/LinksSettingsCard.tsx` — 相关链接
- `src/app/pages/settings.css` — 卡片网格、设置行、拖拽把手样式
- `src/app/pages/Plugins.tsx` — 功能插件页（久坐提醒面板）
- `src/components/settings/SettingRow.vue`、`SliderControl.vue` — 仅剩给外部插件 UI 契约用（迁移期插件已停用）
- `src/components/AccessibilityBanner.vue` — 已无引用（macOS 不催授权，行与横幅都藏掉），待 M6 清理

## 卡片规范

- 响应式网格布局，右上角拖拽把手，高度撑满 Grid 行
- 拖拽用 SortableJS（`forceFallback`），`filter` 掉输入框、按钮、滑块、开关、下拉，避免在这些控件上按下时误拖
- 拖拽排序持久化（Tauri Store 的 `settings_group_order`）
- 间距统一 rem 单位
- MediaSettingsCard：排除列表 500ms 防抖自动保存，「重置为默认」按钮在标题右侧

## 系统设置 vs 功能插件

| 面 | 内容 |
|----|------|
| 系统设置 core | `media` / `signal` / `system` / `sysNotify` / `links`，五张卡都是 React 组件 |
| 功能插件 `rest` | 多久提醒、提醒文案、toast/fullscreen、测试通知（popup 下线），在功能插件页 |
| 调试页 | Event SDK（不进设置拖拽网格） |

**久坐提醒的展示方式与内容不在系统设置**，统一在功能插件页的久坐提醒面板（`src/app/pages/Plugins.tsx`）。

带 `SettingsComponent` 且 `settingsSurface === 'settings'` 的插件由 `usePluginRegistry().getSettingsPlugins('settings')` 动态挂载（迁移期外部插件已停用，见 [React 迁移方案](../../architecture/react-migration/README.md)）。

当前：
- 系统设置页暂无 registry 插件卡；5 张核心卡是写死的 React 组件（架构保留）
- `rest` → 功能插件页内嵌面板

注册入口：`src/plugins/registerBuiltins.ts`（React 主窗在 `src/app/bootstrap.ts` 里调用）。

## 子文档

- [设置页按-plugin-registry-挂载插件设置卡.md](设置页按-plugin-registry-挂载插件设置卡.md) — registry 挂载与 settingsSurface
- [久坐提醒配置从系统设置收敛到-RestPluginPanel.md](久坐提醒配置从系统设置收敛到-RestPluginPanel.md) — 久坐配置从系统设置迁出
