# 暗色主题 + 亮/暗切换 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Catrace 增加「深灰 + 保留紫色点缀」的暗色主题，支持「跟随系统 / 强制亮 / 强制暗」三选切换，覆盖全部窗口。

**Architecture:** 语义 CSS 变量层作颜色单一真源（`:root` 亮 / `[data-theme=dark]` 暗两套值）；`useTheme` composable 管状态、持久化（plugin-store）、系统跟随、DOM 落地与跨窗口广播；naive-ui 用自带 `darkTheme` + 两套 overrides；388 处组件裸 hex 迁移为 `var(--ct-*)`。

**Tech Stack:** Vue 3 + TypeScript + naive-ui 2.44 + Tauri 2 + `@tauri-apps/plugin-store` 2.4 + `@tauri-apps/api/event`。

**Spec:** `docs/superpowers/specs/2026-09-18-dark-theme-toggle-design.md`

## Global Constraints

- 前端尺寸用 rem（`1rem = 16px`），例外：1px 边框、blur、SVG viewBox（规则 4）
- 简单配置走 `@tauri-apps/plugin-store`，不进 SQLite（规则 5）
- 批量改源码必须保原文件字节：用精确编辑，禁 `write_text` / 整文件 decode→encode 重写；每文件改完 `git diff --numstat` 核对无意外「全文修改」（规则 10）
- 前端验证：除非用户明确要求，不主动连 Playwright（规则 8）
- 不自动启动 dev server；验证跑 `pnpm vue-tsc --noEmit` / `pnpm build`（规则 3）
- 回复用中文
- **测试说明**：本项目无单测框架（无 vitest/@vue/test-utils）。为一个 CSS-token 主题特性引入单测框架属过度投入。因此每个任务的「测试关」落到项目实际验证手段：`pnpm vue-tsc --noEmit`（类型关）、`pnpm build`（构建关）、`grep` 断言（迁移完整性关）。这是对 TDD 步骤的务实调整。

---

## 文件结构

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/styles/theme.css` | 颜色单一真源：约 34 个语义 token，亮/暗两套值 | 新建 |
| `src/composables/useTheme.ts` | 主题状态 + 持久化 + 系统跟随 + DOM 落地 + 跨窗口同步 + naive-ui theme/overrides | 新建 |
| `src/theme.ts` | 拆出亮/暗两套 naive-ui `GlobalThemeOverrides` | 改造 |
| `src/main.ts` | 引入 `theme.css`；挂载前初始化 `useTheme`（防 FOUC） | 改造 |
| `src/App.vue` | `NConfigProvider` 绑定 `naiveTheme`/`naiveOverrides`；`html/body/#app` 背景用 token | 改造 |
| `src/components/settings/SystemSettingsCard.vue` | 加三选主题控件 | 改造 |
| `src/i18n/locales/zh-CN.ts` `en-US.ts` | 主题设置文案 | 改造 |
| 31 个 `.vue`（含上面若干） | 388 处裸 hex → `var(--ct-*)` | 改造 |

---

## Token 命名与取值（贯穿全计划，各迁移任务据此映射）

**token 集合（34 个）**，`--ct-` 前缀（Catrace）。下表即映射表，各迁移任务把原色按此替换。近似色收敛到同一 token。

### 强调（紫）
| token | 亮色 | 暗色 | 收敛的原色 |
|-------|------|------|-----------|
| `--ct-accent` | `#7c3aed` | `#a78bfa` | `#7c3aed` `#8b5cf6` `#6366f1` |
| `--ct-accent-hover` | `#6d28d9` | `#8b5cf6` | `#6d28d9` `#5b21b6` |
| `--ct-accent-strong` | `#4c1d95` | `#c4b5fd` | `#4c1d95` `#4338ca` `#3730a3` `#312e81` `#1e1b4b` |
| `--ct-accent-soft` | `#ede9fe` | `#2e2a45` | `#ede9fe` `#ddd6fe` `#e9d5ff` `#e8e4f0` `#ebe6f2` `#f3e8ff` |
| `--ct-accent-softer` | `#f5f3ff` | `#232135` | `#f5f3ff` `#faf8ff` `#fafaff` `#f8f7fb` `#eef2ff` |
| `--ct-accent-border` | `#c4b5fd` | `#4a4470` | `#c4b5fd` `#ddd6fe` |

### 表面 / 背景 / 边框
| token | 亮色 | 暗色 | 收敛的原色 |
|-------|------|------|-----------|
| `--ct-bg` | `#f7f5fa` | `#1a1a1e` | `#f7f5fa` `#f8fafc` `#fafafc` `#f7f7f8` `#f2f3f5` |
| `--ct-surface` | `#ffffff` | `#232329` | `#ffffff` `#fff` |
| `--ct-surface-2` | `#f8f7fb` | `#2a2a31` | `#f8f7fb` `#f1f5f9` `#f3f4f6` `#f4f4f5` |
| `--ct-border` | `#ede9fe` | `#35353d` | `#ede9fe` `#e2e8f0` `#e4e4e7` `#e5e7eb` `#d1d5db` `#cbd5e1` `#d4d4d8` `#ececed` |

### 文本
| token | 亮色 | 暗色 | 收敛的原色 |
|-------|------|------|-----------|
| `--ct-text` | `#2e1065` | `#ececf0` | `#2e1065` `#0f172a` `#1e293b` `#1e1b4b` `#18181b` `#24292f` |
| `--ct-text-muted` | `#8b7aab` | `#a1a1aa` | `#8b7aab` `#334155` `#475569` `#4b5563` `#6b5b8a` `#7c7caa` |
| `--ct-text-subtle` | `#9c8db5` | `#71717a` | `#9c8db5` `#94a3b8` `#64748b` `#6b7280` `#9ca3af` |

### 状态色
| token | 亮色 | 暗色 | 收敛的原色 |
|-------|------|------|-----------|
| `--ct-success` | `#059669` | `#34d399` | `#059669` `#047857` `#10b981` `#065f46` `#22c55e` |
| `--ct-success-strong` | `#047857` | `#6ee7b7` | `#047857` `#064e3b` |
| `--ct-success-soft` | `#d1fae5` | `#12291f` | `#d1fae5` `#dcfce7` `#ecfdf5` `#f0fdf4` `#a7f3d0` |
| `--ct-warning` | `#f59e0b` | `#fbbf24` | `#f59e0b` `#d97706` `#b45309` `#92400e` |
| `--ct-warning-strong` | `#b45309` | `#fcd34d` | `#b45309` `#78350f` `#c2410c` |
| `--ct-warning-soft` | `#fffbeb` | `#2e2410` | `#fffbeb` `#fef3c7` `#fde68a` `#fff7ed` `#fed7aa` |
| `--ct-error` | `#ef4444` | `#f87171` | `#ef4444` `#dc2626` `#b91c1c` |
| `--ct-error-strong` | `#b91c1c` | `#fca5a5` | `#b91c1c` `#991b1b` `#7f1d1d` |
| `--ct-error-soft` | `#fee2e2` | `#2e1616` | `#fee2e2` `#fef2f2` `#fecaca` |

### 蓝 / 青（少量图表/链接/特殊卡）
| token | 亮色 | 暗色 | 收敛的原色 |
|-------|------|------|-----------|
| `--ct-info` | `#3b82f6` | `#60a5fa` | `#3b82f6` `#2563eb` `#0052d9` `#0043b8` `#003ca8` `#4b70a6` |
| `--ct-info-soft` | `#dbeafe` | `#16233a` | `#dbeafe` `#eff6ff` `#e8f2ff` `#e0ecff` `#f0f7ff` |
| `--ct-cyan` | `#06b6d4` | `#22d3ee` | `#06b6d4` `#22d3ee` `#14b8a6` `#34d399` `#0e7490` |
| `--ct-cyan-soft` | `#cffafe` | `#0c2a30` | `#cffafe` `#ecfeff` `#a5f3fc` |

### 品牌固定色（不随主题变，直接保留 hex，**不迁移**）
- `#de2910` `#ffde00`（中国红旗色，`SpecialDayToastCard.vue` 用）：语义是国旗，两个主题下都保持原色。迁移时**跳过这两个值**。

### 白字（卡片按钮上的前景白）
- 原色 `#ffffff`/`#fff` 出现在两种语境：**卡片背景**（→ `--ct-surface`）和**强调按钮上的前景文字**（应保持白）。迁移时逐处判断：作背景色的用 `--ct-surface`；作深色/强调底上的文字色的，用新增 token `--ct-on-accent`（亮暗均 `#ffffff`）。

---

## Task 1: Token 层 CSS 文件

**Files:**
- Create: `src/styles/theme.css`
- Modify: `src/main.ts`（顶部加一行 import）

**Interfaces:**
- Produces: 全局 CSS 变量 `--ct-*`（上表全部 34 个 + `--ct-on-accent`），在 `:root` 与 `[data-theme="dark"]` 下定义。后续所有迁移任务消费这些变量。

- [ ] **Step 1: 创建 `src/styles/theme.css`**

按「Token 命名与取值」表逐个写出。结构：

```css
:root {
  /* 强调 */
  --ct-accent: #7c3aed;
  --ct-accent-hover: #6d28d9;
  --ct-accent-strong: #4c1d95;
  --ct-accent-soft: #ede9fe;
  --ct-accent-softer: #f5f3ff;
  --ct-accent-border: #c4b5fd;
  /* 表面/背景/边框 */
  --ct-bg: #f7f5fa;
  --ct-surface: #ffffff;
  --ct-surface-2: #f8f7fb;
  --ct-border: #ede9fe;
  /* 文本 */
  --ct-text: #2e1065;
  --ct-text-muted: #8b7aab;
  --ct-text-subtle: #9c8db5;
  /* 状态 */
  --ct-success: #059669;
  --ct-success-strong: #047857;
  --ct-success-soft: #d1fae5;
  --ct-warning: #f59e0b;
  --ct-warning-strong: #b45309;
  --ct-warning-soft: #fffbeb;
  --ct-error: #ef4444;
  --ct-error-strong: #b91c1c;
  --ct-error-soft: #fee2e2;
  /* 蓝/青 */
  --ct-info: #3b82f6;
  --ct-info-soft: #dbeafe;
  --ct-cyan: #06b6d4;
  --ct-cyan-soft: #cffafe;
  /* 前景白 */
  --ct-on-accent: #ffffff;
}

[data-theme="dark"] {
  --ct-accent: #a78bfa;
  --ct-accent-hover: #8b5cf6;
  --ct-accent-strong: #c4b5fd;
  --ct-accent-soft: #2e2a45;
  --ct-accent-softer: #232135;
  --ct-accent-border: #4a4470;
  --ct-bg: #1a1a1e;
  --ct-surface: #232329;
  --ct-surface-2: #2a2a31;
  --ct-border: #35353d;
  --ct-text: #ececf0;
  --ct-text-muted: #a1a1aa;
  --ct-text-subtle: #71717a;
  --ct-success: #34d399;
  --ct-success-strong: #6ee7b7;
  --ct-success-soft: #12291f;
  --ct-warning: #fbbf24;
  --ct-warning-strong: #fcd34d;
  --ct-warning-soft: #2e2410;
  --ct-error: #f87171;
  --ct-error-strong: #fca5a5;
  --ct-error-soft: #2e1616;
  --ct-info: #60a5fa;
  --ct-info-soft: #16233a;
  --ct-cyan: #22d3ee;
  --ct-cyan-soft: #0c2a30;
  --ct-on-accent: #ffffff;
}
```

- [ ] **Step 2: 在 `src/main.ts` 引入**

在 `src/main.ts` 顶部现有 import 区加一行（放在其它 import 之后即可）：

```ts
import './styles/theme.css'
```

- [ ] **Step 3: 类型 + 构建关**

Run: `pnpm vue-tsc --noEmit && pnpm build`
Expected: 均通过（新 CSS 被打包，无类型错误）。

- [ ] **Step 4: Commit**

```bash
git add src/styles/theme.css src/main.ts
git commit -m "feat(theme): 新增语义 CSS 变量 token 层(亮/暗两套)"
```

---

## Task 2: naive-ui 亮/暗 overrides 拆分

**Files:**
- Modify: `src/theme.ts`

**Interfaces:**
- Consumes: 现有 `colors`、`themeOverrides`（保留兼容）
- Produces: 导出 `lightThemeOverrides: GlobalThemeOverrides`（= 现有 `themeOverrides`）和 `darkThemeOverrides: GlobalThemeOverrides`。Task 3 消费这两个。

- [ ] **Step 1: 加暗色 overrides**

在 `src/theme.ts` 末尾追加（保留现有 `colors` 与 `themeOverrides` 不动，`themeOverrides` 重命名前先加别名以免破坏 App.vue，见 Step 2）：

```ts
/** 暗色 naive-ui overrides，与 theme.css 的 [data-theme=dark] 对齐 */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#a78bfa',
    primaryColorHover: '#8b5cf6',
    primaryColorPressed: '#c4b5fd',
    primaryColorSuppl: '#a78bfa',
    successColor: '#34d399',
    successColorHover: '#6ee7b7',
    successColorPressed: '#059669',
    infoColor: '#60a5fa',
    warningColor: '#fbbf24',
    errorColor: '#f87171',
    bodyColor: '#1a1a1e',
    cardColor: '#232329',
    borderColor: '#35353d',
    dividerColor: '#35353d',
    textColor1: '#ececf0',
    textColor2: '#a1a1aa',
    textColor3: '#71717a',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: '#2e2a45',
    itemColorActiveHover: '#3a3555',
    itemColorHover: 'rgba(46, 42, 69, 0.6)',
    itemTextColor: '#a1a1aa',
    itemTextColorActive: '#c4b5fd',
    itemTextColorHover: '#ececf0',
    itemTextColorActiveHover: '#c4b5fd',
    arrowColor: '#a78bfa',
    arrowColorActive: '#c4b5fd',
    arrowColorHover: '#a78bfa',
  },
  Tag: { borderRadius: '20px' },
  Radio: {
    buttonTextColorActive: '#c4b5fd',
    buttonColorActive: '#2e2a45',
    buttonBorderColorActive: '#4a4470',
  },
  Card: { borderRadius: '16px', color: '#232329', borderColor: '#35353d' },
  Button: { borderRadiusMedium: '10px' },
  Slider: { fillColor: '#a78bfa', fillColorHover: '#8b5cf6', handleColor: '#a78bfa' },
}

/** 亮色 overrides 的别名（语义清晰，供 useTheme 选用） */
export const lightThemeOverrides = themeOverrides
```

- [ ] **Step 2: 类型 + 构建关**

Run: `pnpm vue-tsc --noEmit && pnpm build`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/theme.ts
git commit -m "feat(theme): 拆分 naive-ui 亮/暗 overrides"
```

---

## Task 3: useTheme composable（状态 + 持久化 + 系统跟随 + 广播）

**Files:**
- Create: `src/composables/useTheme.ts`

**Interfaces:**
- Consumes: `lightThemeOverrides`/`darkThemeOverrides`（Task 2）；`@tauri-apps/plugin-store` 的 `load`；`@tauri-apps/api/event` 的 `emit`/`listen`；naive-ui 的 `darkTheme`。
- Produces:
  - `type ThemeMode = 'system' | 'light' | 'dark'`
  - `useTheme(): { mode: Ref<ThemeMode>; resolved: ComputedRef<'light'|'dark'>; naiveTheme: ComputedRef<BuiltInGlobalTheme | null>; naiveOverrides: ComputedRef<GlobalThemeOverrides>; setMode(m: ThemeMode): Promise<void>; init(): Promise<void> }`
  - 常量事件名 `THEME_CHANGED_EVENT = 'catrace-theme-changed'`

设计要点（应用级单例，模块内 `ref`，多次 `useTheme()` 返回同一状态）：

- [ ] **Step 1: 写 composable**

```ts
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { load, type Store } from '@tauri-apps/plugin-store'
import { emit, listen } from '@tauri-apps/api/event'
import { darkTheme, type GlobalThemeOverrides, type BuiltInGlobalTheme } from 'naive-ui'
import { lightThemeOverrides, darkThemeOverrides } from '../theme'

export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_CHANGED_EVENT = 'catrace-theme-changed'
const STORE_FILE = 'settings.json'
const STORE_KEY = 'theme.mode'

// —— 单例状态 ——
const mode = ref<ThemeMode>('system')
const systemDark = ref(false)
let store: Store | null = null
let initialized = false

async function getStore(): Promise<Store> {
  if (!store) store = await load(STORE_FILE, { defaults: {}, autoSave: true })
  return store
}

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

const resolved = computed<'light' | 'dark'>(() => {
  if (mode.value === 'system') return systemDark.value ? 'dark' : 'light'
  return mode.value
})

function applyDom(): void {
  document.documentElement.setAttribute('data-theme', resolved.value)
}

const naiveTheme = computed<BuiltInGlobalTheme | null>(() =>
  resolved.value === 'dark' ? darkTheme : null,
)
const naiveOverrides = computed<GlobalThemeOverrides>(() =>
  resolved.value === 'dark' ? darkThemeOverrides : lightThemeOverrides,
)

async function setMode(m: ThemeMode): Promise<void> {
  mode.value = m
  applyDom()
  try {
    const s = await getStore()
    await s.set(STORE_KEY, m)
  } catch (e) {
    console.error('保存主题偏好失败', e)
  }
  // 广播给所有窗口（含自身，listener 里幂等）
  try {
    await emit(THEME_CHANGED_EVENT, { mode: m })
  } catch (e) {
    console.error('广播主题变更失败', e)
  }
}

/** 挂载前调用一次：读初值 + 落地 DOM + 装监听。防 FOUC 关键。 */
async function init(): Promise<void> {
  if (initialized) return
  initialized = true

  // 系统偏好
  systemDark.value = prefersDark()
  try {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        systemDark.value = e.matches
        applyDom()
      })
  } catch { /* 老 webview 无 matchMedia，忽略 */ }

  // 读持久化偏好
  try {
    const s = await getStore()
    const saved = await s.get<ThemeMode>(STORE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      mode.value = saved
    }
  } catch (e) {
    console.error('读取主题偏好失败，回退 system', e)
  }

  applyDom()

  // 跨窗口同步：其它窗口改了偏好，本窗口跟随
  try {
    await listen<{ mode: ThemeMode }>(THEME_CHANGED_EVENT, (ev) => {
      const m = ev.payload?.mode
      if (m === 'light' || m === 'dark' || m === 'system') {
        if (m !== mode.value) mode.value = m
        applyDom()
      }
    })
  } catch (e) {
    console.error('监听主题变更失败', e)
  }
}

export function useTheme() {
  return { mode, resolved, naiveTheme, naiveOverrides, setMode, init }
}
```

- [ ] **Step 2: 类型关**

Run: `pnpm vue-tsc --noEmit`
Expected: 通过。若 `BuiltInGlobalTheme` 导入名报错，改用 naive-ui 实际导出名（`GlobalTheme`），据 `pnpm vue-tsc` 报错信息调整。

- [ ] **Step 3: Commit**

```bash
git add src/composables/useTheme.ts
git commit -m "feat(theme): useTheme composable(状态/持久化/系统跟随/跨窗口广播)"
```

---

## Task 4: 接入 main.ts 与 App.vue（切换真正生效）

**Files:**
- Modify: `src/main.ts`（挂载前 `await useTheme().init()`）
- Modify: `src/App.vue`（provider 绑定 + body 背景用 token）

**Interfaces:**
- Consumes: `useTheme`（Task 3）

- [ ] **Step 1: main.ts 挂载前初始化**

在 `src/main.ts` 里找到 `createApp(...)` 挂载处，改为在 `.mount()` 之前 `await` 主题初始化。若现有挂载不在 async 上下文，用 IIFE 包裹或在 `.mount` 前串一个 `.then`。参考改法（按现有 main.ts 实际结构套用）：

```ts
import { useTheme } from './composables/useTheme'
// ...创建 app、注册 pinia/router/i18n 之后、mount 之前：
await useTheme().init()
app.mount('#app')
```

若 main.ts 顶层不能用 top-level await（依 tsconfig/target），改为：

```ts
useTheme().init().finally(() => app.mount('#app'))
```

- [ ] **Step 2: App.vue 绑定 naive provider**

在 `src/App.vue` `<script setup>` 引入并取值：

```ts
import { useTheme } from './composables/useTheme'
const { naiveTheme, naiveOverrides } = useTheme()
```

`NConfigProvider` 改为：

```html
<n-config-provider
  :theme="naiveTheme"
  :theme-overrides="naiveOverrides"
  :locale="naiveLocale"
  :date-locale="naiveDateLocale"
>
```

（删除原来 `import { themeOverrides }`，改用上面的。）

- [ ] **Step 3: App.vue body 背景用 token**

`src/App.vue` `<style>` 里 `html, body, #app { ... background: #f8fafc; }` 的 `background` 改为 `var(--ct-bg)`。仅改这一处颜色（精确编辑，规则 10）。

- [ ] **Step 4: 类型 + 构建关**

Run: `pnpm vue-tsc --noEmit && pnpm build`
Expected: 通过。

- [ ] **Step 5: 手动验证切换骨架（可选，若用户要求前端验证才做）**

连已运行的 `pnpm tauri dev`，在 devtools console 执行 `document.documentElement.setAttribute('data-theme','dark')`，确认 body 背景变深、naive 组件转暗。

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/App.vue
git commit -m "feat(theme): 接入 main/App，主题切换骨架生效"
```

---

## Task 5: 设置页三选主题控件 + i18n

**Files:**
- Modify: `src/components/settings/SystemSettingsCard.vue`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

**Interfaces:**
- Consumes: `useTheme`（Task 3）、`SettingRow`（现有）

- [ ] **Step 1: i18n 加文案（zh-CN）**

在 `src/i18n/locales/zh-CN.ts` 的 `settings` 段内，`language: {...}` 之后加：

```ts
theme: {
  title: '外观主题',
  desc: '选择亮色、暗色，或跟随系统',
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
},
```

- [ ] **Step 2: i18n 加文案（en-US）**

在 `src/i18n/locales/en-US.ts` 对应 `settings` 段 `language: {...}` 之后加：

```ts
theme: {
  title: 'Appearance',
  desc: 'Choose light, dark, or follow system',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
},
```

- [ ] **Step 3: SystemSettingsCard 加控件**

在 `<script setup>` 引入：

```ts
import { useTheme, type ThemeMode } from '../../composables/useTheme'
const { mode: themeMode, setMode: setThemeMode } = useTheme()
const themeOptions = computed(() => [
  { label: t('settings.theme.system'), value: 'system' },
  { label: t('settings.theme.light'), value: 'light' },
  { label: t('settings.theme.dark'), value: 'dark' },
])
function changeTheme(v: ThemeMode) { void setThemeMode(v) }
```

在 `<template>` 里，语言那条 `setting-row` 之后（`<div class="divider" />` 前或后，紧挨语言）插入：

```html
<setting-row :title="t('settings.theme.title')" :desc="t('settings.theme.desc')">
  <n-select
    :value="themeMode"
    :options="themeOptions"
    size="small"
    style="width: 10rem;"
    @update:value="changeTheme"
  />
</setting-row>
```

（`NSelect` 已在该文件 import，无需新增。）

- [ ] **Step 4: 类型 + 构建关**

Run: `pnpm vue-tsc --noEmit && pnpm build`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SystemSettingsCard.vue src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(theme): 设置页新增外观主题三选控件"
```

---

## Task 6–9: 388 处裸 hex 迁移（按区域分 4 批）

**迁移通则（每批适用）：**
- 严格按上方「Token 命名与取值」映射表替换：`background/color/border` 等属性值里的 hex → 对应 `var(--ct-*)`
- **精确编辑保原字节**（规则 10），逐处替换，禁整文件重写
- 白字（`#fff`/`#ffffff`）逐处判断：作卡片背景 → `--ct-surface`；作强调/深色底上前景 → `--ct-on-accent`
- 品牌固定色 `#de2910` `#ffde00` **跳过不迁**
- 半透明 `rgba(r,g,b,a)`：换成 `color-mix(in srgb, var(--ct-xxx) N%, transparent)`，token 取该 rgb 对应语义；无把握的保留原样并在 commit body 记一行
- 渐变 `linear-gradient(..., #a, #b)`：两端 hex 各自按表替换为 `var(--ct-*)`
- 每文件改完：`git diff --numstat <file>` 核对，若出现整文件级改动量（远超实际改的行）→ 从 HEAD 恢复该文件重做

**每批测试关：**
```
pnpm vue-tsc --noEmit && pnpm build
```
构建通过即视为该批过关（CSS 变量不影响类型，主要防语法破坏）。

### Task 6: 共享 toast/展示组件（约 158 处）

**Files（Modify）:**
- `src/components/PluginNavRail.vue`（63）
- `src/components/AgentToastCard.vue`（44）
- `src/components/TimelineWindows.vue`（27）
- `src/components/Timeline.vue`（15）
- `src/components/RestTimerBall.vue`（11）

- [ ] **Step 1:** 逐文件按映射表替换裸 hex → `var(--ct-*)`
- [ ] **Step 2:** 每文件 `git diff --numstat` 核对无异常
- [ ] **Step 3:** `pnpm vue-tsc --noEmit && pnpm build` 通过
- [ ] **Step 4:** Commit
```bash
git add src/components/PluginNavRail.vue src/components/AgentToastCard.vue src/components/TimelineWindows.vue src/components/Timeline.vue src/components/RestTimerBall.vue
git commit -m "refactor(theme): 共享组件裸色迁移至 CSS 变量(批1)"
```

### Task 7: toast 卡片组件（约 96 处）

**Files（Modify）:**
- `src/components/UpdateToastCard.vue`（21）
- `src/components/PermissionToastCard.vue`（20）
- `src/components/SdkToastCard.vue`（18）
- `src/components/SpecialDayToastCard.vue`（16，注意跳过 `#de2910`/`#ffde00`）
- `src/components/RestToastCard.vue`（14）
- `src/components/RestTimerToastCard.vue`（6）
- `src/components/settings/SliderControl.vue`（1）

- [ ] **Step 1:** 逐文件按映射表替换（SpecialDayToastCard 跳过品牌固定色）
- [ ] **Step 2:** 每文件 `git diff --numstat` 核对
- [ ] **Step 3:** `pnpm vue-tsc --noEmit && pnpm build` 通过
- [ ] **Step 4:** Commit
```bash
git add src/components/UpdateToastCard.vue src/components/PermissionToastCard.vue src/components/SdkToastCard.vue src/components/SpecialDayToastCard.vue src/components/RestToastCard.vue src/components/RestTimerToastCard.vue src/components/settings/SliderControl.vue
git commit -m "refactor(theme): toast 卡片裸色迁移至 CSS 变量(批2)"
```

### Task 8: 主窗口视图 + toast 窗口入口（约 83 处）

**Files（Modify）:**
- `src/views/toastWindows/ReminderPopup.vue`（25）
- `src/views/mainWindow/Dashboard.vue`（16）
- `src/views/mainWindow/MainShell.vue`（14）
- `src/views/mainWindow/Plugins.vue`（12）
- `src/views/toastWindows/ReminderFullscreen.vue`（11）
- `src/views/mainWindow/Settings.vue`（10）
- `src/views/mainWindow/Debug.vue`（3）
- `src/views/toastWindows/ReminderToast.vue`（2）

- [ ] **Step 1:** 逐文件按映射表替换
- [ ] **Step 2:** 每文件 `git diff --numstat` 核对
- [ ] **Step 3:** `pnpm vue-tsc --noEmit && pnpm build` 通过
- [ ] **Step 4:** Commit
```bash
git add src/views/toastWindows/ReminderPopup.vue src/views/mainWindow/Dashboard.vue src/views/mainWindow/MainShell.vue src/views/mainWindow/Plugins.vue src/views/toastWindows/ReminderFullscreen.vue src/views/mainWindow/Settings.vue src/views/mainWindow/Debug.vue src/views/toastWindows/ReminderToast.vue
git commit -m "refactor(theme): 主窗口/toast 视图裸色迁移至 CSS 变量(批3)"
```

### Task 9: 设置卡 + 插件面板组件（约 51 处）

**Files（Modify）:**
- `src/components/settings/LinksSettingsCard.vue`（16）
- `src/components/plugins/RestPluginPanel.vue`（12）
- `src/components/plugins/PluginPanelHeader.vue`（6）
- `src/components/settings/SystemSettingsCard.vue`（5，含 Task 5 未动的其余裸色）
- `src/components/settings/SignalSettingsCard.vue`（4）
- `src/components/settings/MediaSettingsCard.vue`（4）
- `src/components/settings/EventSdkSettingsCard.vue`（4）
- `src/components/plugins/PluginSection.vue`（4）
- `src/components/plugins/AgentPluginPanel.vue`（3）
- `src/components/settings/SettingRow.vue`（2，`#2E1065`→`--ct-text`，`#8B7AAB`→`--ct-text-muted`）

- [ ] **Step 1:** 逐文件按映射表替换
- [ ] **Step 2:** 每文件 `git diff --numstat` 核对
- [ ] **Step 3:** `pnpm vue-tsc --noEmit && pnpm build` 通过
- [ ] **Step 4:** Commit
```bash
git add src/components/settings/LinksSettingsCard.vue src/components/plugins/RestPluginPanel.vue src/components/plugins/PluginPanelHeader.vue src/components/settings/SystemSettingsCard.vue src/components/settings/SignalSettingsCard.vue src/components/settings/MediaSettingsCard.vue src/components/settings/EventSdkSettingsCard.vue src/components/plugins/PluginSection.vue src/components/plugins/AgentPluginPanel.vue src/components/settings/SettingRow.vue
git commit -m "refactor(theme): 设置卡/插件面板裸色迁移至 CSS 变量(批4)"
```

---

## Task 10: 迁移完整性收尾 + 全窗口验证

**Files:** 视残留情况而定

- [ ] **Step 1: 残留扫描**

Run:
```bash
grep -rniE "#[0-9a-f]{6}|#[0-9a-f]{3}\b" src/ --include="*.vue" | grep -viE "de2910|ffde00"
```
Expected: 结果应基本清零。剩下的逐条判断：确属应保留（品牌色/极特殊）则留；否则按映射表补迁。`src/theme.ts`、`src/styles/theme.css` 里的 hex 是真源，**不算残留**。

- [ ] **Step 2: 补迁残留（若有）**

对 Step 1 找出的应迁项，精确编辑替换，`git diff --numstat` 核对。

- [ ] **Step 3: 类型 + 构建关**

Run: `pnpm vue-tsc --noEmit && pnpm build`
Expected: 通过。

- [ ] **Step 4: 全窗口视觉验证（仅当用户要求前端验证时执行，规则 8）**

连已运行的 `pnpm tauri dev`（`http://localhost:1420`）：
- 设置页切「暗色」→ 主窗口各页转暗，无残留亮色块
- 触发一个 rest/agent toast → toast 窗口同步为暗色，新开窗口不闪白
- 切「跟随系统」→ 改 Windows 深色设置，全窗口跟随
- 切回「亮色」→ 恢复原薰衣草紫外观，与迁移前一致

- [ ] **Step 5: Commit（若 Step 2 有改动）**

```bash
git add -A
git commit -m "refactor(theme): 迁移完整性收尾，清理残留裸色"
```

---

## Self-Review 记录

- **Spec 覆盖**：token 层(T1)、naive 暗色(T2)、状态/持久化/系统跟随/广播(T3)、main/App 接入(T4)、设置三选+i18n(T5)、388 处迁移(T6–9)、收尾验证(T10) —— spec 各节均有对应任务。
- **占位扫描**：无 TBD/TODO；映射表给出确定取值；每步含可执行命令或代码。
- **类型一致性**：`ThemeMode`、`setMode`、`init`、`naiveTheme`、`naiveOverrides`、`THEME_CHANGED_EVENT` 跨 T3/T4/T5 命名一致；`lightThemeOverrides`/`darkThemeOverrides` T2 定义、T3 消费一致。
- **已知风险**：naive-ui `BuiltInGlobalTheme` 类型名可能是 `GlobalTheme`，T3 Step 2 已给回退处置。
