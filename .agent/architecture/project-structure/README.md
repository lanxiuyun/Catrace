# 项目结构

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Tauri 2 + Rust |
| 主窗口前端 | React 19 + TypeScript + React Router + Radix Themes + zustand |
| 提醒窗口与外部插件 UI | Vue 3 + naive-ui；通过 VueIsland 挂入 React 宿主 |
| 共享前端能力 | Pinia 事件/插件 registry、Vue i18n 词条与语言状态、Tauri API 封装 |
| 构建 | Vite，同时启用 React/Vue 插件 |
| 本地数据与系统能力 | SQLite、键鼠/焦点窗口采集、平台音频检测、Event Bus、插件 WebView/sidecar |

依赖与脚本以 [package.json](../../../package.json)、[Cargo.toml](../../../src-tauri/Cargo.toml)、[vite.config.ts](../../../vite.config.ts) 为准。

## 代码导航

```text
src/
  app/
    main.tsx / bootstrap.ts / preflight.ts   入口、初始化、窗口分流
    router.tsx                              hash 路由
    shell/                                  React 主窗/独立窗外壳
    pages/                                  Dashboard / Plugins / Settings / Debug
      plugins/                              插件列表、详情、久坐设置、外部设置桥
      settings/                             五张核心设置卡
      debug/                                Signal / 音频 / Event SDK 面板
    components/                             PageScroll / RadixPage
    legacy/                                 VueIsland 与共享 Vue 运行时
    store.ts / i18n.ts                      React 主题语言镜像与翻译
    ui/ / lib/                              全局操作提示、Store 封装
  views/toastWindows/                       Vue 提醒窗口与 PluginHost
  components/                               Vue Toast 卡、插件 UI 宿主与共享控件
  plugins/                                  插件加载、运行时与 API
  stores/                                   Event Hub / plugin registry（Pinia）
  composables/                              主题、Toast 布局等共享能力
  api/tauri.ts                              框架无关的 Tauri 调用
  i18n/ / styles/ / theme.ts                 词条、共享 CSS token、naive-ui 主题
src-tauri/src/
  main.rs / lib.rs                          Rust 入口与宿主组合
  event.rs / bus.rs / event_http.rs          事件协议、Bus、本机 HTTP SDK
  signal.rs / db.rs                         行为信号与 SQLite
  rest_plugin.rs / reminder_toast.rs        久坐提醒与 Toast 窗口管理
  plugins.rs / plugin_commands.rs           插件管理与命令
  plugin_repository.rs                      仓库发现、安装与卸载
  plugin_api/ / plugin_config.rs            插件权限 API 与配置
  plugin_window.rs / plugin_sidecar.rs      后台 WebView / sidecar
  node_runtime.rs / sidecar/                Node 运行时与 sidecar 宿主
  media_audio.rs / notification_listener.rs 平台音频与系统通知
  window_manager/                           窗口层级与无焦点显示
  log.rs / report.rs / update.rs            日志、启动上报与更新
.agent/                                     宿主知识库
```

外部插件源码与插件自身知识保存在独立 [catrace-plugin 仓库](https://github.com/lanxiuyun/catrace-plugin)，宿主安装到应用数据目录的 plugins 下运行。

## 修改入口

- 调整窗口外壳、导航、滚动或路由：读 [应用外壳](../app-shell/README.md)。
- 调整 React/Vue 桥、主题语言同步或运行时依赖：读 [React 前端架构](../react-migration/README.md)。
- 修改系统设置卡：读 [设置页](../../features/settings/README.md)；插件安装、授权与设置读 [插件中心](../../features/plugin-center/README.md)。
- 修改版本号：读 [版本管理](../../reference/version-management.md)。

前端尺寸统一用 rem；简单界面配置走 Tauri Store，后端业务数据按所属模块进 SQLite；平台相关 Rust 能力用条件编译隔离。
