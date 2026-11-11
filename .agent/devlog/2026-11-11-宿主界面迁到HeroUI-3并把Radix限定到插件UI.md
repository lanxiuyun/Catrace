# 2026-11-11 宿主界面迁到 HeroUI 3，Radix 只留给插件 UI

## 会话目标

把桌面宿主的所有窗口 UI 从 Radix 控件迁到 HeroUI v3 + Tailwind 4，保留外部插件 UI 的 Radix 运行时；同时处理白色背景下的字段可读性、HeroUI 与 Catrace 同名 class 冲突，以及插件中心工具栏的交互细节。

## 完成项

- 接入 HeroUI v3 + Tailwind 4：`@heroui/styles` 样式入口、`@tailwindcss/vite`，Vite 配置与 `main.tsx` import 顺序落定。
- 宿主控件迁移：设置页、概览、调试、插件中心、插件设置、Toast 卡片、提醒弹窗 / 全屏提醒的 Button / Switch / Select / Input / TextArea / Slider / Chip / Alert / Tabs / AlertDialog 改为 HeroUI。
- 白色卡片上的 Input / TextArea / Select 统一 `variant="secondary"`，不覆写 `--field-*`；链接卡改用 HeroUI `Button variant="secondary"`。
- 概览页「概览 / 详细」改用 HeroUI `Tabs` 并压成紧凑尺寸；活动记录计数改用 `mergeRestBlocks` 后的时段数，文案改成「x 个时段」。
- 插件中心：安装/重试/卸载/清除按钮、启用 Switch、卸载 AlertDialog、市场 Tabs、工具栏 SearchField / 插件源按钮 / 目录与刷新按钮、刷新 Tooltip 全部换成 HeroUI。
- 概览与调试的开关文字收进 `Switch.Content`，使用 HeroUI 自带 label，移除外层原生 `label` / `aria-label`。
- 同步更新 `.agent` 架构与 feature 文档、AGENTS.md 的技术栈描述。

## 关键取舍与坑

- 不自己写输入框皮肤：白色卡片上的字段直接用 HeroUI 内置 `secondary`，比覆写 `--field-*` 更稳定，也避免和 `.light` 作用域打架。
- HeroUI 的 `.card` / `.badge` / `.header` / `.progress-bar` 是全局根类，和 Catrace 同名 class 撞车后会悄悄改 padding、高度、display；处理约定见[HeroUI组件全局类名和Catrace通用类名撞车的处理约定](../architecture/theme/HeroUI组件全局类名和Catrace通用类名撞车的处理约定.md)。
- Vite dev 在快速连续编辑 import + JSX 时出现过一次 HMR 中间态：页面报 `Button is not defined`，但 `pnpm build` 正常；重新触发该文件的 transform（改变 import 顺序）后恢复。遇到“build 过、dev 报未定义”先查 Vite transform 结果，不要只盯源码。
- 根 Radix `Theme` 暂时保留：宿主控件已经清零，但插件 UI 仍依赖注入的 Radix 主题；移除前要先在插件挂载处补独立 Theme。

## 待开发

- 移除 `main.tsx` / `RadixPage` 的根 `Theme`，在插件 UI 挂载处建立独立 Radix Theme；清理不再使用的 `.rt-*` 选择器和 `radix-theme.css` 中宿主侧规则。
- 插件中心的插件源弹层选项还是自定义 radio，可继续换 HeroUI `RadioGroup`。
- 外部插件 Card / Settings UI 仍走 Radix，属于第二阶段迁移。

## 关键文件变更

| 文件 | 变更 |
|---|---|
| `src/styles/heroui.css` | HeroUI 样式入口与主题约定 |
| `vite.config.ts`、`package.json` | Tailwind 4 / HeroUI 依赖与插件 |
| `src/app/main.tsx` | 引入 HeroUI 样式；根 Theme 保留为插件边界 |
| `src/app/pages/settings/*` | 设置卡控件与链接卡迁移 |
| `src/app/pages/Dashboard.tsx`、`dashboard.css` | Tabs、Switch 自带 label、计数修正、紧凑尺寸 |
| `src/app/pages/Debug.tsx`、`debug.css` | 调试页控件与开关 label |
| `src/app/pages/plugins/PluginCenter.tsx`、`PluginSourceSettings.tsx`、`plugins.css` | 插件中心控件、Tabs、工具栏、AlertDialog、Tooltip |
| `src/app/windows/*`、`src/components/*ToastCard*` | 提醒窗与 Toast 控件迁移 |
| `.agent/architecture/*`、`.agent/features/*`、`AGENTS.md` | 技术栈与控件规范同步 |
