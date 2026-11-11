# React 前端架构

宿主 UI 使用 React 19、React Router、HeroUI v3 + Tailwind 4 与 zustand；外部插件 UI 仍使用宿主注入的 React + Radix Themes。Vite 使用 React 插件与 `@tailwindcss/vite`；各原生窗口共用 [index.html](../../../index.html) 与 [main.tsx](../../../src/app/main.tsx)，由 hash 路由选择页面。

## 入口与窗口

1. [preflight.ts](../../../src/app/preflight.ts) 归一提醒窗口 hash，并判定窗口职责。
2. [bootstrap.ts](../../../src/app/bootstrap.ts) 安装日志、F12、插件生命周期监听，初始化语言与主题；主窗启动 Event Hub。
3. [main.tsx](../../../src/app/main.tsx) 在 bootstrap 结束后渲染 React root。宿主 UI 由 HeroUI 组件构成，外面仍包一层 Radix `Theme` 作为插件 UI 的主题边界；根节点由 [base.css](../../../src/app/base.css) 约束高度并保持透明。
4. [router.tsx](../../../src/app/router.tsx) 的 hash 与 Tauri 建窗 URL 一致。

| 路由 | React 组件 |
|---|---|
| `/dashboard`、`/plugins`、`/settings`、`/debug` | `MainShell` 布局路由下的页面 |
| `/reminder-toast` | [ReminderToast.tsx](../../../src/app/windows/ReminderToast.tsx)，Toast controller 与卡片栈 |
| `/reminder-popup` | [ReminderPopup.tsx](../../../src/app/windows/ReminderPopup.tsx) |
| `/reminder-fullscreen` | [ReminderFullscreen.tsx](../../../src/app/windows/ReminderFullscreen.tsx) |
| `/plugin-host` | [PluginHost.tsx](../../../src/app/windows/PluginHost.tsx)，隐藏后台 ESM 宿主 |

插件后台窗口在 bootstrap 中只安装按 `plugin-bg-<id>` 绑定的日志转发，不读取主窗设置 Store；后台通过插件专属 API 查询配置、语言与主题。后台 ESM 在窗口内执行普通模块副作用，其资源寿命由原生窗口销毁结束。

## 状态 API

| 职责 | 真源与使用方式 |
|---|---|
| 语言、主题偏好与解析值 | [useShellStore](../../../src/app/store.ts)，React selector 或框架外 `.getState()` |
| 插件组件与 kind 映射 | [usePluginRegistry](../../../src/stores/pluginRegistry.ts)，不可变 Map；组件类型是 React ComponentType |
| 主窗事件观察 | [useEventHub](../../../src/stores/eventHub.ts)，active/resolved 数组，resolved 历史上限 150 |
| Toast 生命周期 | [controller.ts](../../../src/app/windows/toast/controller.ts) 与局部 zustand store；挂载启动，卸载统一 dispose |
| 页面业务状态 | 页面 React state 与 [Tauri API](../../../src/api/tauri.ts) |

共享 store 只在当前 WebView 内共享，原生窗口之间通过 Tauri 事件与持久化同步。框架外调用 store 时使用 `.getState()`，不在普通函数里调用 React hook。

## 语言与主题

- [i18n.ts](../../../src/app/i18n.ts) 提供纯 TypeScript `translate(locale, key, params)` 与 React `useT()`。`initLocale` 读取 DB 或检测系统语言，`setAppLocale` 持久化成功后广播 `catrace-locale-changed`，各窗口更新 zustand 与 HTML lang。
- [useTheme.ts](../../../src/composables/useTheme.ts) 提供 `initTheme`、`setThemeMode` 和返回普通状态值的 `useTheme()`。持久化键为 `theme.mode`；监听系统 `matchMedia` 与 `catrace-theme-changed`，更新 zustand 和 `data-theme`。
- 颜色真源是 [theme.css](../../../src/styles/theme.css) 的 `--ct-*`；HeroUI 侧由 [heroui.css](../../../src/styles/heroui.css) 引入 Tailwind 4 + HeroUI 样式，插件 UI 侧仍由 [radix-theme.css](../../../src/app/radix-theme.css) 映射 Radix 色阶、焦点和控件反馈。

## 插件与组件边界

外部插件导出 React Card / Settings 组件，使用宿主注入的 React 与 **Radix** 运行时，见[外部插件合同](../desktop-event-os/m10-external-plugins.md)；宿主自己的插件管理页与设置面板已经改用 HeroUI。[ExternalPluginSettings.tsx](../../../src/app/pages/plugins/ExternalPluginSettings.tsx) 直接挂载已启用的 React 设置组件，并负责跨窗口配置事件转发与渲染失败反馈；Toast 卡由 [PluginHostCard.tsx](../../../src/components/PluginHostCard.tsx) 管理。

修改窗口布局读[应用外壳](../app-shell/README.md)；修改安装、启停与信任读[插件中心](../../features/plugin-center/README.md)；修改窗口显示、层级或尺寸必须同时核对 Rust 与 Toast controller，不能只改卡片 JSX。
