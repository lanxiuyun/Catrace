# 普通应用外壳

Catrace 前端按 **窗口职责** 拆成两套壳：主窗口 `MainShell` 与 Toast/提醒窗口 `ToastShell`。路由决定挂哪套壳；`App.vue` 只提供 naive-ui / 全局样式，不再按 path 分支。

## Component / module hierarchy

```text
App.vue                          # NConfigProvider + RouterView + 全局 html/body 样式
└── router（nested）
    ├── MainShell.vue            # /dashboard /plugins /settings /debug
    │   ├── global-header
    │   └── RouterView + KeepAlive（主壳不滚动）
    │       ├── Dashboard.vue → PageScroll
    │       ├── Settings.vue  → PageScroll
    │       ├── Debug.vue     → PageScroll
    │       └── Plugins.vue
    │           ├── PluginNavRail
    │           └── plugin-main（固定 PluginPanelHeader + plugin-scroll）
    └── ToastShell.vue           # /reminder-* /plugin-host
        └── RouterView（无 KeepAlive、无 app-shell、无主窗滚动条）
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
- `MainShell` 只提供固定壳和全高 `overflow:hidden` 工作区，不提供 scrollbar。Dashboard / Settings / Debug 复用 `PageScroll`；Plugins 自己只滚右侧详情。

## Key conventions

- **主窗 / Toast 窗禁止耦合**：主窗 chrome（header、nav、KeepAlive、全高工作区）只进 `MainShell`；Toast 相关透明背景只进 `ToastShell`。
- 普通页面样式限定在 `.app-shell` 内，禁止影响 Reminder Toast 的窗口尺寸测量。
- **页面自己拥有滚动**：`MainShell` 永远不滚。普通长页用公共 `PageScroll`；特殊布局页在页面内部放 scrollbar。
- **滚动所有者必须唯一**：禁止在主壳与页面同时套纵向 scrollbar，也禁止在 panel 内重复套 scrollbar。
- 插件页：左右分栏；内容外壳只在宿主 `.plugin-detail`；面板组件只出业务（无 PluginPanelShell）。全局顶栏、插件侧栏、详情顶栏固定；只有 `plugin-scroll` 滚动。
- Header 固定：高 `3rem`，左 padding `0.75rem`。
- 应用级辅助信息放全局顶栏右侧；插件侧栏只放插件上下文。

## Sub-docs

- [主窗与-Toast-窗用-nested-route-拆壳-App-不再按路径分支.md](主窗与-Toast-窗用-nested-route-拆壳-App-不再按路径分支.md) — 拆分动机、路由表、加页面要改哪。
- [插件页左侧插件中心与右侧固定顶栏的布局约定.md](插件页左侧插件中心与右侧固定顶栏的布局约定.md) — 插件页侧栏与详情布局。

## Change points

1. 改一级导航 / 主窗外壳 → `src/views/mainWindow/MainShell.vue`
2. 改普通页面公共滚动壳 → `src/components/PageScroll.vue`
3. 改 Toast 透明背景或独立窗外壳 → `src/views/toastWindows/ToastShell.vue`
4. 加主窗页面 → `src/views/mainWindow/` + router；普通长页包 `PageScroll`，特殊页自己定义滚动边界
5. 加独立窗页面 → `src/views/toastWindows/` + router 的 ToastShell children
6. 改插件二级栏或详情滚动 → `src/views/mainWindow/Plugins.vue`
7. 全局 provider / 全局 html 样式 → `src/App.vue`（保持薄）
