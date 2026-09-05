# Desktop Event OS

Catrace 从「休息提醒 App」演进为桌面小窗系统：统一 **Event Protocol + Bus + Toast 渲染适配**，并叠加 **Signal 行为感知**。同仓演进，不重写。

## 五层愿景

```
Plugin Ecosystem  →  Event SDK  →  Event Bus  →  Notification Engine  →  Desktop Runtime (Tauri/Rust)
```

当前：**第二阶段已完成真机验收，第三阶段 M11 插件后台运行时也已通过启动、禁用、重新启用和 10 秒 Toast 真机验收**。M11 为每个启用插件创建独立隐藏 WebView，运行 `background.mjs`，并提供 publish/activity/storage/logger 最小宿主能力。M11.1 已删除插件 manifest 的 `permissions` 字段，保留身份/所有权/命名空间隔离；连续高内存、连续磁盘写入、单次大数据或刷事件都会记录插件 id 并显示“异常” Tag；不限流、不丢弃。**Step 3 已关账（2026-08-03）**：Plugin Runtime + M15 sidecar 完成。见 [step3-收尾评估-核心目标已达成与Step4候选.md](step3-收尾评估-核心目标已达成与Step4候选.md)、[plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md)。M12/M14 按需暂缓。**不做插件市场。**

## 模块布局

```
src-tauri/src/
├── event.rs / bus.rs     # 协议 + Registry + publish/update/resolve
├── event_http.rs         # M9/M10 外部 Event API 127.0.0.1:23457（plugin_id）
├── plugins.rs            # M10/M11/M15 manifest 扫描、启用、UI/background/sidecar source
├── plugin_sidecar.rs     # M15 PluginSidecarManager + stdio JSONL bridge
├── plugin_window.rs      # 每插件隐藏 WebView 生命周期与非阻塞同步
├── plugin_api/           # 通用宿主原语（audio/clipboard/dialog/events/host/shell/storage/window）
├── plugin_commands.rs    # publish/activity/storage/logger 身份、所有权与输入边界
├── signal.rs / db.rs     # 行为采集 + signal_minutes
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
tools/plugin-demo/              # M10/M11 demo + M15 sidecar-echo（git submodule → catrace-plugin）
```

## 文档索引

- [m9-event-http-api.md](m9-event-http-api.md) — 外部 Event HTTP
- [m10-external-plugins.md](m10-external-plugins.md) — 本地外部插件（加载策略、Card/settings 合同、信任模型；settings 布局归宿主）
- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 里程碑真源
- [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md)
- [toast-renders-only-from-event-bus.md](toast-renders-only-from-event-bus.md)

## 两条线

| 线 | 职责 | 互连 |
|----|------|------|
| **Event** | 有什么事、怎么展示、怎么 resolve | Toast 订阅 bus 渲染内容 |
| **Signal** | 桌面上在发生什么 | **不**自动 createEvent |

## 关键约定

1. **内容只走 Bus**：rest / timer / agent / permission / update 均 `publish`；禁止再 `eval addToastNotification` 注入内容
2. **窗口与内容分离**：`ensure_toast_window_visible` 只管窗口；`publish` 顺带 ensure
3. **主窗 hub 不渲第二张卡**；Toast 窗自己 listen + `get_active_events` 水合
4. Action resolve **只记生命周期**；业务（snooze/permission HTTP）仍在既有 command
5. 仍用专用通道：`dismissAgentSession`（销 sticky/permission UI）；rest-timer 已走 Bus upsert
6. 键序列默认关；休息判定用 legacy `count`
7. **外部写入走 Event HTTP（:23457）**，禁止冒充内部 kind；管理入口在调试页
8. **插件窗口同步不得阻塞主循环**：禁止在 `setup()` 或 `run_on_main_thread()` 中执行包含 `WebviewWindowBuilder::build()` 的完整同步；统一调用 `PluginWindowManager::schedule_sync()`
9. **本地插件启用即信任**：插件 manifest 不包含权限声明；后台身份仍由 `plugin-bg-<id>` 窗口 label 推导，启用状态、Event 所有权和 storage namespace 按该 id 强制校验

## 子文档

- [step2-roadmap-event-core-and-signal-core.md](step2-roadmap-event-core-and-signal-core.md) — 第二阶段开发计划真源
- [step3-roadmap-plugin-runtime.md](step3-roadmap-plugin-runtime.md) — 第三阶段：Plugin Runtime 路线图（含 M15）
- [step3-收尾评估-核心目标已达成与Step4候选.md](step3-收尾评估-核心目标已达成与Step4候选.md) — Step 3 关账结论与 Step 4 排序
- [step4-roadmap-plugin-ecosystem.md](step4-roadmap-plugin-ecosystem.md) — Step 4：本地安装 / 打包约定
- [plugin-native-sidecar-runtime.md](plugin-native-sidecar-runtime.md) — M15 可选 Native Sidecar 设计真源
- [sidecar孤儿进程清理-Windows-Job-Object实现.md](sidecar孤儿进程清理-Windows-Job-Object实现.md) — 宿主退出自动回收 sidecar 孤儿进程（Job Object，Windows）
- [sidecar-storage往返协议与Plugins-UI运行态约定.md](sidecar-storage往返协议与Plugins-UI运行态约定.md) — M15.3 storage JSONL 与本机进程 badge
- [plugin-audio-rodio独立线程与getPluginDir.md](plugin-audio-rodio独立线程与getPluginDir.md) — 插件播放本地音频；OutputStream 独立线程；不要用 `plugin.shell.beep()` 当提示音
- [event-protocol-and-bus-lifecycle.md](event-protocol-and-bus-lifecycle.md) — 协议、commands、生产者表
- [toast-renders-only-from-event-bus.md](toast-renders-only-from-event-bus.md) — Toast 订阅线与例外通道
- [signal-collection-schema-and-privacy.md](signal-collection-schema-and-privacy.md) — Signal / 隐私
- [插件配置和运行数据必须分开存储.md](插件配置和运行数据必须分开存储.md) — 可迁移配置与机器运行数据的边界
- [m9-event-http-api.md](m9-event-http-api.md) — 外部 localhost Event HTTP（M9）

## 相关

- [[toast-window]] · [[event-sdk]] · [[agent-notification]] · [[water-reminder]] · [[input-monitoring]] · [[database]]
