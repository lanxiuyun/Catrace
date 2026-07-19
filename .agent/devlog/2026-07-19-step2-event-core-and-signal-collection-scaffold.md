# 2026-07-19 Step2 Event 内核与 Signal 采集骨架

## Session goal

把 Desktop Event OS 的 Step 2 从讨论落到可演进代码，并沉淀长期开发计划，便于后续按里程碑慢慢做。

## Completed

- Event：`BusEvent` 生命周期、`EventRegistry`、publish/update/resolve commands、前端 hub 水合
- Signal：`signal.rs` 三线程采集、`signal_minutes`、settle 接线、legacy 活跃阈值保留
- 隐私：键序列默认关 + 设置卡 + 保留/purge
- Water 双写 bus + toast（范例生产者）
- 计划文档写入 `.agent/architecture/desktop-event-os/`

## Remaining

- 真机手测 M6 清单（喝水单卡、signal 落库、休息回归）
- 可选：Debug 信号摘要、water resolve 薄桥
- M7：eye / rest / agent 等逐个双写
- Agent 通知原路线图（P5/P7）仍并行

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/event.rs` / `bus.rs` | 协议 + Registry |
| `src-tauri/src/signal.rs` | 新建采集 |
| `src-tauri/src/db.rs` | `signal_minutes` |
| `src-tauri/src/lib.rs` / `water.rs` | 接线与双写 |
| `src/stores/eventHub.ts` 等 | 前端观察 |
| `.agent/architecture/desktop-event-os/*` | 计划真源 |

## Decisions locked this session

- 不重写；同仓双内核
- 光标只存每秒位移；键序列 opt-in
- Event 对外暂限 Tauri command
- Toast 仍为可见权威
