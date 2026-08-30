# 定时提醒：Toast 颜色与提示音

每条规则可自定义 Toast 强调色，以及触发时是否播放音频。颜色走卡片 CSS 变量；声音走宿主 `plugin.audio`，不走 `plugin.shell.beep()`。

## 规则字段

| 字段 | 默认 | 含义 |
|------|------|------|
| `accent_color` | `""` | `#rgb` / `#rrggbb`；空 = 插件默认紫 |
| `sound_enabled` | `false` | 是否在触发时播放 |
| `sound_path` | `""` | 自定义音频绝对路径；空 = 插件包 `assets/notify.wav` |
| `sound_volume` | `0.8` | `0–1` |

护眼内置规则标题/模式/休息重置仍锁定；颜色和声音可改。

## 颜色怎么到卡片

1. `background.mjs` / 测试按钮 `publish` 时把 `accent_color` 写入 `payload`。
2. `ui.mjs` 读 `event.payload.accent_color`，覆盖 `.timer-card` 的 `--accent` / `--title` / `--body` / `--bg`。
3. 非法或空值回退默认紫。宿主 Toast 外壳仍是白底，只改插件卡内部主题。

## 声音在何时播

**规则触发时**（`publishDue` 与设置页「测试」），不是卡片 mount。

```js
const pluginDir = await plugin.path.getPluginDir()
const soundPath = rule.sound_path.trim() || `${pluginDir}/assets/notify.wav`
await plugin.audio.play(soundPath, { volume: rule.sound_volume })
```

失败只打 `plugin.log.warn`，不挡 Toast。

## 默认音频

`tools/plugin-demo/timer/assets/notify.wav`：偏低的两音门铃（G4 → C5）。整个插件目录会随 `scripts/sync-plugins.mjs` 打包，无需写进 `manifest.json`。

自定义支持 wav / mp3 / ogg / flac（rodio 默认解码）。路径存配置，不要把音频 base64 塞进 `plugin.config`。

## 不要用的路

- `plugin.shell.beep()`：依赖 Windows 声音方案，用户常听不到。
- Toast 卡片里 Web Audio：卡片 Blob 无法相对引用插件目录文件；也不该把默认音再合成一遍。

详见 [[plugin-audio-rodio独立线程与getPluginDir]]。
