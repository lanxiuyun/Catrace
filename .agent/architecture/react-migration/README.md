# React 前端架构

主窗口使用 React 19、React Router、Radix Themes 与 zustand；提醒窗口、插件后台窗口和外部插件设置使用 Vue 运行时。Vite 同时启用 React/Vue 插件，所有窗口共用 [index.html](../../../index.html) 与 [main.tsx](../../../src/app/main.tsx)。

## 入口与路由

1. [preflight.ts](../../../src/app/preflight.ts) 归一提醒窗口 hash，并判定窗口类型。
2. [bootstrap.ts](../../../src/app/bootstrap.ts) 初始化日志、F12、插件、语言、主题和主窗 Event Hub；插件后台窗口单独安装带插件身份的日志转发。
3. [main.tsx](../../../src/app/main.tsx) 在启动流程结束后渲染 React root；主窗口包在一个 Radix 根主题内，独立窗口直接渲染路由。
4. [router.tsx](../../../src/app/router.tsx) 用 hash 路由匹配 Tauri 建窗 URL。

| 窗口/路由 | 页面与外壳 |
|-----------|------------|
| `/dashboard`、`/plugins`、`/settings`、`/debug` | React 页面，共用 `MainShell` 布局路由与 `<Outlet />` |
| `/reminder-toast`、`/reminder-popup`、`/reminder-fullscreen` | `ToastShell` → `VueIsland` → 对应 Vue 提醒页面 |
| `/plugin-host` | `ToastShell` → `VueIsland` → Vue 插件后台宿主页面 |

主窗布局、滚动与导航见 [应用外壳](../app-shell/README.md)。

## Vue 运行时与插件

- [VueIsland.tsx](../../../src/app/legacy/VueIsland.tsx) 在 React 容器内挂载 Vue app，并在 React 卸载时销毁它；它也用于插件中心的外部设置面板。
- [vueRuntime.ts](../../../src/app/legacy/vueRuntime.ts) 在每个 WebView 内提供共享 Pinia，并为 Vue 岛注入 i18n、naive-ui 主题、消息和对话框 provider。不同窗口的 JS 状态各自独立。
- 内置久坐提醒的设置是 React [RestSettings.tsx](../../../src/app/pages/plugins/RestSettings.tsx)，由 [Plugins.tsx](../../../src/app/pages/Plugins.tsx) 管理配置读写；[registerBuiltins.ts](../../../src/plugins/registerBuiltins.ts) 负责其事件注册。
- 外部插件正常参与发现、安装和用户授权启用。启用后的 Vue UI/设置由 [loadExternalPlugins.ts](../../../src/plugins/loadExternalPlugins.ts) 加载；[ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) 从 registry 取设置组件并交给 `VueIsland`。
- 外部插件的 Vue/naive-ui/宿主 UI 注入契约由 [pluginRuntime.ts](../../../src/plugins/pluginRuntime.ts) 提供。修改插件宿主边界时需要同时考虑设置面板、Toast 卡与后台窗口，详见 [插件中心](../../features/plugin-center/README.md)。

## 状态、语言与主题

| 责任 | 真源与消费方 |
|------|--------------|
| 主题偏好及解析值 | [useTheme.ts](../../../src/composables/useTheme.ts) 管理持久化、`data-theme` 和跨窗口主题同步 |
| 当前语言 | [i18n 入口](../../../src/i18n/index.ts) 的 Vue i18n 单例；词条位于同目录 locales |
| React 壳状态 | [store.ts](../../../src/app/store.ts) 的 zustand 镜像主题和语言，由启动流程中的 Vue watch 同步 |
| React 翻译 | [i18n.ts](../../../src/app/i18n.ts) 直接查询共享词条对象，通过 `useT()` 随 locale 更新 |
| 事件与插件注册 | [eventHub.ts](../../../src/stores/eventHub.ts)、[pluginRegistry.ts](../../../src/stores/pluginRegistry.ts) 使用共享 Pinia |
| 页面业务状态 | 页面自身的 React state 与框架无关的 [Tauri API 封装](../../../src/api/tauri.ts) |

配色 token 在 [theme.css](../../../src/styles/theme.css)，Radix 映射与控件反馈在 [radix-theme.css](../../../src/app/radix-theme.css)，naive-ui overrides 在 [theme.ts](../../../src/theme.ts)。两套 UI 都消费同一主题状态。React 页面用 [RadixPage.tsx](../../../src/app/components/RadixPage.tsx) 声明页面主题作用域；独立 Vue 窗口不增加 Radix 根主题。

## 修改边界

- 主窗页面与控件写在 React 层，系统设置只挂五张核心卡，见 [设置页](../../features/settings/README.md)。
- Vue/naive-ui/Pinia/i18n 仍是提醒窗口与插件运行链路的依赖；依赖调整须覆盖这些实际使用点。
- 多窗口共用 URL 路由表，不共用 JS 内存；跨窗口变更经 Tauri 事件或持久化同步。
