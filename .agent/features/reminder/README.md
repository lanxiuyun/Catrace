# Block 切分与提醒

根据键鼠活跃记录，按滑动窗口切分活跃/休息 block，满足条件时弹出提醒。

## 涉及文件

- `src-tauri/src/db.rs` — block 切分算法 `compute_time_blocks` + 提醒判定 `should_notify`
- `src-tauri/src/lib.rs` — 每分钟结算时调用提醒检查，触发通知
- `src-tauri/src/reminder.rs` — 提醒状态机 `ReminderState`（snooze / skip）
- `src/utils/timeBlocks.ts` — 前端 block 切分（概览视图使用）

## 核心算法

**block 切分**：从首个有记录时间点向后扫描，以 `window_minutes` 为窗口：
- 窗口内遇连续 `break_minutes` 休息 → 休息 block
- 窗口内无足够连续休息 → 活跃 block
- 切分仅考虑已发生分钟（索引 ≤ nowIdx），未来 null 不当作连续休息

**提醒判定**（`should_notify`）：
- 前一已完成 block 为活跃 → 提醒
- 前一已完成 block 为休息，当前进行中 block ≥ `window_minutes` → 提醒
- 其余不提醒

**休息即静音**：当前分钟在休息时，不分发通知且清除 snooze。

**自动间隔提醒**：通知触发后自动设置 `snooze_interval_minutes`（默认 3min）间隔；用户手动 5/10 分钟覆盖自动值。

## 提醒操作（进程级状态，重启后重置）

| 操作 | 效果 |
|------|------|
| 跳过本次 | 当前 block 完成前不再提醒 |
| 5分钟后提醒 | 推迟 5 分钟 |
| 10分钟后提醒 | 推迟 10 分钟 |
| 自动间隔提醒 | 触发后自动按 `snooze_interval_minutes` 间隔再弹 |

## 提醒场景速查（`window=45, break=5, snooze=3`）

> 提醒只在**当前分钟活跃**时检查。休息分钟不检查。

| 场景 | 结果 |
|---|---|
| 活跃 45min → 继续活跃 | 0:45 弹 → 每 3min 再弹 |
| 活跃 45min → 休息 1min → 活跃 | 休息时不催，复工后弹 |
| 活跃 45min → 休息 4min → 活跃 | 休息不够，复工即催 |
| 活跃 45min → 休息够 5min | 不提醒 |
| 活跃 45min → 休息 5min → 再活跃 45min | 1:35 弹 |
| 活跃 40min 进行中 | 不提醒 |
| 全天休息 | 不提醒 |


## UI 入口

- **功能插件 → 久坐**：`src/components/plugins/RestPluginPanel.vue`
  - 节奏：`window_minutes` / `break_minutes` / `snooze_interval_minutes`
  - 方式：`reminder_mode`（toast / fullscreen）
  - 文案：`reminder_title` / `reminder_body`
  - 全屏背景与测试通知
- **不再**放在系统设置通知卡（`NotificationSettingsCard` 已删除）
- 详见 [[settings]] 与 [久坐提醒配置从系统设置收敛到-RestPluginPanel.md](../settings/久坐提醒配置从系统设置收敛到-RestPluginPanel.md)

## 配置

| 配置名 | 说明 | 默认值 |
|--------|------|--------|
| `window_minutes` | 工作窗口（分钟） | 45 |
| `break_minutes` | 连续休息断开阈值（分钟） | 5 |
| `snooze_interval_minutes` | 重复提醒间隔（分钟） | 3 |

## 测试

`db.rs` 14 个 block 切分与提醒逻辑测试 + `reminder.rs` 4 个状态机测试。详见 [test-strategy.md](../reference/test-strategy.md)。
