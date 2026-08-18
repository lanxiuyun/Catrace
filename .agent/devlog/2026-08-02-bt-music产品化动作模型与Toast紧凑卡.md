# 2026-08-02 bt-music 产品化动作模型与 Toast 紧凑卡

## Session goal

bt-music 从演示轮询收成产品：事件监听、互斥连接/断开动作、紧凑 Toast、进度条与热更新可用。

## Completed

- 轮询 → `Win32_DeviceChangeEvent` + 低延迟 PnP/IsConnected 探针
- Settings 产品化：去掉关键词/开发者术语；连接/断开互斥动作；驻留内嵌
- Toast：图标 +「设备名 已连接」+ 启动/关闭；进度条与宿主 hover 同源 CSS
- `set_plugin_config` 保留 enabled；exe 启动 activate/最小化恢复；close/pause 动作
- 外部插件 Toast 热更新（mtime fingerprint + generation + reload 顺序，已有专文）

## Remaining

- 真机：IsConnected 相对音频的尾延迟；图标提取失败机型
- M15.3 storage + Plugins UI sidecar 运行态

## Key file changes

| File | Change |
|------|--------|
| `tools/plugin-demo/bt-music/*` | 事件监听、动作、紧凑 UI |
| `src-tauri/src/plugins.rs` | set_plugin_config 保 enabled；content_mtime_ms |
| `src/views/toastWindows/ReminderToast.vue` | totalMs 不在 resume 时覆盖；reload 监听 |
| `src/components/pluginHostCardCache.ts` | generation 热更 |
| `.agent/features/bt-music/*` | 约定与子文档 |
