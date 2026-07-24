# Desktop Event OS

Catrace 从「休息提醒 App」演进为桌面事件运行时：统一 **Event Protocol + Bus + Toast 渲染适配**，并叠加 **Signal 行为感知**。同仓演进，不重写。

## 五层愿景

```
Plugin Ecosystem  →  Event SDK  →  Event Bus  →  Notification Engine  →  Desktop Runtime (Tauri/Rust)
```

当前：**第二阶段已完成真机验收，第三阶段 M11 插件后台运行时也已通过启动、禁用、重新启用和 10 秒 Toast 真机验收**。M11 为每个启用插件创建独立隐藏 WebView，运行 `background.mjs`，并提供 publish/activity/storage/logger 最小宿主能力。M11.1 已删除插件 manifest 的 `permissions` 字段，保留身份/所有权/命名空间隔离；连续高内存、连续磁盘写入、单次大数据或刷事件都会记录插件 id 并显示“异常” Tag；不限流、不丢弃。**不做插件市场。**

## 模块布局

```
src-tauri/src/
├── event.rs / bus.rs     # 协议 + Registry + publish/update/resolve
├── event_http.rs         # M9/M10 外部 Event API 127.0.0.1:23457（plugin_id）
├── plugins.rs            # M10/M11 manifest 扫描、启用、UI/background source
├── plugin_window.rs      # 每插件隐藏 WebView 生命周期与非阻塞同步
├── plugin_commands.rs    # publish/activity/storage/logger 身份、所有权与输入边界
├── signal.rs / db.rs     # 行为采集 + signal_minutes
├── water.rs / eye.rs     # 生产者：只 bus.publish
├── reminder_toast.rs     # ensure 窗口 + agent/update/permission → bus
├── agent_hook.rs         # :23456 agent hook（与 event_http 分离）
└── lib.rs                # rest toast 模式 → bus；settle 组合；启动两 HTTP

src/
├── views/ReminderToast.vue   # 唯一内容渲染：listen catrace:event（sdk + plugin）
├── views/Plugins.vue         # 内置 + 外部插件列表 / 启用 / 测试通知
├── views/PluginHost.vue      # plugin-bg-<id> 宿主页，Blob import background.mjs
├── components/SdkToastCard.vue / PluginHostCard.vue
├── stores/eventHub.ts        # 主窗观察（不渲 Toast）
├── stores/pluginRegistry.ts
├── plugins/registerBuiltins.ts / loadExternalPlugins.ts  # Blob 加载 ui.mjs
├── types/event.ts
tools/event-sdk/              # M9 generic publish
tools/plugin-demo/            # M10 demo-timer 包
```

## 文档索引

- [m9-event-http-api.md](m9-event-http-api.md) — 外部 Event HTTP
- [m10-external-plugins.md](m10-external-plugins.md) — 本地外部插件（加载策略、合同、信任模型）
- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 里程碑真源
- [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md)
- [toast-renders-only-from-event-bus.md](toast-renders-only-from-event-bus.md)

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
7. **外部写入走 Event HTTP（:23457）**，禁止冒充内部 kind；管理入口在调试页
8. **插件窗口同步不得阻塞主循环**：禁止在 `setup()` 或 `run_on_main_thread()` 中执行包含 `WebviewWindowBuilder::build()` 的完整同步；统一调用 `PluginWindowManager::schedule_sync()`
9. **本地插件启用即信任**：插件 manifest 不包含权限声明；后台身份仍由 `plugin-bg-<id>` 窗口 label 推导，启用状态、Event 所有权和 storage namespace 按该 id 强制校验

## 子文档

- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 第二阶段开发计划真源
- [step3-roadmap-plugin-runtime.md](step3-roadmap-plugin-runtime.md) — 第三阶段：Plugin Runtime 路线图
- [../../decisions/2026-07-23-step3-本地插件采用启用即信任而非逐项权限授权.md](../../decisions/2026-07-23-step3-本地插件采用启用即信任而非逐项权限授权.md) — Trusted Local Plugin Model 与必须保留的隔离边界
- [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md) — 协议、commands、生产者表
- [toast-renders-only-from-event-bus.md](toast-renders-only-from-event-bus.md) — Toast 订阅线与例外通道
- [signal-collection-schema-and-privacy.md](signal-collection-schema-and-privacy.md) — Signal / 隐私
- [m9-event-http-api.md](m9-event-http-api.md) — 外部 localhost Event HTTP（M9）

## 相关

- [[toast-window]] · [[event-sdk]] · [[agent-notification]] · [[water-reminder]] · [[input-monitoring]] · [[database]]
