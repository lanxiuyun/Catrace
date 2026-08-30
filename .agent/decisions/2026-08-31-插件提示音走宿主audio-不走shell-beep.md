# 2026-08-31 插件提示音走宿主 plugin.audio，不走 shell.beep

## 背景

定时提醒需要「默认 wav + 用户自选文件」。先试了 `plugin.shell.beep()`（Windows `MessageBeep`），开关已保存但经常无声，因为依赖系统声音方案。卡片 Web Audio 振荡器听得见，但无法换成用户文件，Blob 卡也读不到插件目录相对路径。

## 决策

1. 宿主增加可复用 `plugin.audio.*`（rodio，独立线程持有 `OutputStream`）。
2. 增加 `plugin.path.getPluginDir()`，插件拼 `assets/notify.wav`。
3. 声音在 **background 触发 / 设置页测试** 时播放，与 Toast 发布同步，不在卡片 `created()`。

## 后果

- 依赖 `rodio`（桌面端），包体和编译时间略增。
- 音频文件路径存规则配置，不把文件内容写入 SQLite。
- `plugin.shell.beep()` 保留给「系统蜂鸣」场景，不当作提示音方案。
