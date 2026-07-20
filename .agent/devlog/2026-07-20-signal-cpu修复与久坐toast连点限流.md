# 2026-07-20 Signal CPU 修复与久坐 Toast 连点限流

## Session goal

重构后空闲 CPU 过高；久坐测试连点卡死；沉淀知识并分 commit。

## Completed

- **CPU**：去掉 `DeviceEvents` 100µs 轮询 → 50ms `get_keys` 边沿（`f3345ed`）
- **Toast 连点**：1s 测试限流 + bus `dedupe_key` supersede + adjust single-flight + ensure 可见短路（`b72bb45`）
- 用户确认 CPU 已下降；同意**先限流**，无限制堆叠抗崩后续再做
- **M6 久坐主路径手测已通过**（用户确认）
- water/eye 仍强制关闭（`d9a319a`，此前 commit）

## Pending

- Toast **无限制连点堆叠且不崩**（去掉限流依赖）— **延后**，当前 1s 限流可接受
- ~~M6 久坐主路径手测~~ — **已通过**（用户确认功能正常；喝水/护眼 UI 仍 N/A）
- 可选：提交 `.agent/` 知识沉淀本身

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/signal.rs` | 50ms 键盘边沿采样 |
| `src-tauri/src/lib.rs` | test 1s 防抖；rest dedupe_key 按 boundary |
| `src-tauri/src/bus.rs` | publish 同 key → Superseded |
| `src-tauri/src/reminder_toast.rs` | ensure 已可见短路 |
| `src/views/ReminderToast.vue` | adjust 单飞；同 key 原地刷新 |
| `RestPluginPanel.vue` | 按钮 1s 锁 |

## Commits

- `f3345ed` fix(signal): replace DeviceEvents busy-poll with 50ms key edge sampling
- `b72bb45` fix(toast): rate-limit rest test and harden rapid toast updates
