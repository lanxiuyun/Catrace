# Catrace 弹窗提醒开发笔记

> Tauri v2 + Vue 3 多模式提醒窗口（Toast / Popup / Fullscreen）踩坑与解决方案

---

## 1. 需求背景

Catrace 需要三种提醒方式：
- **Toast**：系统级通知（Windows Toast）
- **Popup**：小弹窗（400×220，跟随鼠标，无边框，置顶）
- **Fullscreen**：全屏遮罩（全屏 + 透明背景 + 倒计时）

Popup 和 Fullscreen 都是独立的 Tauri WebviewWindow，与主窗口共享同一套 Vue 构建产物，但渲染不同的组件。

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

主入口 `App.vue` 通过 `window.__CATRACE_REMINDER_TYPE__` 判断当前是弹窗模式还是主窗口模式：

```vue
const isReminderRoute = computed(() => {
  const type = (window as any).__CATRACE_REMINDER_TYPE__
  return type === 'popup' || type === 'fullscreen'
})
```

提醒路由不使用懒加载（避免新窗口 chunk 加载失败）：

```ts
import ReminderPopup from '../views/ReminderPopup.vue'
import ReminderFullscreen from '../views/ReminderFullscreen.vue'

{ path: '/reminder-popup', component: ReminderPopup }
{ path: '/reminder-fullscreen', component: ReminderFullscreen }
```

---

## 3. 踩坑记录

### 3.1 白屏问题（最关键）

**现象**：弹窗窗口创建后一片空白，DevTools 无法打开，没有任何报错。

**根因**：`WebviewWindowBuilder` 链式调用了 `.parent(&main_window)`。在 Tauri v2 中，`parent` 会导致子窗口的页面加载事件被某种机制阻塞，WebView 无法完成初始化和渲染。

**错误代码**：

```rust
// ❌ 会导致白屏
let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
    .parent(&main_window)  // <- 罪魁祸首
    .inner_size(400.0, 220.0)
    ...;
```

**解决**：移除 `.parent()` 调用，弹窗作为独立顶层窗口：

```rust
// ✅ 正常渲染
let builder = tauri::WebviewWindowBuilder::new(&app, label, url)
    .inner_size(400.0, 220.0)
    ...;
```

> 注意：移除 `parent` 后，弹窗不再随主窗口移动/最小化，但这正是我们想要的行为（独立提醒窗口）。

---

### 3.2 Hash 路由无法通过 URL 传递

**现象**：`WebviewUrl::App("index.html#/reminder-popup")` 不会触发 Vue Router 的 hash 路由。

**根因**：Tauri 的 `WebviewUrl::App` 只解析路径部分，hash fragment 被丢弃。Vue Router 使用的是前端 hash 模式，需要浏览器执行 JS 后才能设置 `location.hash`。

**错误代码**：

```rust
// ❌ hash 被忽略，路由不会切换到 /reminder-popup
WebviewUrl::App("index.html#/reminder-popup".into())
```

**解决**：先用普通 `index.html` 创建窗口，再通过 `window.eval()` 设置全局变量和 hash：

```rust
// 1. 创建窗口（纯 index.html）
let builder = tauri::WebviewWindowBuilder::new(&app, label,
    tauri::WebviewUrl::App("index.html".into()));

// 2. 等待页面加载（300ms 足够）
tokio::time::sleep(Duration::from_millis(300)).await;

// 3. eval 设置变量 + 切换路由
window.eval(r#"
    window.__CATRACE_REMINDER_TYPE__ = 'popup';
    window.location.hash = '#/reminder-popup';
"#)?;
```

---

### 3.3 eval 时序问题

**现象**：`eval` 执行过早时，Vue 应用可能还没挂载，导致 `__CATRACE_REMINDER_TYPE__` 变量虽然设置但路由未切换。

**尝试过的方案**：

| 方案 | 结果 |
|------|------|
| 立即 `eval`（窗口创建后 0ms） | 路由偶尔不切换 |
| 监听 `window.webviewWindow.onResized` 后再 eval | 不可靠，有时不触发 |
| 5 次重试循环（每次 500ms） | 能工作，但冗余且日志刷屏 |
| `run_on_main_thread` + 立即 eval | 比 spawn 稳定一些 |

**最终方案**：`tokio::async_runtime::spawn` + `sleep(300ms)` + 单次 `eval`：

```rust
tauri::async_runtime::spawn(async move {
    match builder.build() {
        Ok(window) => {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = window.eval("...");
        }
        Err(e) => eprintln!("[PopupWindow] build failed: {}", e),
    }
});
```

300ms 是在开发环境实测的"足够快又不会白屏"的平衡点。生产构建加载更快，300ms 绰绰有余。

---

### 3.4 "webview with label already exists"

**现象**：连续触发提醒（如快速点击"测试通知"）时，第二次创建窗口报错 `a webview with label 'reminder-popup' already exists`。

**根因**：`close()` 是异步的，旧窗口还没完全销毁就调用了 `build()`。

**错误代码**：

```rust
// ❌ close() 后立即 build()，标签还没释放
if let Some(existing) = app_handle.get_webview_window(label) {
    let _ = existing.close();  // 异步关闭，不会等待完成
}
// ... 立即 build() -> 报错
```

**解决**：不复用标签，而是复用窗口实例：

```rust
// ✅ 窗口已存在则 show + focus + 重新 eval
if let Some(window) = app_handle.get_webview_window(label) {
    let _ = window.show();
    let _ = window.set_focus();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup'; window.location.hash = '#/reminder-popup';");
    });
    return;
}

// 只有不存在时才创建新窗口
```

这样避免了标签冲突，同时复用已有窗口也更高效。

---

### 3.5 全屏透明窗口

Fullscreen 模式需要：
- 全屏覆盖整个显示器
- 透明背景（用户可上传自定义背景图）
- 不显示在任务栏
- 始终置顶

配置：

```rust
tauri::WebviewWindowBuilder::new(&app, label, url)
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false);
```

> `transparent(true)` 必须与前端配合：根元素设置 `background: transparent`，否则默认白色背景会盖住透明效果。

---

### 3.6 DevTools 在弹窗中打不开

**现象**：按 F12 或调用 `window.open_devtools()` 在弹窗窗口无反应。

**状态**：未解决。主窗口 DevTools 正常，弹窗窗口的 WebView 似乎处于某种隔离状态。目前通过 Playwright 截图 + `eprintln!` 日志调试。

---

## 4. 完整正确代码

### Popup 窗口创建

```rust
fn create_popup_window(
    app_handle: &tauri::AppHandle,
    boundary: i64,
    title: &str,
    body: &str,
    mouse_pos: (i32, i32),
    store: &ReminderWindowStore,
) {
    let label = "reminder-popup";

    // 1. 更新共享数据
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
    let (mx, my) = mouse_pos;

    // 2. 复用已有窗口
    if let Some(window) = app_handle.get_webview_window(label) {
        let x = (mx as f64).max(0.0);
        let y = (my as f64).max(0.0);
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        let _ = window.show();
        let _ = window.set_focus();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup'; window.location.hash = '#/reminder-popup';");
        });
        return;
    }

    // 3. 创建新窗口
    tauri::async_runtime::spawn(async move {
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Catrace")
        .inner_size(400.0, 220.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false);

        match builder.build() {
            Ok(window) => {
                let x = (mx as f64).max(0.0);
                let y = (my as f64).max(0.0);
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));

                tokio::time::sleep(Duration::from_millis(300)).await;
                if let Err(e) = window.eval("window.__CATRACE_REMINDER_TYPE__ = 'popup'; window.location.hash = '#/reminder-popup';") {
                    eprintln!("[PopupWindow] eval failed: {}", e);
                }
            }
            Err(e) => eprintln!("[PopupWindow] build failed: {}", e),
        }
    });
}
```

### Fullscreen 窗口创建

与 Popup 类似，区别是：
- `label = "reminder-fullscreen"`
- `.fullscreen(true)` 替代 `.inner_size()`
- `.transparent(true)` 添加透明背景
- 无需设置位置（全屏自动覆盖）
- eval 设置 `__CATRACE_REMINDER_TYPE__ = 'fullscreen'` 和 `#/reminder-fullscreen`

---

## 5. 关键结论

| 问题 | 结论 |
|------|------|
| 白屏 | **不要**对独立弹窗使用 `.parent()` |
| Hash 路由 | URL 不能带 hash，用 `eval` 设置 `location.hash` |
| eval 时机 | 窗口创建后 `sleep(300ms)` 再 eval，单次足够 |
| 窗口复用 | `get_webview_window(label)` 返回 `Some` 时复用，不要 `close()` 再重建 |
| 标签冲突 | 复用窗口是解决 "already exists" 的唯一可靠方案 |
| 透明背景 | `transparent(true)` + 前端根元素 `background: transparent` |
| DevTools | 弹窗中无法打开，用日志和截图调试 |

---

## 6. 相关文件

- `src-tauri/src/lib.rs` - `create_popup_window`, `create_fullscreen_window`, `show_notification`
- `src/App.vue` - 条件渲染提醒组件 vs 主布局
- `src/router/index.ts` - 提醒路由（非懒加载）
- `src/views/ReminderPopup.vue` - 弹窗 UI
- `src/views/ReminderFullscreen.vue` - 全屏 UI
- `src/views/Settings.vue` - 提醒模式设置
