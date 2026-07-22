# 2026-07-23 Step3 Plugin Runtime 路线图起草与选型定案

## Session goal

把 Step 2（Event Core + Signal Core，M1–M10 已收尾）之后的插件阶段正式文档化：让用户写插件脚本随应用启动后台运行，能定时发通知、读活跃数据、记自己的数据、做复制验证码/快速回复类交互。

## Completed

- 明确 Step2 roadmap 只到 M10，Step3 此前无文档；新建 [step3-roadmap-plugin-runtime.md](../architecture/desktop-event-os/step3-roadmap-plugin-runtime.md) 作为新真源。
- 关键选型定案：**插件后台运行时 = 每插件一个隐藏 WebView 窗口**（非 deno_core / 独立 Node / Electron）。ADR 见 [2026-07-23-step3-插件后台运行时用隐藏webview窗口.md](../decisions/2026-07-23-step3-插件后台运行时用隐藏webview窗口.md)。
- 里程碑：M11 后台窗口 + invoke 能力集 → M11.1 资源/权限 → M12 更多宿主能力（含 napcat）→ M13 外部设置面板 → M14 内置插件迁移（暂缓）。
- 职责划分定案：background 管调度/发通知/读活跃/存数据；卡片管渲染 + 即时交互。**确认不需要 action 回传到后台**（最初误判为硬需求，澄清后降为可选增强）。
- 记录已知坑：隐藏 WebView 的 `setInterval` 节流（§14.1），分钟级可接受、秒级待确认。

## Remaining

- 确认插件计时精度需求（分钟级 / 秒级）→ 决定实现时是否关窗口节流。
- M11 落地：`plugin_window.rs` 窗口管理器 + `plugin_commands.rs` invoke 集 + manifest v2 解析 + demo-timer 改造。
- 隔离粒度实现时定：单宿主窗口多插件 vs 每插件一窗。

## Key file changes

| File | Change |
|------|--------|
| `.agent/architecture/desktop-event-os/step3-roadmap-plugin-runtime.md` | 新建，Step3 路线图真源（隐藏 WebView 方案） |
| `.agent/architecture/desktop-event-os/README.md` | 索引补 step3 链接 + 当前状态描述 |
| `.agent/architecture/desktop-event-os/step2-roadmap-event-core-and-signal-core.md` | M10 行尾指向 step3；推进顺序改「Step 3 Plugin Runtime」 |
| `.agent/decisions/2026-07-23-step3-插件后台运行时用隐藏webview窗口.md` | 新建，选型 ADR |
