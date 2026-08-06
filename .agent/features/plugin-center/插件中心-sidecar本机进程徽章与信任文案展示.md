# 插件中心-sidecar本机进程徽章与信任文案展示

## 要解决什么

含 `sidecar` 的外部插件会起本机子进程。用户需要在插件中心一眼看到：

1. 这个插件会不会跑本机代码（有无 sidecar）
2. 子进程此刻是否在跑
3. 启用即信任意味着什么（WebView + 可选本机进程）

## UI 约定

### 顶栏 `PluginPanelHeader`

- props：`hasSidecar`、`sidecarRunning`（默认 false）
- 有 sidecar 时标题旁 badge：文案 `plugins.external.sidecarBadge`（中文「本机进程」/ 英文「Native」）
- 运行中：绿底 + 绿点；未运行：灰底 + 灰点
- tooltip：`sidecarRunning` / `sidecarStopped`

### 左侧 `PluginNavRail`

- `PluginNavItem` 可选字段：`hasSidecar`、`sidecarRunning`
- 名称行：version 后、异常 Tag 前，插入同文案小 Tag
- 底部「探索更多」下固定 `trustNote`（字号更小、次要色）

### 数据流

```
list_external_plugins / set_external_plugin_enabled
  → ExternalPluginInfo { hasSidecar, sidecarRunning }
  → Plugins.vue plugins / activeHeader
  → PluginNavRail / PluginPanelHeader
```

- `set_external_plugin_enabled` 在 Rust 侧先 `sidecars.sync` 再填 `sidecar_running`，前端不必再等一轮 refresh 才能看到绿点。

## i18n keys

| key | 用途 |
|-----|------|
| `plugins.external.sidecarBadge` | badge 短文案 |
| `plugins.external.sidecarRunning` | tooltip 运行中 |
| `plugins.external.sidecarStopped` | tooltip 未运行 |
| `plugins.external.trustNote` | 信任模型（含 sidecar=本机子进程） |

## 不要做

- 不要用第二套状态轮询；以 list/toggle 返回值为准，用户点刷新即可更新。
- badge 只诊断，不代替启用开关，也不拦截插件。

## 相关

- [[desktop-event-os]] [sidecar-storage往返协议与Plugins-UI运行态约定.md](../../architecture/desktop-event-os/sidecar-storage往返协议与Plugins-UI运行态约定.md)
- [插件状态排序和统一详情顶栏实现约定.md](插件状态排序和统一详情顶栏实现约定.md)
