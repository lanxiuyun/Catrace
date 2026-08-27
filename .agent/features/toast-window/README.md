# Toast 提醒窗口

独立透明 WebviewWindow + Vue 卡片实现的右下角通知堆叠。

> **内容入口（Step 2）**：rest/water/eye/agent/permission/update 均经 [[desktop-event-os]] Event Bus（`catrace:event`）到达本窗；  
> Rust 侧 `ensure_toast_window_visible` 只保证窗口在位。详见  
> [toast-renders-only-from-event-bus.md](../../architecture/desktop-event-os/toast-renders-only-from-event-bus.md)。  
> 例外：`dismissAgentSession` eval；rest-timer 已走 Bus upsert（见子文档）。

## 涉及文件

- `src-tauri/src/reminder_toast.rs` — 窗口 ensure/复用/定位；`set_toast_content_size`
- `src-tauri/src/window_manager/` — 无焦点显示（Windows `WS_EX_NOACTIVATE`）、`set_window_active_mode`
- `src-tauri/src/bus.rs` / `event.rs` — 事件协议与分发
- `src/views/toastWindows/ReminderToast.vue` — listen bus + 栈生命周期；卡片内容下沉专用组件；尺寸上报 + 点击抢焦点
- `src/views/toastWindows/ToastShell.vue` — Toast 路由外壳，强制透明背景
- `src/api/tauri.ts` — `setToastContentSize`、`setWindowActiveMode` 等 invoke 封装
- `src/components/EyeToastCard.vue` — 护眼提醒专用卡片
- `src/components/AgentToastCard.vue` — agent 通知专用卡片（详见 [[agent-notification]]）
- `src/components/PluginHostCard.vue` / `pluginHostCardCache.ts` — 外部插件卡挂载与进程级缓存；热更靠 generation

## 组件边界纪律

新增卡片类型时**必须抽独立组件**，不要堆进 ReminderToast.vue；同时检查父模板三处按 kind 分支的 v-if（通用 header / body-text / progress-bar）都把新 kind 排除，否则会和组件内部渲染叠成双份（2026-07-12 agent 双进度条 bug 即此原因）。

## 窗口特性

- 透明无边框 WebviewWindow，复用而非销毁
- **右下角原生小窗（2026-08-27）**：不再铺满 work_area、不再点击穿透。窗宽固定约 392 CSS px（卡片 360 + 阴影出血），高度随卡片内容 resize，clamp 到光标所在屏 `work_area` 高度；超出内部滚动。详见 [toast小窗化实现-右下角定位-内容尺寸上报-与去穿透.md](toast小窗化实现-右下角定位-内容尺寸上报-与去穿透.md)
- Windows 不抢夺焦点（`WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE`）
- **点击卡片才抢焦点**：`pointerdown` 触发 `setWindowActiveMode(true)`，移入/移出只控制 auto-hide 倒计时暂停
- macOS / Linux 回退到普通显示
- Z 序约束见 [window-manager 架构](../architecture/window-manager/README.md#z-序约束重要)

## 卡片行为

- 新卡片右侧滑入，关闭时 FLIP 动画让下方卡片上移
- 普通卡片 8 秒自动消失，hover 暂停，离开恢复
- **Bus `dedupe_key`**：非空时 registry 内同 key active 会 `superseded`；FE 可原地刷新。真实 rest 用 `reminder.rest.due:{boundary}`；测试 `boundary=0` 默认不设 key
- **久坐「发送测试」**：后端+按钮 **1s 限流**（防连点卡死，权宜）。无限制堆叠抗崩见子文档
- 无 dedupe 的 kind（如多数 water/eye）仍入栈，受 `MAX_NOTIFICATIONS` 上限；超出丢最旧
- `adjustWindowSize` 必须 single-flight，禁止每次 add 并发 `setSize`/`setPosition`
- 内容超出时 `.toast-stack` 可滚动，并自动滚动到底部

## 点击抢焦点

Toast 默认是 `WS_EX_NOACTIVATE` 无焦点窗，鼠标滑入/选择文本不会把键盘焦点从原窗口抢走。只有用户**点击卡片**时，前端 `pointerdown` 才会调用 `setWindowActiveMode('reminder-toast', true)`，Rust 去掉 `WS_EX_NOACTIVATE` 并把窗口拉到前台。

清选区 / 恢复无焦点态的时机：
- 点卡片外空白（当前实现由 WebView 自然失焦）
- 窗口隐藏/关闭：`close_reminder_window` 里调 `set_window_active_mode_internal(false)` 重新应用 `WS_EX_NOACTIVATE`

## 卡片类型（按 `kind` 区分主题）

| kind | 颜色 | 行为 |
|------|------|------|
| 休息提醒 | 紫色 | 8s 自动消失 |
| 喝水提醒 | 蓝色 | 8s 自动消失 |
| 护眼提醒 | 绿色 | 25s 自动消失，倒计时在进度条右侧，hover 不暂停 |
| 休息计时 | 绿色 | 不自动关闭，液体球动画，满 break_minutes 后继续累计 |
| 更新通知 | 橙色 | 不自动关闭，展开更新日志 + 下载进度条 |
| agent 通知 | 青色 | 按事件策略：auto 8s 消失 / sticky 常驻手动关，多个 sticky 合并为一张「N 个会话在等你」；详见 [[agent-notification]] |

## 定位职责

- Rust `fit_toast_window` 按光标屏 `work_area` 把小窗钉在右下；物理像素一次写入（切屏 DPI 仍走 `set_window_rect_physical`）
- 前端 `setToastContentSize` 上报内容逻辑宽高；高度随卡片变化，Rust clamp 到 work_area
- 已可见时连点只堆叠，不反复 show / 不跟光标跳屏
- 依赖窗口/显示器相关 core 权限（如 `core:window:allow-current-monitor`、`core:window:allow-scale-factor` 等，见 `src-tauri/capabilities/default.json`）

## 调试

Debug 页开启 `toast_debug_mode` → Toast 窗口背景变半透明黄色，方便排查布局/点击。


## sdk 通用卡（M9）

- `kind: 'sdk'` → `SdkToastCard.vue`
- 外部 HTTP / 内部 publish 均可；渲染仍只听 `catrace:event`
- 同 `event.id` 或 `dedupe_key` **原地更新** progress/title/actions（勿二次堆卡）
- sticky sdk 不走 auto-hide；action → `resolve_event_action`


## 外部插件卡热更新（开发期）

- 改磁盘 `ui.mjs` 后：插件页**刷新**或**测试** → emit `catrace:reload-external-plugins`。
- Toast：force `loadExternalPlugins` → 更新 live `uiUrl` → `clearPluginHostCardCache()`（generation++）→ 已挂载卡 remount。
- 细节：[外部插件toast卡热更新-generation缓存与reload顺序.md](外部插件toast卡热更新-generation缓存与reload顺序.md)

## 外部插件卡 + sticky action 回传

- 外部插件 Toast 走 `PluginHostCard` + bus；`handlePluginAction` **只** `markEventResolved`，不本地卸卡。
- bus `resolved` 且 `resolution.kind === 'superseded'`：**不卸卡**（等后续 active upsert）。
- **仅** sticky 插件卡 + `resolution.kind === 'action'` + `action_id === 'echo'` 时 **留卡**，供 sidecar roundtrip 原地 upsert。
- 其它 action（如 `dismiss`）/ dismissed / completed：正常 `removeNotification`。
- 细节：[插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md](插件sticky卡-action回传时只对echo留卡-dismiss仍卸卡.md)

## 子文档
- [toast小窗化实现-右下角定位-内容尺寸上报-与去穿透.md](toast小窗化实现-右下角定位-内容尺寸上报-与去穿透.md) — 2026-08-27 从全屏覆盖层改回右下角原生小窗的实现细节
- [外部插件toast卡热更新-generation缓存与reload顺序.md](外部插件toast卡热更新-generation缓存与reload顺序.md) — 开发期 ui.mjs 热更：generation 缓存与 reload 顺序
- [连点测试与-bus-dedupe-限流策略-以及无限制堆叠待做.md](连点测试与-bus-dedupe-限流策略-以及无限制堆叠待做.md) — 测试限流、dedupe、ensure/resize 加固与无限制堆叠待做
- [dedicated-card-renders-own-body-generic-template-must-exclude-it.md](dedicated-card-renders-own-body-generic-template-must-exclude-it.md) — 专用卡片自渲染正文时，外层通用模板要显式排除，否则正文会渲染两遍
- [toast-卡片紧凑尺寸规范-和阴影防裁剪出血方案.md](toast-卡片紧凑尺寸规范-和阴影防裁剪出血方案.md) — 卡片/字体/留白尺寸规范（对标 Win11 原生 toast），以及透明窗口里阴影被 overflow 裁剪的根治方案
- [rest-timer-收敛到-event-bus-的-upsert-路径.md](rest-timer-收敛到-event-bus-的-upsert-路径.md) — rest-timer 经 Bus upsert，去掉 catrace-rest-timer 专用通道
- [full-screen-click-through-overlay-windows-implementation.md](full-screen-click-through-overlay-windows-implementation.md) — **已废弃（2026-08-27）**：全屏覆盖 + 点击穿透实现笔记；现改为右下角原生小窗
