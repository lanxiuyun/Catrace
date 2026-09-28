# 轻量模式（Lightweight Mode）

> 应对 issue [#82](https://github.com/lanxiuyun/Catrace/issues/82)「内存占用偏高」的第一期：让界面不再常驻内存。插件后台 WebView / node sidecar 的裁剪是候补第二期，本期不动。

## 行为

设置入口：设置 → 系统 → 「轻量模式」（`settings` 表 key `lightweight_mode`，默认关）。所有使用点**现读** settings 表，切换即时生效、无需重启。

| 场景 | 普通模式（现状） | 轻量模式 |
|---|---|---|
| 主窗点关闭 | `prevent_close` + `hide()`，renderer 常驻 | 放行关闭，窗口**销毁**（先 `save_window_state` 落盘几何） |
| 重新打开主窗 | 托盘/双击/单实例直接 show | `show_or_rebuild_main_window`：不存在则异步重建（约 1–2s 冷启动），再 show+focus |
| Toast 窗 | 启动预创建隐藏常驻，卡片清空后 hide 复用 | 不预创建；首次通知按需创建，卡片清空后**销毁**（`request_destroy_toast_window`），下次通知重建 |
| 开机自启 + 静默启动 | 启动后 hide 主窗 | 启动即**销毁**主窗，界面完全不驻留 |

不受影响：Signal 采样、每分钟 settle、Event Bus、插件 sidecar、event HTTP——全在 app 级，与窗口无关。休息计时等 sticky 卡期间前端不会调 `closeWindow`（卡片数组非空），窗口不会中途销毁。

## 涉及文件

- `src-tauri/src/lib.rs` — `get/set_lightweight_mode`、`lightweight_mode_enabled`、`attach_main_window_events`、`show_or_rebuild_main_window`；setup 的自启/预创建分支；`close_reminder_window` 的销毁分支
- `src-tauri/src/reminder_toast.rs` — `request_destroy_toast_window`（走 `TOAST_MUTEX` 串行）
- `src-tauri/src/plugin_api/window.rs` — `plugin_api_window_show_main` 改走重建路径
- `src/api/tauri.ts` / `src/components/settings/SystemSettingsCard.vue` / `src/i18n/locales/*` — 开关 UI

## 实现要点（为什么必须这样）

- **主窗重建必须异步 spawn**：Windows 上在 setup/事件回调里同步 build WebView 会阻塞主事件循环（同 toast 重建先例 `ensure_toast_window_visible` 的重建分支）。重建后必须重新 `attach_main_window_events`，否则普通模式下重建的窗口关闭会直接销毁。
- **重建必须先隐藏创建（`visible(false)`）且禁止手动 `restore_state`（2026-09-28 死锁实测）**：初版重建在 `spawn` 任务里 build 且创建即可见 + 手动 `restore_state`，压测第 3 轮稳定复现主线程卡死（白屏未响应，日志停在 rebuild 开始、`main window built` 永不出现，二次启动实例挂在单实例 SendMessage 上）。修复对齐插件后台窗模式（`plugin_window.rs`）：builder 加 `.visible(false)`、build 后再 show；位置/尺寸交给 window-state 插件的 `on_window_ready` 自动恢复（它会 restore 每个新窗口），不要在 build 后手动调 `restore_state`。fullscreen/插件后台窗从未卡死，差异即这两点。
- **主窗重建是新增能力**：原实现所有入口（托盘、单实例、`show_main_window`、插件 `showMain`）都是「get 失败 → 静默无操作」，主窗销毁后这些入口会全部失效，因此统一收敛到 `show_or_rebuild_main_window`。
- **Toast 销毁必须走 `TOAST_MUTEX`**：`close_reminder_window` 与 `ensure_toast_window_visible` 并发时，若销毁不拿锁，会出现「ensure 复用分支刚拿到句柄 → 窗口被销毁」的窗口期，实时 emit 无人渲染。
- **销毁时机由前端保证安全**：`ReminderToast.vue` 只在卡片数组清空后才调 `closeWindow`，后端收到时必然无 sticky 卡；错过的实时事件靠 `getActiveEvents` 水合恢复。
- **window-state API 注意**：`save_window_state` 在 `AppHandleExt` trait（AppHandle 上），`restore_state` 在 `WindowExt` trait（WebviewWindow 上），两者都要显式 use。

## 已知取舍

- 主窗重建冷启动 1–2s（销毁换内存的固有代价）；toast 重建分支的 sleep(100ms)+eval 是既有时序 hack，轻量模式下高频走这条路径，需观察稳定性。
- 自动化验证：PowerShell `PostMessage(WM_CLOSE)` 模拟点 X + 二次启动 exe 触发单实例回调，`IsHungAppWindow` 检测未响应；修复版 3 轮销毁→重建全过，旧版第 3 轮复现卡死。
