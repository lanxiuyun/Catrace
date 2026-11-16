# 应用外壳

所有原生窗口由 React Router 承载，共用单个 HTML 入口。主窗口使用 `MainShell` 布局路由，提醒与插件后台窗口使用独立 `ToastShell`，hash 路径与 Tauri 建窗 URL 对齐。

## 组件边界

```text
main.tsx → Radix Theme（插件 UI 边界）→ RouterProvider
├── MainShell（HeroUI 宿主 UI）
│   ├── 侧栏 NavLink
│   ├── Outlet → Dashboard / Plugins / Settings / Debug
│   │              └── PluginCenter → RestSettings / ExternalPluginSettings
│   └── Toaster
└── ToastShell
    └── ReminderToast / ReminderPopup / ReminderFullscreen / PluginHost
```

路由真源是 [router.tsx](../../../src/app/router.tsx)，主窗页面在 [pages/](../../../src/app/pages/)，独立窗口在 [windows/](../../../src/app/windows/)。宿主页面与 Toast 卡片使用 HeroUI；根 Radix `Theme` 暂时保留（插件 UI 依赖它），[base.css](../../../src/app/base.css) 的透明背景与根高度不能撑大提醒窗口。

## 布局与滚动

- [MainShell.tsx](../../../src/app/shell/MainShell.tsx) 只拥有导航、工作区与全局操作提示；切页保留布局组件，页面组件会卸载。
- 主壳与工作区 `overflow: hidden`；普通长页使用 [PageScroll.tsx](../../../src/app/components/PageScroll.tsx)，避免双层纵向滚动。
- [PluginCenter.tsx](../../../src/app/pages/plugins/PluginCenter.tsx) 管理列表与整页详情，详情外壳、总开关、列宽与页面边距归宿主。
- [ToastShell.tsx](../../../src/app/shell/ToastShell.tsx) 只铺满视口，不挂主窗导航或长页滚动壳。提醒页面负责透明背景、卡片布局及尺寸测量。
- 页面样式限定在自身类名内，不能影响独立提醒窗口尺寸。

## 修改入口

| 任务 | 入口 |
|---|---|
| 主窗导航与提示 | [MainShell.tsx](../../../src/app/shell/MainShell.tsx)、[shell.css](../../../src/app/shell/shell.css) |
| 新页面或窗口路由 | [router.tsx](../../../src/app/router.tsx)，同时核对 Rust 建窗 URL |
| Toast 栈与原生窗口协作 | [ReminderToast.tsx](../../../src/app/windows/ReminderToast.tsx) 与 [toast/controller.ts](../../../src/app/windows/toast/controller.ts) |
| 插件设置挂载 | [ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) |
| 日志、语言、主题与窗口分流 | [bootstrap.ts](../../../src/app/bootstrap.ts)、[preflight.ts](../../../src/app/preflight.ts) |

一级导航与插件详情转场见[布局路由约定](主窗切页动画与布局路由约定.md)，状态与主题见[React 架构](../react-migration/README.md)。
