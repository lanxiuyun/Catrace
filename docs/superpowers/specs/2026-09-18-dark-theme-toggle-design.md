# 暗色主题 + 亮/暗切换 — 设计文档

> 日期：2026-09-18
> 状态：设计已确认，待写实现计划

## 目标

为 Catrace 增加一套「深灰 + 保留紫色点缀」的暗色主题，并支持亮/暗切换。切换覆盖**全部窗口**（主窗口 + 所有 toast / 提醒窗口），偏好支持「跟随系统 / 强制亮 / 强制暗」三选，默认跟随系统。

## 背景与现状

- `src/theme.ts` 目前只有一套硬编码的薰衣草紫**亮色**主题，喂给 naive-ui 的 `themeOverrides`。
- 全项目颜色消费现状（截至设计时）：
  - `<style>` 块里裸 hex：**388 处**，分布在 **31 个 `.vue` 文件**
  - 已用 CSS 变量 `var(--...)`：34 处
  - `colors.xxx`（theme.ts 导出）在组件中被 JS 引用：0 处（只在 theme.ts 内部用）
  - 去重后不同颜色值：**113 种**，头部约 30 种覆盖绝大多数用量
- 多窗口架构：主窗口与各 toast 是**独立 webview**，DOM / 运行时状态不共享。
- 现有跨窗口同步模式：`app.emit` 广播 + 前端 `listen`（如 `catrace-agent-sound-changed`、`catrace-toast-debug-changed`）。
- 现有配置持久化：locale 走 SQLite；按 CLAUDE.md 规则 5，非业务核心的前端配置应走 `@tauri-apps/plugin-store`。

## 决策摘要

| 维度 | 决策 |
|------|------|
| 调性 | 深灰背景（如 `#1a1a1e`）+ 保留紫色强调，暗底上紫色提亮 |
| 切换模型 | 跟随系统 / 强制亮 / 强制暗，三选，默认跟随系统 |
| 覆盖范围 | 全部窗口（主窗口 + 所有 toast / 提醒窗口） |
| 迁移节奏 | 一次做完全部 388 处迁移 |
| 持久化 | `@tauri-apps/plugin-store`（符合规则 5） |
| 方案 | 语义 CSS 变量层 + naive-ui 自带 darkTheme 双管齐下 |

### 被否决的方案

- **方案 B（每组件写两套 `<style>` / 双 class）**：31 个文件维护两倍样式，加色要改两处，最易漏。否决。
- **方案 C（全删自定义样式，纯靠 naive-ui CSS-in-JS）**：toast 卡片有大量自定义渐变/阴影/圆角是产品视觉核心，删不掉。改造过重。否决。

## 架构

```
token 层 (theme.css)  ← 颜色单一真源，:root(亮) / [data-theme=dark](暗) 两套值
      ↑ var(--ct-*)
组件 <style>          ← 388 处裸 hex 迁移为 var(--ct-*)
      ↑
useTheme composable   ← 状态(three-mode) + 解析(system→matchMedia)
                         + 持久化(plugin-store) + 落地(<html data-theme>)
                         + 暴露 naive-ui theme/overrides
      ↓ emit / listen 'catrace-theme-changed'
所有 webview          ← 各自 useTheme,启动读初值防闪白,收广播同步
```

## 组件设计

### 1. Token 层 — `src/styles/theme.css`（新建，全局引入）

约 28 个语义 token，`:root`（亮）与 `[data-theme="dark"]`（暗）各一套值。分组：

- **强调**：`--ct-accent`、`--ct-accent-hover`、`--ct-accent-soft`、`--ct-accent-softer`
- **表面/背景**：`--ct-bg`、`--ct-surface`、`--ct-surface-2`、`--ct-border`
- **文本**：`--ct-text`、`--ct-text-muted`、`--ct-text-subtle`
- **状态**：`--ct-success`、`--ct-warning`、`--ct-error` 及各自 `-soft` 变体
- **中性石板灰**：`--ct-slate-1..4`（通用 UI 灰阶）

亮色值沿用现有色板（`--ct-accent: #7c3aed`、`--ct-text: #2e1065`、`--ct-bg: #f7f5fa` 等）。

暗色取值原则（**不是简单反色**）：
- 背景走深灰：`--ct-bg: #1a1a1e`、`--ct-surface: #232329`、`--ct-surface-2: #2a2a31`、`--ct-border: #35353d`
- 紫色强调**提亮**保证对比度：`--ct-accent: #a78bfa`
- 文本反相并降饱和：`--ct-text: #ececf0`、`--ct-text-muted: #a1a1aa`
- 状态色在暗底提亮；`*-soft` 浅底色改为深色调或低透明度叠加，避免刺眼

113 种原色归并到这 28 个 token，近似色收敛（多种浅紫背景 → 同一 token），顺带统一原本零散的视觉。

### 2. 状态管理 — `src/composables/useTheme.ts`（新建）

```ts
type ThemeMode = 'system' | 'light' | 'dark'   // 用户偏好
type Resolved  = 'light' | 'dark'              // 实际生效
```

应用级单例（模块内 `ref`），职责：

- **读写偏好**：`plugin-store`，key `theme.mode`
- **解析生效值**：`mode === 'system'` 时读 `window.matchMedia('(prefers-color-scheme: dark)')`，并监听其 `change` 事件自动跟随系统
- **落地 DOM**：写 `<html data-theme="dark|light">`，CSS 变量层即时响应
- **暴露 naive-ui**：导出 `naiveTheme` computed（`darkTheme | null`）+ 对应 `themeOverrides`（亮/暗两套），供 `NConfigProvider` 绑定
- **API**：`setMode(mode)`、`mode`（ref）、`resolved`（computed）、`naiveTheme`、`naiveOverrides`

### 3. naive-ui 集成 — `src/theme.ts`（改造）+ `src/App.vue`

- `theme.ts` 拆出亮/暗两套 `GlobalThemeOverrides`（暗色 overrides 与 CSS token 对齐）
- `App.vue` 的 `NConfigProvider` 绑定 `:theme="naiveTheme"` `:theme-overrides="naiveOverrides"`
- `App.vue` `<style>` 里 `html/body/#app` 的硬编码背景 `#f8fafc` 改为 `var(--ct-bg)`

### 4. 设置入口 — `src/components/settings/SystemSettingsCard.vue`（改造）

在系统设置卡内加一个三选控件（跟随系统 / 亮 / 暗），沿用现有 `SettingRow` + naive-ui 控件风格，`change` 时调 `useTheme().setMode(...)`。

### 5. 多窗口同步

- **写方**（设置页切主题）：`setMode()` 存 store 后 `emit('catrace-theme-changed', { mode })` 广播
- **读方**（所有窗口，含主窗口）：`useTheme` 初始化时先从 store 同步读初值并落地 `data-theme`（**挂载前**，防 FOUC 闪白），再 `listen('catrace-theme-changed')`，收到重新解析并更新 `data-theme` + naive-ui provider
- **`system` 模式下系统切换**：每个窗口各自监听 `matchMedia` 自跟随，无需广播；广播仅用于用户手动改偏好

沿用现有事件广播模式，不引入新机制。

## 数据流

1. 用户在设置页选「暗」→ `setMode('dark')`
2. `useTheme` 写 store `theme.mode=dark` → 解析 resolved=dark → 设 `<html data-theme=dark>` → naive provider 切 darkTheme
3. `emit('catrace-theme-changed', {mode:'dark'})`
4. 各 toast webview 的 listener 收到 → 各自重新解析并更新自身 `data-theme` + provider
5. CSS token 层即时重算，所有 `var(--ct-*)` 生效

## 迁移策略（388 处裸 hex）

1. **建映射表**：113 原色 → 28 token 的人工映射（质量关键，近似色收敛）
2. **按文件迁移**：逐个 `.vue` 的 `<style>` 把 hex 换成 `var(--ct-*)`
   - 渐变两端都用变量（暗色下自动成为提亮渐变）
   - 半透明色（`rgba(...)`）用 `color-mix(in srgb, var(--ct-accent) 60%, transparent)` 或单独 token，逐个判断
   - naive-ui 组件内部色不在这 388 处，由 `themeOverrides` 管
3. **遵守规则 10**：精确编辑保原字节，禁整文件重写；每文件改完 `git diff --numstat` 核对无意外「全文修改」

## 错误处理与边界

- **plugin-store 读失败**：回退到 `system` 默认，不阻塞启动
- **matchMedia 不可用**（极老 webview）：回退到 `light`
- **新开 toast 窗口**：初始化同步读 store，挂载前落地主题，杜绝先闪亮色
- **广播失败**：不阻塞本窗口切换（本窗口已直接更新）；其余窗口下次打开时从 store 读到正确值

## 验证

- `pnpm vue-tsc --noEmit` 通过
- `pnpm build` 通过
- 迁移后全局搜 `#[0-9a-f]{6}`：除 `theme.css` 本身与个别有意保留项外应清零
- 前端视觉验证：**除非用户明确要求**，不主动连 Playwright（规则 8）；需要时连已运行的 `pnpm tauri dev`（`http://localhost:1420`）逐窗口切亮/暗核对

## 不做（YAGNI）

- 不做多套自定义主题 / 主题市场，只做亮 + 暗两套
- 不做单窗口独立主题，全应用统一
- 不把主题偏好进 SQLite（走 plugin-store）
- 不重构与主题无关的样式
