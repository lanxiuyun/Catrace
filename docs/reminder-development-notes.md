# Catrace 提醒窗口开发笔记

> Tauri v2 + Vue 3 多模式提醒窗口（Toast / Popup / Fullscreen）踩坑与解决方案

---

## 1. 需求背景

Catrace 需要三种提醒方式：
- **Toast**：屏幕右下角浮动通知卡片，支持堆叠；带「5 分钟后提醒」「10 分钟后提醒」「跳过本次」按钮
- **Popup**：小弹窗（440×300，无边框，置顶，主窗口中央）
- **Fullscreen**：全屏遮罩（全屏 + 倒计时）

三种提醒都基于独立的 Tauri WebviewWindow，与主窗口共享同一套 Vue 构建产物，但渲染不同的组件。

> 历史：早期 Toast 使用 Windows 原生 Toast（`tauri-winrt-notification`），但仅支持 Windows 且行为受限。当前实现改为跨平台的 Vue 透明窗口方案。

---

## 2. 核心架构

### 2.1 数据共享

Rust 侧用 `Arc<Mutex<HashMap<String, ReminderWindowData>>>` 存储提醒数据，新窗口通过 `get_reminder_data(label)` 命令读取：

```rust
pub struct ReminderWindowData {
    pub boundary: i64,
    pub title: String,
    pub body: String,
    pub break_minutes: i64,
    pub fullscreen_bg: Option<String>,
    pub fullscreen_opacity: i64,
}

pub type ReminderWindowStore = Arc<Mutex<HashMap<String, ReminderWindowData>>>;
```

### 2.2 前端路由切换

**最终方案：URL query 参数 + main.ts 预读**

Rust 侧创建弹窗时传入 query 参数：

```rust
tauri::WebviewUrl::App("index.html?reminder=popup".into())
```

`main.ts` 在 Vue 挂载前读取 query 参数，立即设置路由，避免 Dashboard 闪现：

```ts
const url = new URL(window.location.href)
const reminder = url.searchParams.get('reminder')
if (reminder === 'toast' || reminder === 'popup' || reminder === 'fullscreen') {
  (window as any).__CATRACE_REMINDER_TYPE__ = reminder
  const routeMap: Record<string, string> = {
    toast: '#/reminder-toast',
    popup: '#/reminder-popup',
    fullscreen: '#/reminder-fullscreen',
  }
  window.location.hash = routeMap[reminder]
}
```

提醒路由不使用懒加载（避免新窗口 chunk 加载失败）：

```ts
import ReminderToast from '../views/ReminderToast.vue'
import ReminderPopup from '../views/ReminderPopup.vue'
import ReminderFullscreen from '../views/ReminderFullscreen.vue'

{ path: '/reminder-toast', component: ReminderToast }
{ path: '/reminder-popup', component: ReminderPopup }
{ path: '/reminder-fullscreen', component: ReminderFullscreen }
```

`App.vue` 现已简化为直接通过 `route.path` 判断当前提醒类型：

```ts
const currentReminderType = computed(() => {
  if (route.path === '/reminder-popup') return 'popup'
  if (route.path === '/reminder-fullscreen') return 'fullscreen'
  if (route.path === '/reminder-toast') return 'toast'
  return ''
})
```

### 2.3 Toast 窗口的特殊性

Toast 窗口与 Popup / Fullscreen 最大的区别：

- **复用 + 追加**：同一 `reminder-toast` 标签的窗口会被复用；Rust 通过 `window.eval("window.__CATRACE_ADD_TOAST__?.(...)")` 向已有窗口追加新卡片。
- **透明背景**：窗口本身透明，所有视觉（圆角、阴影、背景色）由 Vue 卡片 CSS 渲染。
- **尺寸自适应**：`ReminderToast.vue` 内部通过 ResizeObserver 监听内容高度，动态调用 `adjustWindowSize()` 让 Rust 窗口匹配内容高度（最大高度 600px）。
- **右下角定位**：Rust 在 `reminder_toast.rs` 中读取当前工作区（work area），将窗口放在右下角，并根据内容高度调整 `y` 坐标。
- **FLIP 动画**：关闭卡片时先记录旧位置，再触发动画，让下方卡片平滑上移补位。
- **并发保护**：`removeNotification` 会检查 `item.leaving`，避免快速点击或 hover 状态导致动画重复触发。
- **调试模式**：`toast_debug_mode` 为 `true` 时，窗口背景显示半透明黄色，便于排查透明窗口的点击/布局问题。

---

## 3. 踩坑记录

### 3.1 白屏问题

**现象**：弹窗窗口创建后一片空白，DevTools 无法打开，没有任何报错。

**根因**：`transparent(true)` + `.parent()` 的组合会导致 WebView 渲染异常。单独使用 `.parent()` 且窗口不透明时不会白屏。

**错误代码**：

```rust
// ❌ transparent + parent 组合导致白屏
let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
    .parent(&main_window)
    .transparent(true)
    .inner_size(400.0, 220.0)
    ...;
```

**解决**：移除 `.parent()` 和 `transparent(true)`，弹窗作为独立不透明窗口：

```rust
// ✅ 正常渲染
let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
    .inner_size(440.0, 300.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false);
```

> 注意：移除 `parent` 后，弹窗不再随主窗口移动/最小化，这正是我们想要的行为（独立提醒窗口）。

### 3.2 透明窗口的 DWM 边框（Windows）

**现象**：透明窗口边缘有一个淡淡的方形边框，`.shadow(false)` 和 CSS 都去不掉。

**根因**：Windows DWM 会给透明窗口强制添加一个边框。`DwmSetWindowAttribute(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE)` 可以去掉边框，但只支持 Windows 11。

**最终方案**：放弃透明窗口，改用不透明白色背景窗口。这样既没有 DWM 边框，也没有双层圆角问题。

```rust
// ✅ 不透明白色窗口，无 DWM 边框
let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
    .inner_size(440.0, 300.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false);
```

> 卡片用 CSS `border-radius: 16px` + `box-shadow` 营造浮动效果。因为窗口本身不透明，圆角处显示窗口背景色（白色），和卡片颜色一致，圆角效果自然。

### 3.3 子窗口随主窗口最小化

**现象**：主窗口最小化时，弹窗也跟着最小化。

**根因**：`.parent()` 设置的 owner window 会随 owner 最小化。

**解决**：去掉 `.parent()`，弹窗作为完全独立的窗口。

### 3.4 Hash 路由无法通过 URL 传递

**现象**：`WebviewUrl::App("index.html#/reminder-popup")` 不会触发 Vue Router 的 hash 路由。

**根因**：Tauri 的 `WebviewUrl::App` 只解析路径部分，hash fragment 被丢弃。

**解决**：使用 URL query 参数：`WebviewUrl::App("index.html?reminder=popup".into())`，然后在 `main.ts` 中读取并设置 hash。

### 3.5 eval 时序与 Dashboard 闪现

**现象**：弹窗先显示主窗口 Dashboard 内容，约 300ms 后才切换到提醒内容。

**根因**：`eval` 设置 `window.location.hash` 有延迟，Vue 在延迟期间已渲染默认路由。

**解决**：用 URL query 参数在 Vue 挂载前确定路由（见 2.2 节）。eval 只作为向已有 Toast 窗口追加卡片的手段。

### 3.6 窗口左上角闪现

**现象**：弹窗创建后先从左上角闪现一下，然后才移动到目标位置。

**根因**：`build()` 后窗口默认可见，在 `set_position()` 生效前已显示在默认位置（左上角）。

**解决**：
- **新建窗口**：`.visible(false)` 创建隐藏窗口，设置位置后再 `show()`
- **复用窗口**：先 `hide()`，设置位置后再 `show()`

```rust
// ✅ 新建窗口：先隐藏，定位，再显示
let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
    .visible(false)  // 创建时不可见
    ...;

match builder.build() {
    Ok(window) => {
        let _ = window.set_position(...);  // 先定位
        let _ = window.show();              // 再显示
    }
}

// ✅ 复用窗口：先隐藏，定位，再显示
if let Some(window) = app_handle.get_webview_window(label) {
    let _ = window.hide();
    let _ = window.set_position(...);
    let _ = window.show();
    let _ = window.set_focus();
}
```

### 3.7 "webview with label already exists"

**现象**：连续触发提醒时，第二次创建窗口报错 `a webview with label 'reminder-popup' already exists`。

**根因**：`close()` 是异步的，旧窗口还没完全销毁就调用了 `build()`。

**解决**：不复用标签，而是复用窗口实例：

```rust
if let Some(window) = app_handle.get_webview_window(label) {
    let _ = window.hide();
    let _ = window.set_position(...);
    let _ = window.show();
    let _ = window.set_focus();
    return;
}
```

### 3.8 权限：`window.close not allowed`

**现象**：点击弹窗按钮调用 `getCurrentWebviewWindow().close()` 时报权限错误。

**根因**：Tauri v2 的 capabilities 系统需要显式授权 `core:window:allow-close`，且弹窗标签必须列在 `windows` 数组中。

**解决**：

```json
{
  "windows": ["main", "reminder-toast", "reminder-popup", "reminder-fullscreen"],
  "permissions": [
    "core:default",
    "core:window:allow-close"
  ]
}
```

### 3.9 物理像素 vs 逻辑像素（位置偏移）

**现象**：弹窗位置偏移，高分屏下甚至被推到屏幕外。

**根因**：`last_cursor` 存的是物理像素（Windows API 返回），但 `set_position(LogicalPosition)` 需要逻辑像素（已除以 DPI）。

**解决**：使用 `window.center()` 或手动计算时除以 `scale_factor()`：

```rust
let sf = main.scale_factor()?;
let x = pos.x as f64 / sf + (size.width as f64 / sf - pw) / 2.0;
let y = pos.y as f64 / sf + (size.height as f64 / sf - ph) / 2.0;
```

### 3.10 DevTools 在弹窗中打不开

**现象**：按 F12 或调用 `window.open_devtools()` 在弹窗窗口无反应。

**状态**：未解决。主窗口 DevTools 正常，弹窗窗口的 WebView 似乎处于某种隔离状态。目前通过截图 + `eprintln!` 日志调试。

### 3.11 Toast 窗口高度自适应

**现象**：Toast 卡片数量变化时，窗口高度不变，导致新卡片被截断或空白过多。

**解决**：`ReminderToast.vue` 使用 ResizeObserver 监听 `.toast-stack` 高度，调用 `adjustWindowSize()` 命令让 Rust 重新设置窗口大小。Rust 端限制最大高度为 600px，超出时卡片区域内部滚动。

### 3.12 Toast 透明窗口点击穿透

**现象**：透明 Toast 窗口周围空白区域遮挡了下方应用，导致用户无法操作。

**根因**：透明窗口默认会把整个窗口区域都作为可点击区域。

**解决**：
- 窗口尺寸严格贴合卡片内容（见 3.11）。
- 调试模式下背景色可见，便于确认实际窗口范围；关闭调试后背景透明，视觉上只有卡片本身。

---

## 4. 弹窗设计经验

### 4.1 布局原则

- **同类功能同一层级**：所有 snooze 选项（5/10/15/30/自定义）排成网格，不要分散在不同区域
- **跳过按钮单独一行**：全宽 outline 样式，与 snooze 区分层级
- **自定义展开**：点击"自定义" pill 按钮后展开输入框，节省空间

### 4.2 交互细节

- **关闭按钮**：SVG 图标（16×16），32×32px 触摸目标，hover 紫底
- **按钮按压感**：`transform: scale(0.96)` + `transition: 0.2s`
- **输入框光晕**：`focus` 时 `box-shadow: 0 0 0 3px rgba(124,58,237,0.08)`
- **多层阴影**：`0 1px 2px / 0 8px 16px / 0 16px 32px / 0 32px 64px` 营造自然深度

### 4.3 窗口尺寸

最终弹窗尺寸：**440×300**（逻辑像素）

- 足够容纳 3×2 pill 按钮网格 + 自定义展开 + 跳过按钮
- 在主窗口中央显示，不被截断

---

## 5. Toast 实现细节

### 5.1 堆叠与动画

- 每条通知是一个对象：`{ id, boundary, title, body, visible, leaving, hover, progress, remainingMs }`
- `visible` 控制入场动画：DOM 渲染后下一帧设为 true，触发 CSS transition。
- `leaving` 控制离场动画：关闭时先记录卡片位置，更新数据后使用 FLIP 让剩余卡片平滑上移。
- 关闭动画期间再次触发关闭会直接返回，避免并发导致位置错乱。

### 5.2 生命周期

- 默认 8 秒后自动消失，CSS 进度条与 JS 计时器使用同一时长（通过 CSS 变量 `--toast-auto-hide-ms` 统一）。
- `mouseenter` 暂停计时器和 CSS 动画；`mouseleave` 恢复，若剩余时间已耗尽则立即关闭。
- 组件卸载时清理所有定时器。

### 5.3 调试模式

Rust 在创建 Toast 窗口时读取 `toast_debug_mode` 配置，决定窗口背景色：

```rust
let bg_color = if debug_mode {
    Some(Color::from((255, 255, 0, 128)))
} else {
    None
};
```

前端 Debug.vue 提供开关，可实时查看当前焦点窗口、音频会话（Windows）、键鼠计数，以及切换 Toast 调试背景。

### 5.4 水提醒卡片

Toast 通知对象增加 `kind: 'rest' | 'water'` 字段，用于区分休息提醒与喝水提醒：

- **休息卡片**（`kind: 'rest'`）：显示「5 分钟后提醒」「10 分钟后提醒」「跳过本次」，采用紫色主题。
- **喝水卡片**（`kind: 'water'`）：显示「已喝水」「5 分钟后提醒」「跳过本次」，采用与 Dashboard `WaterWidget` 统一的蓝色主题（圆点、进度条、标题、按钮均为蓝色系）。

点击「已喝水」调用 `recordWater()` 记录当前时间，并关闭该卡片；「跳过本次」调用 `skipWaterReminder()`，由后端读取 `water_interval_minutes` 设置 snooze。

Rust 创建 Toast 时通过 `kind` 参数传入类型：

```rust
reminder_toast::create_toast_window(app_handle, boundary, &title, &body, "rest", store);
reminder_toast::create_toast_window(app_handle, 0, &title, &body, "water", store);
```

水提醒没有 `boundary` 概念，因此 `boundary` 传 `0`。

---

## 6. 完整正确代码

### Popup 窗口创建

```rust
fn create_popup_window(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    title: &str,
    body: &str,
    _reminder_state: Arc<Mutex<ReminderState>>,
    store: &ReminderWindowStore,
) {
    let label = "reminder-popup";

    let data = ReminderWindowData {
        boundary,
        title: title.to_string(),
        body: body.to_string(),
        break_minutes: 0,
        fullscreen_bg: None,
        fullscreen_opacity: 0,
    };
    store.lock().unwrap().insert(label.to_string(), data);

    let app = app_handle.clone();

    // 复用已有窗口
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.hide();
        if let Some(main) = app_handle.get_webview_window("main") {
            if let (Ok(pos), Ok(size), Ok(sf)) = (main.outer_position(), main.outer_size(), main.scale_factor()) {
                let pw = 440.0;
                let ph = 300.0;
                let x = pos.x as f64 / sf + (size.width as f64 / sf - pw) / 2.0;
                let y = pos.y as f64 / sf + (size.height as f64 / sf - ph) / 2.0;
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    // 创建新窗口
    tauri::async_runtime::spawn(async move {
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("index.html?reminder=popup".into()),
        )
        .title("Catrace")
        .inner_size(440.0, 300.0)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                if let Some(main) = app.get_webview_window("main") {
                    if let (Ok(pos), Ok(size), Ok(sf)) = (main.outer_position(), main.outer_size(), main.scale_factor()) {
                        let pw = 440.0;
                        let ph = 300.0;
                        let x = pos.x as f64 / sf + (size.width as f64 / sf - pw) / 2.0;
                        let y = pos.y as f64 / sf + (size.height as f64 / sf - ph) / 2.0;
                        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
                    }
                }
                let _ = window.show();

                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Err(e) = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup';") {
                    eprintln!("[PopupWindow] eval failed: {}", e);
                }
            }
            Err(e) => eprintln!("[PopupWindow] build failed: {}", e),
        }
    });
}
```

### main.ts 路由预读

```ts
const url = new URL(window.location.href)
const reminder = url.searchParams.get('reminder')
if (reminder === 'toast' || reminder === 'popup' || reminder === 'fullscreen') {
  (window as any).__CATRACE_REMINDER_TYPE__ = reminder
  const routeMap: Record<string, string> = {
    toast: '#/reminder-toast',
    popup: '#/reminder-popup',
    fullscreen: '#/reminder-fullscreen',
  }
  window.location.hash = routeMap[reminder]
}
```

---

## 7. 关键结论

| 问题 | 结论 |
|------|------|
| 白屏 | `transparent(true)` + `.parent()` 组合导致，单独使用 `.parent()` + 不透明窗口正常 |
| DWM 边框 | Windows 透明窗口固有边框，最简单方案是放弃透明，用不透明白色窗口 |
| 随主窗口最小化 | `.parent()` 的 owner window 行为，去掉 `.parent()` 即可 |
| Hash 路由 | URL query 参数 + `main.ts` 预读，比 eval 更可靠 |
| Dashboard 闪现 | URL query 参数在 Vue 挂载前确定路由，根除闪现 |
| 左上角闪现 | `.visible(false)` 创建隐藏窗口，定位后再 `show()` |
| 标签冲突 | 复用窗口（hide → set_position → show），不要 close 再重建 |
| 权限 | `core:window:allow-close` + 弹窗标签加入 `windows` 数组 |
| 位置偏移 | 物理像素 vs 逻辑像素，除以 `scale_factor()` |
| DevTools | 弹窗中无法打开，用日志和截图调试 |
| Toast 高度自适应 | ResizeObserver + `adjustWindowSize()` 命令，最大高度 600px |
| Toast 并发关闭 | `item.leaving` 标志位保护，避免 FLIP 动画重复触发 |

---

## 8. 全屏背景图架构

### 8.1 存储方案

全屏背景图采用**文件存储 + DB 路径引用**的方式，避免 SQLite 存储大 blob：

```
前端上传 data URL → Rust 解码 base64 → 写入磁盘文件 → DB 存文件路径
前端读取 ← Rust 读取文件 → 编码为 data URL ← DB 读文件路径
```

关键函数：
- `parse_data_url()` — 解析 data URL，返回 (扩展名, 二进制数据)
- `save_bg_image_to_disk()` — 保存到 `app_data_dir/bg/fullscreen_bg.{ext}`
- `file_path_to_data_url()` — 读取磁盘文件，编码为 data URL
- `resolve_bg_for_frontend()` — 统一入口，处理空值 / data URL / 文件路径三种情况

### 8.2 默认背景图

首次启动时，`ensure_default_bg()` 将 bundled `src-tauri/assets/catrace.png` 复制到 `app_data_dir/bg/fullscreen_bg.png`。如果资源文件不存在，返回 `Err` 并清空 DB 设置，避免存储无效路径。

### 8.3 全屏窗口渲染

ReminderFullscreen.vue 使用双层背景：
- **底层** `.fullscreen-bg`：`filter: blur(40px) saturate(1.2)` + `transform: scale(1.05)`，模糊放大铺满
- **上层** `.fullscreen-sharp`：原始图片居中 contain，清晰显示

### 8.4 CSS 透明穿透

进入全屏提醒路由时，`App.vue` 通过 `watch(isReminderRoute)` 切换 `html` 元素的 `reminder-transparent` class，将 `html/body/#app` 背景设为 `transparent !important`，让全屏背景图穿透显示。

### 8.5 元素变换保护

`set_fullscreen_settings` 在 `element_transforms` 为空字符串时保留已有值，避免 Settings.vue 调整背景/透明度/填充模式时覆盖用户在 ReminderFullscreen.vue 中调整的元素位置、缩放和旋转。

---

## 9. 全屏提醒元素独立编辑

### 9.1 功能概述

全屏提醒中的每个元素（标题、正文、倒计时、按钮）可以独立调整位置、缩放和旋转，而不是整体调整。

### 9.2 数据结构

使用 JSON 字符串存储每个元素的变换信息，存储在 `fullscreen_element_transforms` 设置项中：

```json
{
  "title": { "x": 50, "y": 20, "scale": 1.0, "rotate": 0 },
  "body": { "x": 50, "y": 40, "scale": 1.0, "rotate": 0 },
  "countdown": { "x": 50, "y": 60, "scale": 1.0, "rotate": 0 },
  "actions": { "x": 50, "y": 80, "scale": 1.0, "rotate": 0 }
}
```

- `x`, `y`：位置百分比（10-90）
- `scale`：缩放比例（0.3-3.0）
- `rotate`：旋转角度（-180 到 180 度）

### 9.3 交互流程

1. **进入编辑模式**：点击右上角锁图标
2. **选择元素**：点击任意元素（标题/正文/倒计时/按钮）
3. **调整位置**：拖动选中的元素
4. **调整缩放**：鼠标滚轮或底部滑块
5. **调整旋转**：底部滑块
6. **退出编辑模式**：点击锁图标，自动保存

### 9.4 视觉反馈

- 编辑模式下：元素显示虚线边框
- 选中元素：紫色实线边框 + 编辑工具栏
- 拖动时：元素半透明

### 9.5 TypeScript 类型定义

```typescript
interface ElementTransform {
  x: number      // 10-90 百分比
  y: number      // 10-90 百分比
  scale: number  // 0.3-3.0
  rotate: number // -180 到 180 度
}

interface ElementTransforms {
  title: ElementTransform
  body: ElementTransform
  countdown: ElementTransform
  actions: ElementTransform
}
```

---

## 10. 相关文件

- `src-tauri/src/lib.rs` - `create_toast_window`, `create_popup_window`, `create_fullscreen_window`, `show_notification`, `set_fullscreen_settings`
- `src-tauri/src/reminder_toast.rs` - Toast 窗口尺寸与位置计算
- `src-tauri/capabilities/default.json` - 权限配置
- `src/main.ts` - query 参数预读路由
- `src/App.vue` - 条件渲染提醒组件 vs 主布局
- `src/router/index.ts` - 提醒路由（非懒加载）
- `src/views/ReminderToast.vue` - Toast 堆叠卡片 UI
- `src/views/ReminderPopup.vue` - 弹窗 UI
- `src/views/ReminderFullscreen.vue` - 全屏 UI
- `src/views/Settings.vue` - 设置页容器，包含提醒模式、视频与音乐、全屏背景、自定义文案等卡片；每张卡片右上角有拖拽把手，支持拖拽排序
- `src/components/settings/NotificationSettingsCard.vue` - 提醒模式、全屏背景、自定义文案设置
- `src/components/settings/MediaSettingsCard.vue` - 视频与音乐开关、排除列表编辑（Windows，开关关闭时隐藏；排除列表编辑后 500ms 自动保存，「重置为默认」按钮位于标题右侧）；macOS / Linux 仅显示开关占位
- `src/views/Debug.vue` - 调试开关与实时状态
