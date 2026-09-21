# 全屏提醒在双屏上只盖住一块屏

**日期**：2026-09-21
**状态**：已修复
**Issue**：[lanxiuyun/Catrace#22](https://github.com/lanxiuyun/Catrace/issues/22)

## 症状

设置全屏提醒后，多显示器环境只在一块屏进入 OS fullscreen，其余屏幕仍可继续工作。

## 根因

`create_fullscreen_window` 只建一扇 `reminder-fullscreen` 窗，再 `enter_fullscreen_on_cursor_monitor`：把窗口移到光标所在监视器后 `set_fullscreen(true)`。操作系统全屏只覆盖窗口当前所在的那一块屏，代码也没有按 `available_monitors()` 为每块屏开窗。

`fullscreen_active` / 休息结算只查这一个固定 label，即使后来加多扇窗也会漏判。

## 修复

1. 按监视器原点生成 `reminder-fullscreen-0`、`reminder-fullscreen-1`…，每块屏一扇独立全屏窗，内容相同。
2. `skip_reminder` / `snooze_reminder` 以及关闭任一全屏窗时关掉全部编号窗。
3. `is_fullscreen_reminder_open` 改为「任意编号全屏窗仍在」。
4. capability 窗口通配改为 `reminder-fullscreen-*`，前端数据仍走 store 键 `reminder-fullscreen`。

为何必须每屏一扇窗：一块 OS fullscreen 窗无法横跨虚拟桌面盖住所有显示器；用虚拟桌面总尺寸拉一张窗会在 DPI 不一致时错位、也盖不住各屏任务栏。
