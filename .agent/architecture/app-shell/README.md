# 普通应用外壳

Catrace 前端按 **窗口职责** 拆成两套壳：主窗口 `MainShell` 与 Toast/提醒窗口 `ToastShell`。路由决定挂哪套壳；`App.vue` 只提供 naive-ui / 全局样式，不再按 path 分支。

## Component / module hierarchy

```text
App.vue                          # NConfigProvider + RouterView + 全局 html/body 样式
└── router（nested）
    ├── MainShell.vue            # /dashboard /plugins /settings /debug
    │   ├── global-header
    │   └── OverlayScrollbar
    │       └── RouterView + KeepAlive
    │           ├── Dashboard.vue
    │           ├── Plugins.vue
    │           │   ├── PluginNavRail + OverlayScrollbar
    │           │   └── plugin-main（固定顶栏 Panel + OverlayScrollbar）
    │           ├── Settings.vue
    │           └── Debug.vue
    └── ToastShell.vue           # /reminder-* /plugin-host
        └── RouterView（无 KeepAlive、无 app-shell）
            ├── ReminderPopup.vue
            ├── ReminderFullscreen.vue
            ├── ReminderToast.vue
            └── PluginHost.vue
```

目录：

```text
src/views/
  mainWindow/     MainShell + 主窗口页面
  toastWindows/   ToastShell + 独立窗口页面
```

## Data flow

- 路由 nested：父组件是 Shell，子组件是具体页面；**不再**在 `App.vue` 用 `v-if` 手选组件。
- 主窗口一级导航用 `RouterLink` active 状态。
- `ToastShell` 监听 fullscreen / toast 路由，给 `html` 打 `reminder-transparent`，保证透明窗背景。
- `OverlayScrollbar` 只挂在主窗口壳与插件页局部滚动区，不进 Toast 路径。

## Key conventions

- **主窗 / Toast 窗禁止耦合**：主窗 chrome（header、nav、KeepAlive、覆盖滚动）只进 `MainShell`；Toast 相关透明背景只进 `ToastShell`。
- 普通页面样式限定在 `.app-shell` 内，禁止影响 Reminder Toast 的窗口尺寸测量。
- 同一滚动区域只保留一个滚动容器；接入 `OverlayScrollbar` 后，外层用 `overflow: hidden`。
- 覆盖式滑块默认隐藏，hover / 拖动才显示，不占内容布局宽度。
- 插件页保持左右分栏；窄窗只收窄左栏，不改上下堆叠。
- Header 固定：高 `3rem`，左 padding `0.75rem`。
- 应用级辅助信息放全局顶栏右侧；插件侧栏只放插件上下文。

## Sub-docs

- [主窗与-Toast-窗用-nested-route-拆壳-App-不再按路径分支.md](主窗与-Toast-窗用-nested-route-拆壳-App-不再按路径分支.md) — 拆分动机、路由表、加页面要改哪。
- [覆盖式滚动条不能影响-Toast-窗口尺寸测量.md](覆盖式滚动条不能影响-Toast-窗口尺寸测量.md) — 覆盖滚动与 Reminder 窗隔离。
- [插件页左侧插件中心与右侧固定顶栏的布局约定.md](插件页左侧插件中心与右侧固定顶栏的布局约定.md) — 插件页侧栏与详情滚动。

## Change points

1. 改一级导航 / 主窗外壳 → `src/views/mainWindow/MainShell.vue`
2. 改 Toast 透明背景或独立窗外壳 → `src/views/toastWindows/ToastShell.vue`
3. 加主窗页面 → `src/views/mainWindow/` + `router` 的 MainShell children
4. 加独立窗页面 → `src/views/toastWindows/` + `router` 的 ToastShell children
5. 改覆盖滚动 → `src/components/OverlayScrollbar.vue`
6. 改插件二级栏 → `src/views/mainWindow/Plugins.vue`
7. 全局 provider / 全局 html 样式 → `src/App.vue`（保持薄）
