# 主窗与 Toast 窗用 nested route 拆壳，App 不再按路径分支

## 为什么拆

旧 `App.vue` 同时持有：

- naive provider
- 主窗 header / nav / KeepAlive
- Reminder 路由 `v-if` 分支
- fullscreen/toast 透明背景 `watch`

主窗与独立窗逻辑耦在一个根组件，改一边容易碰到另一边（尤其是全局样式和透明背景）。

## 目标结构

| 层 | 职责 |
|----|------|
| `App.vue` | `NConfigProvider` / message / dialog + 全局 `html/body/#app` 与 user-select |
| `MainShell.vue` | 主窗 chrome：header、nav、`OverlayScrollbar`、`KeepAlive` 子路由 |
| `ToastShell.vue` | 独立窗 chrome：子路由 + `reminder-transparent` |
| `router/index.ts` | 两套 parent `path: '/'` + 各自 children，决定挂哪套壳 |

路由形态（概念）：

```ts
{
  path: '/',
  component: MainShell,
  children: [
    { path: '', redirect: '/dashboard' },
    { path: 'dashboard', component: Dashboard },
    // plugins / settings / debug
  ],
},
{
  path: '/',
  component: ToastShell,
  children: [
    { path: 'reminder-popup', component: ReminderPopup },
    // reminder-fullscreen / reminder-toast / plugin-host
  ],
},
```

页面文件目录：

```text
src/views/mainWindow/     # 主窗页面 + MainShell
src/views/toastWindows/   # 独立窗页面 + ToastShell
```

从 `views/*` 下沉一层后，相对 `src/` 的 import 要多一层 `../`（`../../api`、`../../components` …）。

## 约定

1. **显示哪个 view 由 router 决定**，不要在 Shell 或 App 里再手写 path → 组件映射（`ToastShell` 只根据 path 切透明背景 class，不选组件）。
2. 主窗页面默认进 `KeepAlive`；独立窗不进。
3. Toast / fullscreen / popup / plugin-host **禁止**挂 `.app-shell` 或 `OverlayScrollbar`（尺寸测量与透明窗）。
4. 两个 parent 都用 `path: '/'` + 相对 children path 是刻意写法：hash 路由下与历史绝对 path（`/dashboard`、`/reminder-toast`）兼容，且互不嵌套。

## 加页面 checklist

**主窗新页**

1. 新建 `src/views/mainWindow/Foo.vue`
2. `router` → MainShell `children` 加 `{ path: 'foo', component: Foo }`
3. 若要一级导航，改 `MainShell.vue` 的 `RouterLink`

**独立窗新页**

1. 新建 `src/views/toastWindows/Bar.vue`
2. `router` → ToastShell `children` 加路由
3. 若需透明背景，扩展 `ToastShell` 的 `needsTransparentBg` path 判断
4. Rust / 窗口管理侧确认打开的 hash 路径一致

## 不要做

- 不要把 header 或 Toast 卡片逻辑塞回 `App.vue`
- 不要在 `MainShell` import Reminder* / PluginHost
- 不要在 `ToastShell` import Dashboard / Plugins 等主窗页
