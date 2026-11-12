# 项目结构

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面宿主 | Tauri 2 + Rust |
| 宿主窗口 UI | React 19 + TypeScript + React Router + HeroUI v3 + Tailwind 4 |
| 插件 UI | 宿主注入的 React + HeroUI（设置页）/ Radix Themes（旧卡片与未迁移设置页） |
| 共享前端状态 | zustand，React selector / 框架外 `.getState()` |
| 国际化 | 纯 TypeScript 词条与翻译函数，语言状态在 shell store |
| 构建 | Vite + React 插件 + `@tailwindcss/vite` |
| 本地数据与系统能力 | SQLite、Tauri Store、键鼠／焦点窗口采集、平台音频、Event Bus、插件 WebView／sidecar |

依赖、命令以 [package.json](../../../package.json)、[Cargo.toml](../../../src-tauri/Cargo.toml)、[vite.config.ts](../../../vite.config.ts) 为准。

## 代码导航

```text
src/
  app/
    main.tsx / bootstrap.ts / preflight.ts   React 入口、初始化、窗口分流
    router.tsx                              hash 路由
    shell/                                  主窗与独立窗外壳
    pages/                                  概览 / 插件 / 设置 / 调试
    windows/                                Toast / Popup / Fullscreen / PluginHost
      toast/                                controller、Bus、尺寸、计时、滚动、激活
    store.ts / i18n.ts                       语言主题真源与翻译
    base.css / heroui.css / radix-theme.css  全窗口基础样式、HeroUI 入口与插件 UI 的 Radix 主题
  components/                               React Toast 卡片与插件卡宿主
  plugins/                                  Blob 加载、React/HeroUI/Radix 注入与宿主 API
  stores/                                   zustand Event Hub / plugin registry
  composables/useTheme.ts                    主题持久化、系统偏好与跨窗同步
  api/tauri.ts                              Tauri 调用
  i18n/locales/                             中文 / 英文词条
  styles/theme.css                          共享 --ct-* token
  styles/heroui.css                         HeroUI 样式入口（Tailwind 4 + @heroui/styles）
src-tauri/src/
  main.rs / lib.rs                          宿主启动与命令组合
  event.rs / bus.rs / event_http.rs          协议、Bus、外部 Event HTTP
  signal.rs / db.rs                         行为信号与 SQLite
  rest_plugin.rs / reminder_toast.rs         久坐判定与 Toast 原生窗口
  plugins.rs / plugin_repository.rs         本机插件、仓库发现与安装
  plugin_api/ / plugin_config.rs            插件宿主能力与配置
  plugin_window.rs / plugin_sidecar.rs       后台 WebView / sidecar
  node_runtime.rs / sidecar/                Node 与命令解析
  media_audio.rs / notification_listener.rs 音频与系统通知
  window_manager/                           定位、层级与无焦点显示
.agent/                                     宿主知识库
```

外部插件源码与插件自身知识保存在独立 [catrace-plugin 仓库](https://github.com/lanxiuyun/catrace-plugin)。宿主只提供安装、运行入口、组件与能力合同。

## 修改入口

- 窗口导航、滚动、路由：[应用外壳](../app-shell/README.md)。
- zustand、主题语言与启动：[React 架构](../react-migration/README.md)。
- 系统设置：[设置页](../../features/settings/README.md)；插件管理与合同：[插件中心](../../features/plugin-center/README.md)。
- 版本号：[版本管理](../../reference/version-management.md)。

前端尺寸用 rem；简单配置走 Tauri Store，业务数据按模块进入 SQLite；平台相关 Rust 能力用 cfg 隔离。
