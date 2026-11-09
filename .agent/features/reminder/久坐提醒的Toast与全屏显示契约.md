# 久坐插件：toast 与 fullscreen

## 一句话

久坐提醒可选 Event Bus toast，或光标所在监视器上的置顶全屏倒计时窗。

## 行为契约

1. **默认仍是 Toast** — `reminder.rest.due` / `reminder.rest.timer` 经 bus 发布，hub 不渲染第二张卡。
2. **`show_notification` 读 `reminder_mode`** — `fullscreen` 走 `create_fullscreen_window`；其它走 toast。
3. **mode API** — 只持久化 `toast` / `fullscreen`。
4. **测试路径** — `testNotification` 跟当前 mode：fullscreen 只出全屏窗，不叠 rest-timer toast。
5. **全屏期间** — `fullscreen_active` 让结算记休息；不 emit rest-timer toast。独立全屏窗：先落到光标监视器，再 OS `set_fullscreen(true)`，不走 toast 的 SetWindowPos。

## 涉及文件

| 文件 | 职责 |
|------|------|
| [RestSettings.tsx](../../../src/app/pages/plugins/RestSettings.tsx) | 节奏 + 方式 + 全屏背景 + 内容 + 测试 |
| `src-tauri/src/rest_plugin.rs` | mode 分支 `show_notification` |
| `src-tauri/src/lib.rs` | `get/set_reminder_mode`；独立全屏窗钉光标监视器后 OS fullscreen |
| `src/app/windows/ReminderFullscreen.tsx` | 全屏 UI + MM:SS 倒计时 |

## RestSettings 当前区块

1. **节奏** — `window_minutes` / `break_minutes` / `snooze_interval_minutes`
2. **方式** — `reminder_mode` toast / fullscreen；fullscreen 下背景图 / 透明度 / 填充
3. **内容** — `reminder_title` / `reminder_body`
4. **测试** — `testNotification`（按钮在内容区外）

启用开关调用 `set_rest_plugin_enabled`，与节奏、文案一起保存在 Store 的 `plugin_config:rest`；提醒方式与全屏窗口参数由宿主 SQLite settings 保存。

## 相关

- 配置入口：[设置页](../settings/README.md)
- 插件边界：[rest-reminder-builtin-plugin-boundary.md](../../architecture/desktop-event-os/rest-reminder-builtin-plugin-boundary.md)
