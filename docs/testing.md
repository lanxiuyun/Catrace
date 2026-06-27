# 测试策略

> 详细测试清单。快速摘要：`src-tauri/src/` 下 `db.rs`、`reminder.rs`、`report.rs`、`water.rs`、`media_audio.rs` 共 31 个单元测试；前端无自动化测试。

## Rust 单元测试分布

共 **31** 个单元测试：

- `db.rs`：16 个
- `reminder.rs`：4 个
- `report.rs`：4 个
- `water.rs`：3 个
- `media_audio.rs`：4 个

## Block 切分（`db.rs`）

| 测试名 | 说明 |
|---|---|
| `test_compute_blocks_basic` | 45 活跃 + 5 休息 + 45 活跃，验证切分结果 |
| `test_compute_blocks_all_active` | 全活跃记录切成多个 Active block |
| `test_compute_blocks_all_rest` | 全休息记录切成一个 Rest block |

## 提醒逻辑（`db.rs`）

| 测试名 | 覆盖场景 | 说明 |
|---|---|---|
| `test_no_notify_empty` | 场景 8 | 全天无记录 → should_notify=false |
| `test_no_notify_during_ongoing` | 场景 6 | 活跃 40min（未满窗口）→ should_notify=false |
| `test_no_notify_after_rest_block` | — | 休息 block 完成后 → should_notify=false |
| `test_no_notify_rest_then_short_active` | 场景 7 | 活跃 40min → 休息 5min → 再活跃 3min → should_notify=false |
| `test_notify_after_active_block_completes` | 场景 1 | 活跃 45min → 继续活跃 → should_notify=true |
| `test_notify_active_then_rest_until_break` | 场景 4 | 活跃 45min → 休息，前 4min should_notify=true，第 5min false |
| `test_notify_active_then_keep_active` | 场景 1 延长 | 活跃 45min → 继续活跃 10min → should_notify 持续 true |
| `test_notify_short_rest_then_active` | 场景 2 | 活跃 45min → 休息 1min → 再活跃 45min → should_notify=true |
| `test_notify_after_rest_then_active` | 场景 5 | 活跃 40min → 休息 5min → 再活跃 45min → should_notify=true |
| `test_notify_full_cycle_active_rest_active` | 场景 5 完整 | 活跃 45min → 休息 5min → 再活跃 45min，验证完整周期 |
| `test_notify_no_duplicate_boundary` | 场景 1 | 同一数据多次调用，boundary 稳定 |

## 连续休息时长（`db.rs`）

| 测试名 | 说明 |
|---|---|
| `test_get_current_rest_streak_basic` | 无记录、纯活跃、末尾连续休息、休息被打断、再休息等场景下的连续休息时长计算 |

## 喝水记录（`db.rs`）

| 测试名 | 说明 |
|---|---|
| `test_water_records` | 记录喝水、同分钟去重、今日查询、删除今日最近一次、不跨天删除 |

## 提醒状态机（`reminder.rs`）

| 测试名 | 说明 |
|---|---|
| `test_reminder_state_snooze` | `is_snoozed()` 正确判断未来/过去时刻 |
| `test_reminder_state_skip` | `is_skipped()` 在不同 boundary 下的行为 |
| `test_snooze_interval_overridden_by_user_choice` | 用户点击「5分钟」会覆盖自动设置的 3 分钟 snooze |
| `test_snooze_auto_interval_expiry` | 自动 snooze 间隔到期后不再处于 snoozed 状态 |

## 启动事件上报（`report.rs`）

| 测试名 | 说明 |
|---|---|
| `test_version_code` | 版本号 `26.6.18` 转换为 `260618` |
| `test_map_target` | `macos` → `darwin`，其他平台保持原值 |
| `test_generate_signature_format` | 签名输出为 32 位十六进制字符串 |
| `test_generate_signature_matches_official_rule` | 与文档签名示例规则一致 |

## 喝水提醒状态机（`water.rs`）

| 测试名 | 说明 |
|---|---|
| `test_water_state_snooze` | `is_snoozed()` 正确判断未来/过去时刻 |
| `test_water_state_can_send_reminder` | `can_send_reminder()` 1 秒去重 |
| `test_water_state_record_drink_clears_snooze` | 喝水后清除 snooze |

## 媒体音频检测（`media_audio.rs`）

| 测试名 | 说明 |
|---|---|
| `test_is_any_session_active_respects_whitelist` | 非排除列表中的音频会话使 media_audio 判定为活跃 |
| `test_is_any_session_active_all_whitelisted` | 全部在排除列表内时判定为不活跃 |
| `test_is_any_session_active_no_sound` | 无音频输出时判定为不活跃 |
| `test_parse_whitelist_text_ignores_comments_and_empty` | 排除列表文本解析忽略注释与空行 |

## 前端测试

目前无自动化测试，依赖手动验证（`pnpm tauri dev` 观察界面）。
