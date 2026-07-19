# Desktop Event OS

Catrace 从「休息提醒 App」演进为桌面事件运行时：统一 **Event Protocol + Bus + Toast 渲染适配**，并叠加 **Signal 行为感知**。同仓演进，不重写。

## 五层愿景

```
Plugin Ecosystem  →  Event SDK  →  Event Bus  →  Notification Engine  →  Desktop Runtime (Tauri/Rust)
```

当前：Event Core + Signal Core + **Toast 内容全量经 Bus**；插件市场 / 外部 HTTP SDK 仍属后续 Phase。

## 模块布局

```
src-tauri/src/
├── event.rs / bus.rs     # 协议 + Registry + publish/update/resolve
├── signal.rs / db.rs     # 行为采集 + signal_minutes
├── water.rs / eye.rs     # 生产者：只 bus.publish
├── reminder_toast.rs     # ensure 窗口 + agent/update/permission → bus
├── agent_hook.rs         # 仍调 create_agent_*（内部已改 bus）
└── lib.rs                # rest toast 模式 → bus；settle 组合

src/
├── views/ReminderToast.vue   # 唯一内容渲染：listen catrace:event
├── stores/eventHub.ts        # 主窗观察（不渲 Toast）
├── stores/pluginRegistry.ts
├── plugins/registerBuiltins.ts
└── types/event.ts
```

## 两条线

| 线 | 职责 | 互连 |
|----|------|------|
| **Event** | 有什么事、怎么展示、怎么 resolve | Toast 订阅 bus 渲染内容 |
| **Signal** | 桌面上在发生什么 | **不**自动 createEvent |

## 关键约定

1. **内容只走 Bus**：rest / water / eye / agent / permission / update 均 `publish`；禁止再 `eval addToastNotification` 注入内容
2. **窗口与内容分离**：`ensure_toast_window_visible` 只管窗口；`publish` 顺带 ensure
3. **主窗 hub 不渲第二张卡**；Toast 窗自己 listen + `get_active_events` 水合
4. Action resolve **只记生命周期**；业务（snooze/喝水/permission HTTP）仍在既有 command
5. 仍用专用通道：`catrace-rest-timer`、`dismissAgentSession`（eval 仅销项）
6. 键序列默认关；休息判定用 legacy `count`

## 子文档

- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 开发计划真源
- [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md) — 协议、commands、生产者表
- [toast-renders-only-from-event-bus.md](toast-renders-only-from-event-bus.md) — Toast 订阅线与例外通道
- [signal-collection-schema-and-privacy.md](signal-collection-schema-and-privacy.md) — Signal / 隐私

## 相关

- [[toast-window]] · [[agent-notification]] · [[water-reminder]] · [[input-monitoring]] · [[database]]
