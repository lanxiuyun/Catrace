# 2026-08-31 定时提醒颜色、提示音与 plugin.audio

## Session goal

让定时提醒每条规则可设 Toast 颜色和提示音；提示音要有默认文件，也允许用户自选。

## Completed

- 规则字段：`accent_color` / `sound_enabled` / `sound_path` / `sound_volume`
- 宿主 `plugin.audio.*` + `plugin.path.getPluginDir()`；rodio 放独立线程
- `plugin_api` 拆成按能力分文件
- 默认音定为偏低两音门铃 wav（G4→C5）
- 本地分提交（未 push）：插件仓库 timer、宿主 API、submodule 指针、plugin_api 拆分

## Remaining

- 用户自行 push 宿主与 catrace-plugin
- 可选：给 `plugin.audio` 做 playback 结束回调（当前靠 `isPlaying` 轮询）

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/plugin_api/` | 音频引擎 + 模块拆分 |
| `src/plugins/pluginApi.ts` | `audio` 与 `path.getPluginDir` |
| `tools/plugin-demo/timer/*` | 颜色、提示音设置与触发播放 |
| `tools/plugin-demo/timer/assets/notify.wav` | 默认提示音 |
