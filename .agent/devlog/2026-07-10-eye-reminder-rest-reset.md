# 2026-07-10 护眼提醒触发逻辑改为「上次提醒与真正休息取较晚者」

## 会话目标

修正护眼提醒：用户休息一段时间后回来，护眼计时应当从休息结束时重新算，而不是接着休息前的累积。

## 完成项

- `eye::check_and_notify` 触发基准改为 `max(eye_last_reminder_ts, last_real_rest_ts)`：「真正休息后」等价于护眼计时重置
- `Db` 新增 `get_last_real_rest_ts(break_minutes)` 复用主提醒的 `break_minutes` 阈值，并补单测
- `lib.rs` 结算循环把 active 守卫上移到调用点，eye/water 模块内不再判断 `!active`

## 设计取舍

中间曾尝试让 lib.rs 在 `else`（当前分钟休息）分支直接改写 `eye_last_reminder_ts`，性能最好但被否决：把 eye 的内部 key 与「真正休息后重置」业务规则泄漏到 settle 循环，eye 不再自包含。最终用 max 方案——概念等价、eye 完全自包含，代价是每分钟多扫一次今日记录（命中 break_minutes 连休即停，可忽略）。

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `src-tauri/src/db.rs` | 新增 `get_last_real_rest_ts` + 测试 |
| `src-tauri/src/eye.rs` | `check_and_notify` 去掉 `active` 参数，基准取 max |
| `src-tauri/src/water.rs` | `check_and_notify` 去掉 `active` 参数 |
| `src-tauri/src/lib.rs` | 调用点用 `if active {}` 包住 water/eye |

## 验证

`cargo check` + `cargo test`（33/33）通过。

## 相关

- [护眼提醒](../features/eye-reminder/README.md)
- [数据库](../architecture/database/README.md)
