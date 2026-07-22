# 2026-07-23 Step3 插件后台运行时用隐藏 WebView 窗口而非 deno_core/独立 Node/Electron

## 背景

Step 3（Plugin Runtime）要让用户写的插件脚本随应用启动在后台持续运行：定时发通知、读 Catrace 活跃数据、记自己的数据、连 napcat 之类的外部服务做快速回复。需要选定一个「跑用户 JS 的运行时」。

参照物是 Rubick 的系统插件——每个插件一个 Node 进程，启用即跑用户脚本。但 Catrace 是 Tauri(Rust)，不自带 Node。

## 候选方案与取舍

| 方案 | 体积增量 | 是否真 Node | 与 Toast/UI 技术栈 | 新代码量 | 结论 |
|------|---------|------------|-------------------|---------|------|
| deno_core（嵌 v8 沙箱） | +80~150MB | 否（受限 JS） | 两个 JS 世界 | 大量 op 桥 | ❌ |
| 独立 Node 进程（内置 Node 二进制） | +40MB | 是 | 两个世界 | 进程管理 + IPC | ❌ |
| 检测系统已装 Node | 0 | 是 | 两个世界 | 进程管理 | ❌ 用户门槛高 |
| 改 Electron | 重写整个 Rust 后端 | 是 | — | 推翻重来 | ❌ |
| **隐藏 WebView 窗口** | **0** | 否（浏览器 JS） | **统一** | **少** | ✅ |

## 决策

**每个启用插件创建一个隐藏 WebView 窗口跑后台脚本**，复用 Tauri 自带 WebView，零体积增量。插件脚本是标准浏览器 JS（`setInterval`/`fetch`/`WebSocket`/ESM），通过 Tauri invoke 调宿主能力（发通知、读活跃、私有存储、剪贴板）。napcat 走 `WebSocket`/`fetch` 直连，宿主不感知。

技术可行性已验证：现有 Toast 窗口就是 `.visible(false)` 预创建隐藏窗口（`reminder_toast.rs`），同款技术，路径已踩通。

## 关键理由

1. **零体积**：deno_core 的 v8 要 +80~150MB，独立 Node 要 +40MB，隐藏 WebView 用 Tauri 自带运行时，不增一分。
2. **技术栈统一**：Toast 卡片（ui.mjs）本来就在 WebView 里，后台也在 WebView 里，两者同一套 invoke 能力，数据互通容易。
3. **不引入第二个 JS 世界**：deno_core / 独立 Node 都是「Rust 一个世界 + 插件一个世界」，要手写通信桥；WebView 直接用现成的 Tauri invoke/event。
4. **不需要真 Node**：本阶段需求（定时发通知、读活跃、存数据、连 WebSocket）浏览器 JS 全覆盖；文件/剪贴板用 invoke 补。

## 随之而定的职责划分

- **background（隐藏窗口）**：计时调度 + 发通知 + 读活跃数据 + 持久化。
- **卡片（ui.mjs，Toast 窗口）**：渲染 + 用户即时交互（复制验证码当场 `fetch`/剪贴板闭环）。
- **不需要 action 回传到后台**：交互在卡片内闭环。这是和最初设想的重要修正——最初以为必须把按钮点击传回后台脚本，确认「全部交互逻辑在卡片」后，回传通道降为可选增强（M11 不做）。

## 已知坑（待验证）

隐藏/后台 WebView 页面的 `setInterval` 会被浏览器节流（降到 ~1 分钟）。分钟级计时（喝水提醒）误差可接受；秒级需实现时关闭插件窗口节流。详见 [[step3-roadmap-plugin-runtime]] §14.1。

## 相关

- 路线图真源：[[step3-roadmap-plugin-runtime]] `.agent/architecture/desktop-event-os/step3-roadmap-plugin-runtime.md`
- 上一阶段：[[desktop-event-os]] step2 M10 外部插件（Blob 加载机制被本方案复用）
