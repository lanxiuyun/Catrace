# Toast 卡片堆超过 work_area 时无法滚动：栈的百分比 max-height 落到 none

## 症状

短时间内堆了十几张卡（如短信转发插件连收 10 条），卡片堆一直排到窗口下缘被整齐切断，**右侧没有滚动条、滚轮也滚不动**，被 clamp 掉的那几张永远看不到。

## 根因

两侧都没写错，是中间那层没接上：

1. Rust `fit_toast_window` 把窗高 clamp 到 `work_area`（[小窗化](toast小窗化实现-右下角定位-内容尺寸上报-与去穿透.md) 的设计，不能盖住任务栏/超出屏幕）→ 内容比窗高时窗口不再跟着长，**预期由前端栈内滚动承担**。
2. 前端 `.toast-stack` 确实写了 `max-height: 100%; overflow-y: auto`，但包含块 `.toast-root` 当时是 `min-height: 100vh` —— 高度仍是 **auto（内容高）**。
3. 百分比 `max-height` 在包含块高度不确定时按 `none` 处理（CSS2.1 §10.7），于是栈永远等于内容高：`scrollHeight == clientHeight`，**根本没形成 overflow** → 没有滚动条，滚轮无处可滚。
4. 溢出部分被 `.toast-root` 的 `overflow: hidden` 直接吃掉，表现就是「排到窗口下缘被切断」。

旁证：`scrollStackToBottom()` 从写下那天起就是 no-op（没有可滚动的量），README 里「内容超出时 `.toast-stack` 可滚动，并自动滚动到底部」是**当时并不成立**的声明。

同类坑（同一类「百分比高度参照 indefinite」）：[2026-07-27-插件页高度未铺满因-n-scrollbar-content-百分比min-height无效.md](2026-07-27-插件页高度未铺满因-n-scrollbar-content-百分比min-height无效.md)。

## 验证（Chromium 探针）

同一份 DOM（root > stack > 6 张定高卡 + 真实祖先链：普通块级父元素），只换 root 的高度声明，headless Chromium 实测：

| root 声明 | root 高度 | stack clientHeight | stack scrollHeight | maxScrollTop |
|---|---|---|---|---|
| `min-height: 100vh`（改前） | 840 | 840 | 840 | **0（滚不动）** |
| `height: 100vh`（改后） | 805 | 805 | 840 | **35（可滚）** |

探针脚本留在 `e2e-temp/toast-scroll-css-probe.html`（该目录 gitignore，不随仓库提交）。
`stack.scrollHeight` 在约束后仍返回**完整内容高**，这正是上报给 Rust 的窗高依据 —— 所以修复不影响 `reportWindowSize` 的高度算法。

## 最终修复

`src/views/toastWindows/ReminderToast.vue`：

- `.toast-root`：`min-height: 100vh` → **`height: 100vh`**（定高）。既保持「铺满整窗」的既有意图，又给栈一个可解析的百分比基准。
- `.toast-stack`：补 `min-height: 0`（消除 flex item 的自动最小尺寸 = 内容高这条旁路）。
- `scrollStackToBottom()`：补**贴底判断**。溢出后新卡落在可视区外，无脑滚底会把正在翻旧卡的人拽走 —— 改为只在「本来就贴底」时跟随（`@scroll.passive` 记录，容差 24px）；空栈关窗时重置为贴底。
- 滑块颜色 `rgba(0,0,0,.25)` → 中性灰 `rgba(146,146,158,.7)`：gutter 那一列是**窗口透明区**（背后是壁纸/桌面），纯黑在深色壁纸上几乎不可见。Chromium 下标准属性 `scrollbar-color` 会盖掉 `::-webkit-scrollbar-*`，两处都写同一颜色。

不变量：内容不超 `work_area` 时，窗口高度**仍严格等于内容高**（无 Rust 改动，无回归）。

## 涉及文件

- `src/views/toastWindows/ReminderToast.vue` — `.toast-root` / `.toast-stack` 样式、`scrollStackToBottom`
- `src-tauri/src/reminder_toast.rs` — 只读参照（`fit_toast_window` 的 clamp 行为未改）
