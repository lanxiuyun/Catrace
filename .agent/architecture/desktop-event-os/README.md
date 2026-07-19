# Desktop Event OS

Catrace 从「休息提醒 App」演进为桌面事件运行时：统一 **Event Protocol + Bus + 渲染适配**，并叠加 **Signal 行为感知**。同仓演进，不重写。

## 五层愿景

```
Plugin Ecosystem  →  Event SDK  →  Event Bus  →  Notification Engine  →  Desktop Runtime (Tauri/Rust)
```

当前（Step 2）只做 **Event Core + Signal Core** 骨架；插件市场 / 外部 HTTP SDK / Toast 全面迁 bus 不在本期。

## 模块布局

```
src-tauri/src/
├── event.rs       # BusEvent 协议 + 生命周期类型
├── bus.rs         # EventRegistry + EventBus + Tauri commands
├── signal.rs      # 前台/键鼠采集与分钟桶
├── db.rs          # records + signal_minutes
├── water.rs       # 首个双写生产者（bus + toast）
└── lib.rs         # 组合：manage / settle / invoke

src/
├── types/event.ts
├── stores/eventHub.ts / pluginRegistry.ts
├── components/settings/SignalSettingsCard.vue
└── api/tauri.ts   # publish/update/resolve + signal commands
```

## 两条线

| 线 | 职责 | 本阶段是否自动互连 |
|----|------|-------------------|
| **Event** | 有什么事、怎么展示、怎么 resolve | Toast 仍是权威 UI；bus 用于观察与协议 |
| **Signal** | 桌面上在发生什么（前台/键/鼠） | **不**自动 `createEvent`，避免噪声 |

## 关键约定

1. Toast 双写时 **不得** 再弹第二张卡（hub 只观察）
2. 系统调用 / DB / emit **不持** ActivityState 或 Registry 锁
3. Action resolve **只记生命周期**，不执行 payload 里的任意命令
4. 键序列默认关、本地 only、可 purge；不上 report
5. 休息判定仍用 legacy `count`（2s 键去重 + 2s 鼠标门闩），不用 raw key_count

## 子文档

- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — **开发计划真源**（里程碑、范围、验收）
- [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md) — 协议字段、commands、双写规则
- [signal-collection-schema-and-privacy.md](signal-collection-schema-and-privacy.md) — 采集、表结构、隐私

## 相关

- [[input-monitoring]] — 旧键鼠监听（逻辑已下沉 signal）
- [[water-reminder]] — 首个 Event 双写生产者
- [[toast-window]] — 仍为可见通知权威
- [[agent-notification]] — 后续迁 bus 的生产者之一
- [[database]] — `signal_minutes` 与 `records`
