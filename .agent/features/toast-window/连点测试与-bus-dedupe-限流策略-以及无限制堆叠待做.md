# 连点测试与 bus dedupe / 限流策略（无限制堆叠待做）

## 现状约定

### 手动「发送测试」（久坐）

- 入口：`功能插件 → 久坐提醒 → 发送测试` → `test_notification`
- **1 秒限流**（后端 + 按钮）是当前防卡死手段
- toast 模式额外发 `catrace-rest-timer`（休息计时卡，前端已合并同 kind 刷新）
- 测试 `boundary = 0`：**不写** `dedupe_key`，与真实结算区分；放开限流后应可堆叠多张 rest 测试卡

### 真实久坐 due

- `boundary != 0`
- `dedupe_key = reminder.rest.due:{boundary}`
- Bus：同 key 的旧 active → `resolution.kind = superseded` 并 emit，再 publish 新事件
- FE：若带 `dedupe_key` 且本地已有同 key 卡 → **原地刷新**（改 eventId/文案/计时），避免 remove+add 抖窗口

### 窗口路径加固（与是否限流正交）

1. `ensure_toast_window_visible`：已 `is_visible` 则 no-op
2. `adjustWindowSize`：single-flight；并发调用只记 `adjustQueued`，结束后再跑一轮
3. 动画中（`isAnimating`）不丢 resize，改为排队

## 产品意图 vs 工程债

| 意图 | 当前 |
|------|------|
| 用户连点测试应堆叠通知、不崩 | 先 1s 限流；堆叠硬路径**延后**；M6 久坐主路径已手测通过 |
| 真实同 boundary 不应刷屏 | bus dedupe + FE 原地刷新 |

## 改限流 / 改堆叠时看这些点

1. `lib.rs` `LAST_TEST_NOTIFICATION_AT` 与 `RestPluginPanel` 的 1s
2. `show_notification` 里 `dedupe_key` 对 `boundary==0` 的分支
3. `bus::EventRegistry::publish` 的 supersede 列表 + 先 emit 旧再 emit 新
4. `ReminderToast` 的 `dedupeKey` / `adjustInFlight`
5. 不要在 `test_notification` 里与 bus ensure **双路径** `show_reminder_no_activate`（易并发）

## 相关 bug

- [2026-07-20-久坐测试连点卡死-toast-窗口并发show与resize.md](../../bugs/2026-07-20-久坐测试连点卡死-toast-窗口并发show与resize.md)
