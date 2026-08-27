# Toast 小窗化实现：右下角定位、内容尺寸上报与去穿透

> 2026-08-27 落地：Toast 从「铺满工作区的全屏透明覆盖层 + 点击穿透」改回「右下角原生小窗」。

## 为什么改回小窗

全屏覆盖层虽然能完全避免遮挡下层应用，但实现复杂、维护成本高：

- 需要前端每 200ms 上报卡片命中矩形
- 需要 Rust 50ms 轮询光标位置切换 `WS_EX_TRANSPARENT`
- 需要 `WM_NCHITTEST` subclass 绕过 tao/winit 的命中处理
- 切屏/DPI 变化时覆盖层尺寸容易失步

改为固定宽度的右下角小窗后：

- 窗口本身只覆盖右下角区域，自然不挡其它应用
- 不再需要整窗穿透和命中轮询
- 前端只需上报内容高度，Rust 负责钉右下

## 窗口尺寸与定位

### 设计尺寸

- 窗口逻辑宽度固定 **392 CSS px**（卡片 360 + 左右阴影出血 16×2）
- 最小逻辑高度 **160 CSS px**
- 实际高度 = 前端上报的 `stack.scrollHeight`，Rust 按光标屏 `work_area` clamp

### Rust 定位流程

```rust
fn fit_toast_window(window, app_handle, follow_cursor) {
    let monitor = if follow_cursor { resolve_cursor_monitor(app) } 
                  else { resolve_window_monitor(window, app) };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let content = toast_content_size();

    let width = (content.width * scale).round().clamp(1, area.width);
    let height = (content.height * scale).round().clamp(1, area.height);
    let x = area.position.x + area.width - width;
    let y = area.position.y + area.height - height;

    window_manager::set_window_rect_physical(window, x, y, width, height)
}
```

- `follow_cursor=true`：按光标选屏（首次显示、测试触发）
- `follow_cursor=false`：按窗口当前所在屏选屏（内容高度变化、DPI 变化）
- 使用 `set_window_rect_physical` 一次写入物理像素，避免 tao 分步 set_size/set_position 的 DPI 竞态

### 前端上报内容尺寸

```ts
async function reportWindowSize() {
  const width = Math.max(1, Math.ceil(root.scrollWidth))
  const height = Math.max(160, Math.ceil(stack.scrollHeight))
  await setToastContentSize(width, height)
}
```

触发时机：

- ResizeObserver 监听 `stack` 和每张卡片
- 卡片添加/移除/动画结束
- update 详情展开/收起
- agent session 变化

## 去掉的旧机制

| 旧机制 | 移除原因 |
|--------|---------|
| `set_toast_hit_regions` / `HIT_RECTS` | 不再需要整窗穿透命中测试 |
| 50ms 穿透轮询线程 | 小窗本身不遮挡其它区域 |
| `set_ignore_cursor_events_raw` | 不需要切换 `WS_EX_TRANSPARENT` |
| `WM_NCHITTEST` subclass | 不需要绕过 tao 返回 `HTTRANSPARENT` |
| `catrace:toast-hover-exit` 事件 | WebView 现在能正常收到 `mouseleave` |
| 调试面板的 `debugInfo` | 命中区域调试信息不再需要 |

## 前端布局调整

- `.toast-root` 从 `100vw × 100vh` 改为 `24.5rem` 宽、高度撑满
- `justify-content` 从 `flex-end`（贴底）改为 `flex-start`（贴顶）
- `.toast-stack` 去掉负 margin，直接用窗口本身的 16px 出血区
- 滚动条 gutter 用 `scrollbar-gutter: stable` 保持右侧留白恒定

## 相关文件

- `src-tauri/src/reminder_toast.rs` — `fit_toast_window`、`set_toast_content_size`、`build_toast_window`
- `src-tauri/src/window_manager/windows.rs` — `set_window_rect_physical`
- `src/views/toastWindows/ReminderToast.vue` — `reportWindowSize`、`ResizeObserver`、样式
- `src/api/tauri.ts` — `setToastContentSize` 封装
- `src/views/toastWindows/ToastShell.vue` — 强制透明背景

## 参考

- 旧实现笔记（已废弃）：[full-screen-click-through-overlay-windows-implementation.md](full-screen-click-through-overlay-windows-implementation.md)
