# macOS 关掉 Agent Toast 会弹出 Catrace 主窗

**日期**：2026-09-21
**状态**：已修代码，待 macOS 真机验证

## 症状

Claude Code 写完发通知后，点卡片 X，Catrace 主窗被拉到前台。用户在用 Claude Code，主窗不该出现。macOS。

## 根因

Toast 最后一张卡关闭走 `close_reminder_window` → `hide_window_internal`。Windows 用 `SW_HIDE` + `NOACTIVATE`。macOS 回退 `shared_show_window`（`show` + `set_focus`）和 `window.hide()`。AppKit 在 key window `orderOut` 后会把同进程下一扇窗（主窗）变成 key window。

## 修复

macOS 提醒窗：显示 `orderFrontRegardless`，隐藏 `orderOut:`，不 `set_focus`。
