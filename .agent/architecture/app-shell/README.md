# 应用外壳

主窗口由 React 布局路由承载；提醒窗口与插件后台窗口使用独立的 `ToastShell`，通过 `VueIsland` 挂载 Vue 页面。窗口共用单个 HTML 入口，hash 路径与 Tauri 建窗 URL 对齐。

## 组件边界

```text
src/app/main.tsx
├── 主窗口：Radix Theme → RouterProvider
│   └── MainShell
│       ├── 侧栏 NavLink
│       ├── 工作区 Outlet
│       │   ├── Dashboard
│       │   ├── Plugins → PluginCenter
│       │   │   ├── 内置久坐提醒：RestSettings（React）
│       │   │   └── 外部插件：ExternalPluginSettings → VueIsland
│       │   ├── Settings
│       │   └── Debug
│       └── Toaster（主窗操作反馈）
└── 独立窗口：RouterProvider → ToastShell → VueIsland
    ├── ReminderToast.vue
    ├── ReminderPopup.vue
    ├── ReminderFullscreen.vue
    └── PluginHost.vue
```

路由真源是 [router.tsx](../../../src/app/router.tsx)：主窗四页位于 `/` 的 children 下；`/reminder-toast`、`/reminder-popup`、`/reminder-fullscreen`、`/plugin-host` 是独立的顶层路由。

## 布局与滚动

- [MainShell.tsx](../../../src/app/shell/MainShell.tsx) 只拥有侧栏、工作区与全局操作提示，页面由 `<Outlet />` 渲染。切页保留布局组件，不保活页面组件。
- 主壳与工作区使用 `overflow: hidden`；页面自己拥有滚动。普通长页复用 [PageScroll.tsx](../../../src/app/components/PageScroll.tsx)，避免主壳和页面同时创建纵向滚动条。
- 插件中心采用列表与详情视图，不是额外的固定插件侧栏。页面布局由 [PluginCenter.tsx](../../../src/app/pages/plugins/PluginCenter.tsx) 与 [plugins.css](../../../src/app/pages/plugins.css) 管理，详见 [插件中心](../../features/plugin-center/README.md)。
- [ToastShell.tsx](../../../src/app/shell/ToastShell.tsx) 只铺满视口，不挂主窗导航、页面滚动壳或 Radix 根主题。提醒页面自己负责透明背景、卡片布局及尺寸测量。
- 主窗样式限定在主窗类名内，避免影响提醒窗口尺寸与透明背景。

## 修改入口

| 任务 | 入口 |
|------|------|
| 一级导航、主窗布局、全局操作提示 | [MainShell.tsx](../../../src/app/shell/MainShell.tsx)、[shell.css](../../../src/app/shell/shell.css) |
| 增加页面或调整窗口路由 | [router.tsx](../../../src/app/router.tsx)，独立窗口还需核对 Rust 建窗路径 |
| 页面滚动容器 | [PageScroll.tsx](../../../src/app/components/PageScroll.tsx) |
| Vue 页面与外部插件设置挂载 | [VueIsland.tsx](../../../src/app/legacy/VueIsland.tsx)、[vueRuntime.ts](../../../src/app/legacy/vueRuntime.ts) |
| 启动流程、窗口分流、主题与语言初始化 | [bootstrap.ts](../../../src/app/bootstrap.ts)、[preflight.ts](../../../src/app/preflight.ts) |

## 相关文档

- [主窗切页动画与布局路由约定](主窗切页动画与布局路由约定.md) — 一级导航与插件详情转场的边界。
- [React 前端架构](../react-migration/README.md) — React/Vue 运行时、状态与主题协作。
- [设置页](../../features/settings/README.md) — 系统设置与插件设置的职责。
