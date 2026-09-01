# 配置项速查

## 提醒相关

| key | 说明 | 默认值 |
|-----|------|--------|
| `window_minutes` | 工作窗口（分钟） | 45 |
| `break_minutes` | 连续休息断开阈值（分钟） | 5 |
| `snooze_interval_minutes` | 重复提醒间隔（分钟） | 3 |
| `reminder_mode` | toast / popup / fullscreen | toast |

## 全屏相关

| key | 说明 | 默认值 |
|-----|------|--------|
| `fullscreen_bg_image` | 背景图路径 | bundled catrace.png |
| `fullscreen_opacity` | 遮罩透明度 (0-100) | 80 |
| `fullscreen_fit_mode` | contain / cover / fill | contain |
| `fullscreen_element_transforms` | 元素变换 JSON | 默认居中 |

## 系统

| key | 说明 | 默认值 |
|-----|------|--------|
| `silent_start` | 开机自启时隐藏主窗口 | false |
| `video_active_enabled` | 媒体计入活跃 | true |
| `media_whitelist` | 排除列表 JSON 数组 | 默认系统进程 |
| `locale` | zh-CN / en-US | 自动检测 |
| `update_source` | 更新源：`auto` / `ghfast` / `ghddlc` / `ghproxy` / `github` | auto |
