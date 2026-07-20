# 久坐测试连点卡死：Toast 窗口并发 show / resize

## 症状

功能插件 → 久坐提醒 → **发送测试** 连点几次，应用假死/卡死。  
产品预期只是「再叠一张通知」，但实现路径在快速连点时会把窗口 API 打爆。

## 根因（不是“堆叠概念复杂”，是并发窗口操作）

每次测试点击大致会：

1. `test_notification` 发 `catrace-rest-timer` +（曾）`show_reminder_no_activate`
2. `show_notification` → `bus.publish`（`dedupe_key` 原先**存了不用**，每次新 UUID）
3. `ensure_toast_window_visible` → spawn + `TOAST_MUTEX` + eval + Win32 show
4. 前端 `handleBusEvent` → `addNotification` → **每次** `await adjustWindowSize()`（`setSize`/`setPosition`/`currentMonitor`）

连点 = 多卡 + 多次 ensure/show + 多个 in-flight resize 叠在一起。  
与 [.agent/bugs/2026-07-10-toast-concurrent-crash.md](2026-07-10-toast-concurrent-crash.md) 同类（窗口操作并发），rest 测试路径此前**没有** water/eye 的 1s debounce。

## 当前处理（commit `b72bb45`）— 先限流稳住

| 层 | 做法 |
|----|------|
| 后端 | `test_notification` 1s 防抖（`LAST_TEST_NOTIFICATION_AT`） |
| 前端按钮 | `RestPluginPanel` 点完锁 1s |
| Bus | 相同非空 `dedupe_key` 的 active 事件先 `Superseded` 再发新事件 |
| 真实 rest | `boundary != 0` → `dedupe_key = reminder.rest.due:{boundary}` |
| 测试 rest | `boundary == 0` → **不设** dedupe_key（限流放开后可堆叠） |
| FE | `adjustWindowSize` single-flight + 队列；同 key 可原地刷新 |
| ensure | 窗口**已可见**则直接 return，少做 show/eval |

## 后续目标（用户明确要）

**随便点也不崩，且测试通知正常往上堆叠**——不能只靠限流“躲”。  
需要把 ensure/show/resize 路径做成真正可连点堆叠的无限制硬路径（限流是权宜之计）。

## 手测

1. 发送测试 1 次：toast +（toast 模式）休息计时卡
2. 连点：约 1s 成功 1 次，不卡死
3. 稍后/跳过正常；主窗不抢焦点

## 手测结论（2026-07-20）

- **M6 久坐主路径：已通过**（用户确认功能正常）
- 当前依赖 1s 限流；**无限制连点堆叠抗崩延后**

## 涉及文件

- `src-tauri/src/lib.rs` — test 防抖、rest dedupe_key 策略
- `src-tauri/src/bus.rs` — publish 同 key supersede
- `src-tauri/src/reminder_toast.rs` — ensure 可见短路
- `src/views/ReminderToast.vue` — adjust single-flight、同 key 刷新
- `src/components/plugins/RestPluginPanel.vue` — UI 1s 锁

## 相关

- [[toast-window]] · [[desktop-event-os]] · [2026-07-10-toast-concurrent-crash.md](2026-07-10-toast-concurrent-crash.md)
