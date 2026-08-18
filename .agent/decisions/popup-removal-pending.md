# popup / fullscreen 提醒模式收敛（阶段性）

## 状态

Partial — 产品侧暂不支持；运行时强制 toast；窗口代码仍保留

## 背景

历史提醒模式含 `popup` / `fullscreen` / `toast`。2026-07-21 起久坐插件先只做通知提醒：

- `toast` — 唯一启用路径（Event Bus → Toast 窗）
- `fullscreen` / `popup` — UI 入口关闭；`show_notification` 不再分支；mode API 钳制为 toast

## 已做

- `RestPluginPanel` 去掉提醒方式/全屏配置区块
- 面板挂载时若 mode ≠ toast 则写回 toast
- `rest_plugin::show_notification` 固定 publish toast 事件
- `get_reminder_mode` / `set_reminder_mode` 非 toast 归一为 toast

## 仍待

- 彻底删除 popup/fullscreen 窗口与相关 settings API（确认无回归需求后再做）
- 清理 i18n 中仅 fullscreen 使用的文案（可随删除一并清）

## 相关

- [[settings]] RestPluginPanel 收敛
- [[reminder]]
- [[fullscreen-reminder]]
