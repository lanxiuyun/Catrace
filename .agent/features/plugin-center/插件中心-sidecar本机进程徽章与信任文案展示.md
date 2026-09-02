# 插件中心不展示本机进程技术标签

## 现行约定

插件中心只展示功能名、说明、版本和异常标签。含 sidecar 的外部插件**不**再显示「本机进程 / Native」badge，也不展示运行中 / 未运行状态点。

前端不再读取、传递：

- `hasSidecar` / `sidecarRunning`
- i18n：`plugins.external.sidecarBadge` / `sidecarRunning` / `sidecarStopped`

`ExternalPluginInfo` 也不再序列化 `hasSidecar` / `sidecarRunning`。sidecar 仍由 `PluginSidecarManager` 按启用状态启停，只是不把运行态画在插件页上。

## 不要做

- 不要在导航列表或详情顶栏加回「本机进程」类技术标签。
- 不要为了 UI 再给 list/toggle API 注入 `sidecar_running`。

## 相关

- [[desktop-event-os]] [sidecar-storage往返协议与Plugins-UI运行态约定.md](../../architecture/desktop-event-os/sidecar-storage往返协议与Plugins-UI运行态约定.md)
- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md)
