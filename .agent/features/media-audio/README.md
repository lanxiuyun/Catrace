# 媒体音频检测

Windows WASAPI 音频检测，将播放视频/音乐的时间计入活跃。

## 涉及文件

- `src-tauri/src/media_audio.rs` — WASAPI 音频会话枚举 + 排除列表管理

## 行为

- 每分钟结算时，若键鼠活动 < 3 但媒体播放中 → 仍算活跃
- **Windows**：WASAPI 枚举音频输出会话，检查进程名是否在排除列表中。不要加回 GSMTCSM：很多播放器不暴露会话，Playing/Paused 也不等于「用户在看屏幕」。无声看视频会被判不活跃，接受。
- **macOS / Linux**：`is_media_active()` 恒返回 false，待跨平台音频 API

## 排除列表

- 配置 key：`media_whitelist`（JSON 字符串数组）
- 开关 key：`video_active_enabled`（历史命名，兼容旧设置）
- 排除列表在设置页 MediaSettingsCard 中以纯文本编辑，每行一个进程名

## 测试

4 个测试：排除列表过滤 / 全排除 / 无音频 / 文本解析忽略注释空行。
