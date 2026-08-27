# Toast 全屏覆盖 + 点击穿透实现（Windows）

> **已废弃（2026-08-27）**：Toast 改回右下角原生小窗，不再铺满 work_area、不再点击穿透。
> 现行逻辑见 [README.md](README.md)。下文仅作历史实现笔记。

2026-08-11 落地：Toast 窗口不再停在右下角，而是铺满光标所在显示器**工作区**（`work_area`，去掉任务栏），默认整窗鼠标穿透，只有落在卡片矩形内才可交互。这样既有底部通知的展示位，又完全不挡下层应用操作。

## 机制总览

```
前端 (ReminderToast.vue)                  Rust (reminder_toast.rs + window_manager/windows.rs)
─────────────────────────────            ──────────────────────────────────────────────
每 200ms / ResizeObserver 收集
每张卡片 getBoundingClientRect()
(窗口内 CSS px)
        │ setToastHitRegions(rects) ───► HIT_RECTS 静态锁
        │                                │
        ▼                                ▼  穿透轮询线程 (50ms)
                                         读取物理光标 (device_query)
                                         换算 rects → 物理坐标 (inner_position + scale_factor)
                                         命中? ──► set_ignore_cursor_events_raw(ignore=!hit)
                                                    │
                                          WM_NCHITTEST subclass
                                          穿透态 → HTTRANSPARENT(-1) 整窗跳过命中
                                          交互态 → DefSubclassProc（tao 原逻辑，卡片可点）
```

## 前端职责（ReminderToast.vue）

- `reportHitRegions()`：收集非 leaving 卡片的窗口内逻辑矩形，JSON 去重后 `setToastHitRegions`。每 200ms 兜底 + ResizeObserver 触发 schedule。
- `catrace:toast-hover-exit`：Rust 发现光标离开卡片（切回整窗穿透）时 emit。全窗穿透下 WebView 收不到真实 mouseleave，前端必须靠此事件清 `isHovered` 并恢复自动消失计时。
- 单卡 hover 强制：进入一张卡时先对其它 `isHovered` 卡执行 `handleMouseLeave`，防止多张同时 hover 后一个 hover-exit 事件连锁删整堆。
- `handleMouseLeave` 不再因 hover 删除卡片；剩余时间拖到 0 时重置整段 auto-hide，避免光标一碰整堆消失。

## Windows 点击穿透的三个关键坑（根因与解法）

### 坑 1：不能走 tao 的 `set_ignore_cursor_events`
tao 内部 `apply_diff` 会重建 `GWL_EXSTYLE` 并检查 **VISIBLE 标志**。本窗口是原生 `ShowWindow(SW_SHOWNOACTIVATE)` 显示的，tao 的 VISIBLE 标志未同步 → 一调 `set_ignore_cursor_events` 窗口就被 `SW_HIDE`（= 一进卡片就消失），并丢掉 `WS_EX_LAYERED` 破坏透明。

解法：`window_manager::set_ignore_cursor_events_raw` 用 `GetWindowLongPtrW` + `SetWindowLongPtrW(GWL_EXSTYLE)` **只切 `WS_EX_TRANSPARENT` 一个位**，并强制补回 `WS_EX_LAYERED`（per-pixel alpha 渲染与命中测试依赖它）。保留 `WS_EX_TOPMOST` / `WS_EX_NOACTIVATE` 不动。

### 坑 2：`WS_EX_TRANSPARENT` 单独设置**不生效**
`WS_EX_TRANSPARENT` 依赖 `DefWindowProc` 处理 `WM_NCHITTEST`。但 tao/winit 自己处理 `WM_NCHITTEST`（为 resize/拖动返回 HTCLIENT），**根本不落到 DefWindowProc**，所以样式位永远不被系统兑现 —— 表现为日志 `transparent_after=true` 但空白区仍挡点击。

解法：`SetWindowSubclass` 挂 `WM_NCHITTEST`，穿透态直接返回 `HTTRANSPARENT`(-1)，交互态 `DefSubclassProc` 走 tao 原逻辑。这是**绕过 tao 的最终保证**，与样式位互不依赖。

### 坑 3：状态机必须每 tick 强制同步（自愈）
tao 的 `apply_diff`（fit 的 set_size/set_position、WebView 重建、resize）随时可能把 `WS_EX_TRANSPARENT` 冲掉。若只在状态翻转时调 raw，样式失步后永不补回。所以穿透轮询 **每 50ms 无条件调一次 raw**（样式未变时只是 `GetWindowLongPtr` 读一次，零开销），配合坑 2 的 subclass 即时生效。

## 相关文件

- `src-tauri/src/reminder_toast.rs` — `set_toast_hit_regions` 命令、`HIT_RECTS` 锁、穿透轮询线程（panic 自动重启）、`fit_toast_window_to_cursor_monitor`（改 `work_area`）
- `src-tauri/src/window_manager/windows.rs` — `set_ignore_cursor_events_raw`、`WM_NCHITTEST` subclass、`ensure_hit_test_subclass`、`TOAST_PASSTHROUGH` 原子
- `src-tauri/src/window_manager/macos.rs` — `set_ignore_cursor_events_raw` 回退到 `window.set_ignore_cursor_events`（无 VISIBLE 标志问题）
- `src/views/toastWindows/ReminderToast.vue` — hit-region 上报、hover-exit 处理、单卡 hover 强制
- `src/api/tauri.ts` — `setToastHitRegions` 封装

## 约定

- **铺满工作区而非整屏**：用 `monitor.work_area()`（`area.position` + `area.size`），避免覆盖任务栏 / macOS Dock
- **Windows 跨屏 DPI**：不要分步 `set_size`/`set_position`。切屏时 tao 的 `WM_DPICHANGED` 会按「保持逻辑尺寸」再改物理大小，第一张 Toast 覆盖层会小于目标屏。应一次 `SetWindowPos` 写入物理工作区，发现被 DPI 改写后再钉一次
- subclass 每个 HWND 只安装一次（`TOAST_HITTEST_SUBCLASSED` 原子守卫）；toast 窗口常驻复用，无重建场景
- 穿透轮询里所有窗口/emit 调用必须在释放 `HIT_RECTS` 锁之后，否则与 `set_toast_hit_regions` 命令跨线程锁序死锁
