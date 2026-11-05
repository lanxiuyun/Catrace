# 设置页

卡片式设置容器，支持拖拽排序。

## 涉及文件

- `src/app/pages/Settings.tsx` — 页面容器（React，网格 + Sortable 拖拽排序）
- `src/app/pages/settings/SettingsCard.tsx` — 卡片外壳（组名 + 内容，不带图标）
- `src/app/pages/settings/SettingRow.tsx` — 通用设置行
- `src/app/pages/settings/MediaSettingsCard.tsx` — 视频与音乐
- `src/app/pages/settings/SignalSettingsCard.tsx` — 行为采集
- `src/app/pages/settings/SystemSettingsCard.tsx` — 语言 / 主题 / 自启 / 静默 / 轻量 / 更新
- `src/app/pages/settings/SysNotifySettingsCard.tsx` — 系统通知转发
- `src/app/pages/settings/LinksSettingsCard.tsx` — 相关链接
- `src/app/pages/settings.css` — 卡片网格、设置行、拖拽把手样式
- `src/app/radix-theme.css` — Radix token 映射 + **控件悬停/光标补充**（全 React 页共用，见下）
- `src/app/pages/Plugins.tsx` — 功能插件页（久坐提醒面板）
- `src/components/settings/SettingRow.vue`、`SliderControl.vue` — 仅剩给外部插件 UI 契约用（迁移期插件已停用）
- `src/components/AccessibilityBanner.vue` — 已无引用（macOS 不催授权，行与横幅都藏掉），待 M6 清理

## 卡片规范

- 响应式网格布局，右上角拖拽把手，高度撑满 Grid 行
- 拖拽用 SortableJS（`forceFallback`），`filter` 掉输入框、按钮、滑块、开关、下拉，避免在这些控件上按下时误拖
- 拖拽排序持久化（Tauri Store 的 `settings_group_order`）
- 间距统一 rem 单位
- MediaSettingsCard：排除列表 500ms 防抖自动保存，「重置为默认」按钮在标题右侧
- 自动保存与开关切换**不弹成功提示**：控件自身状态就是反馈，只有保存失败才弹错误 toast（`settings.messages.saveFailed` / `setFailed`）。`settings.messages.saved` 文案键已删除，不要再加回来

## 视觉约定（与概览页同一套语言）

- **页面**：标题 1.75rem/700（`letter-spacing: -0.025em`）+ 0.9375rem 副标题；内容区 `max-width: 76rem` 居中，padding `1.5rem 1.75rem 2.5rem`
- **卡片**：白色表面 + `--ct-border-card` 细边 + `--ct-shadow-card` 双层阴影，圆角 1.125rem，内边距 `1.125rem 1.25rem 1rem`；多列网格 `repeat(auto-fit, minmax(22rem, 1fr))`，宽度够就并排。**同一行卡片等高**（`height: 100%`）——内容少的卡底部留白是刻意取舍，不要再改成 `align-items: start`（会高低错位），也别改回单列（宽窗口浪费宽度）
- **卡片头**：只有 12px 组名（次级色），由 `SettingsCard` 统一渲染；右侧留 2rem 给拖拽把手。不要再往卡片头加图标块——设置页要安静，图标只会变成装饰
- **和概览 / 调试页的分工**：概览、调试是**全宽报告面板**——卡头是面板标题 1.125rem/650/`-0.015em`、圆角 1.25rem、内边距 1.25rem、内容列宽 76rem（`dashboard.css` / `debug.css`），**平铺不投阴影**（阴影表达高度，只留给浮起的表面；宽面板投影会在 1rem 卡间距里连成一条灰带，像第二层卡）；设置是**网格瓦片**——12px 次级色组名、圆角 1.125rem、内边距 `1.125rem 1.25rem 1rem`，保留卡片阴影（瓦片小，阴影被相邻卡打断，不会连成灰带）。两种角色别互相抄：瓦片不要放大标题去抢拖拽把手的位置，报告面板也别缩成 12px 组名（调试页曾写成 1rem 的中间值，两边都不属于）
- **设置行**：`padding: 0.75rem 0`；相邻行之间的 `--ct-border` hairline 由 CSS 自动画（`.ct-setting-row + .ct-setting-row`），从行切到内容块（白名单、更新详情）时给块加 `.ct-settings-block` 让块自带上边线——**不要再手插 `<div class="ct-settings-divider" />`**，手摆的线多一行就漏一条（语言/主题之间就漏过一条）。文案列 `flex: 1 1 auto`、控件列 `flex: 0 0 auto`——控件列一旦参与伸缩，会被压得比下拉框还窄，下拉框从左边溢出盖住描述文字
- **链接行**：hover 抬升 1px + 切到白底 + 卡片阴影；`:focus-visible` 是 2px 系统蓝 outline
- **控件悬停**：设置行里的按钮 / 下拉 / 开关 / 输入框是 Radix 原生控件，Radix 自带的 hover 只有约 3% 的透明黑变化，TextField / TextArea / Switch 根本没有 hover 状态，而且全部包在 `@media (hover: hover)` 里、光标沿用 macOS 的默认箭头——所以看起来「没有悬停反馈」。悬停补充统一写在 `src/app/radix-theme.css`（soft 按钮加深底色、描边控件加深内描边、开关加淡光晕、光标改 `pointer`，门控用 `any-hover`），属于设计系统级规则；**不要在页面 CSS 里逐个控件重写 hover**，也不要给单个页面单独加
- 颜色只给状态与图标（`ct-link-icon.is-info/is-warning/is-accent`），卡片本身保持中性

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
