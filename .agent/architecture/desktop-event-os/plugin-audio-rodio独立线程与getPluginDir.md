# 插件音频 API：rodio 独立线程与 getPluginDir

外部插件播放本地音频文件的宿主原语。Rust 只播路径上的文件，不内嵌业务提示音。

## JS 表面

```ts
plugin.audio.play(path, { volume?, repeat?, speed? }) // → playbackId
plugin.audio.stop / pause / resume(playbackId)
plugin.audio.setVolume(playbackId, volume)
plugin.audio.isPlaying(playbackId)
plugin.path.getPluginDir() // 插件安装目录，用来拼 assets/
```

实现：`src/plugins/pluginApi.ts` → `src-tauri/src/plugin_api/audio.rs` + `host.rs` 的 `plugin_api_get_plugin_dir`。

## 为什么独立线程

`rodio::OutputStream` 包着 `cpal::Stream`，**`!Send + !Sync`**，不能放进 `OnceLock` / Tauri `State`。正确做法：

1. 专用线程 `plugin-audio` 持有 `OutputStream` 直到进程退出。
2. 命令经 `mpsc` 把 play/stop/… 送到该线程。
3. 每个 playback 一个 `Sink`（可叠播）；播完从 map 里丢掉。

不要在 Tauri command 里 `Sink::sleep_until_end()`。

## 资源路径

- `plugin.path.getPluginDir()` 来自 `PluginManager::plugin_dir`，即 `<app_data>/plugins/<id>/`。
- Debug：该目录 junction 到 `tools/plugin-demo/<id>/`，改 wav 立刻可见。
- Release：`sync-plugins.mjs` 整目录复制（只排除 `.git`），`assets/` 会进包。

卡片 UI 以 Blob 加载，**相对路径 `./assets/x.wav` 解析不到**。播放必须用绝对路径 + `plugin.audio.play`。

## 与 beep 的边界

`plugin.shell.beep()` 仍是系统蜂鸣，不保证有声。要「能听见的提示音」用 `plugin.audio`。

## 文件布局

```
src-tauri/src/plugin_api/
  mod.rs        require_plugin_api + 再导出
  audio.rs      音频命令 + 引擎线程
  host.rs       path.get / getPluginDir / env / http / log …
  clipboard.rs / dialog.rs / events.rs / shell.rs / storage.rs / window.rs
```

不要再往单个 `plugin_api.rs` 里堆能力。不要为某个插件加 `plugin_timer_play_sound` 这类专用 command。
