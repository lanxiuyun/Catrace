# 2026-07-10 Toast 多通知堆叠显示不全

## 现象

连续触发多条护眼/喝水提醒后，Toast 窗口内容显示不完整，部分卡片被截断。

## 根因

- 原 `adjustWindowSize()` 基于当前窗口内边距和高度推算新位置，没有以显示器工作区为边界，导致窗口高度可能超出屏幕
- 快速测试时同一类提醒会重复堆叠，进一步加剧高度溢出
- `.toast-stack` 没有滚动能力，超出部分无法查看

## 修复

- `adjustWindowSize()` 改用 `currentMonitor()` 获取当前显示器工作区，窗口高度取「内容高度 + padding」与「工作区高度」的较小值
- 窗口位置基于工作区右下角计算：`x = workAreaRight - width`，`y = workAreaBottom - height`
- `addNotification()` 中对 `eye` / `water` 类通知做去重：同一类只保留最新一条
- `.toast-stack` 增加 `max-height: 100%`、`overflow-y: auto`、隐藏滚动条
- 新增 `scrollStackToBottom()`，通知增加时自动滚动到底部

## 涉及文件

- `src/views/ReminderToast.vue`

## 相关

- [[toast-window]]
