# Catrace 提醒窗口开发笔记

> 当前提醒窗口实现：Toast / Popup / Fullscreen 三种模式，均基于独立 Tauri WebviewWindow + Vue 组件。

---

## 1. 三种提醒模式

| 模式 | 特点 |
|---|---|
| **Toast** | 右下角浮动通知卡片，支持多条堆叠；8 秒自动消失，hover 暂停；带 snooze / 跳过按钮 |
| **Popup** | 440×300 无边框弹窗，主窗口中央显示，倒计时结束自动关闭 |
| **Fullscreen** | 全屏遮罩，强制聚焦，可自定义背景图与遮罩透明度 |

---

## 2. 数据共享

Rust 侧用 `Arc<Mutex<HashMap<String, ReminderWindowData>>>` 存储提醒数据：

```rust
pub struct ReminderWindowData {
    pub kind: String,                       // "rest" | "water" | "update"（"rest-timer" 通过事件驱动，不经过此处）
    pub boundary: i64,
    pub title: String,
    pub body: String,
    pub break_minutes: i64,
    pub fullscreen_bg: Option<String>,
    pub fullscreen_opacity: i64,
    pub fullscreen_fit_mode: String,
    pub fullscreen_element_transforms: String,
}

pub type ReminderWindowStore = Arc<Mutex<HashMap<String, ReminderWindowData>>>;
```

新窗口通过 `get_reminder_data(label)` 命令读取数据并渲染。

---

## 3. 路由

使用 hash 路由直接创建窗口：

```rust
tauri::WebviewUrl::App("index.html#/reminder-popup".into())
```

提醒路由**不懒加载**：

```ts
import ReminderToast from '../views/ReminderToast.vue'
import ReminderPopup from '../views/ReminderPopup.vue'
import ReminderFullscreen from '../views/ReminderFullscreen.vue'

{ path: '/reminder-toast', component: ReminderToast },
{ path: '/reminder-popup', component: ReminderPopup },
{ path: '/reminder-fullscreen', component: ReminderFullscreen }
```

`App.vue` 通过 `route.path` 判断当前是否处于提醒窗口。

---

## 4. Toast 窗口

### 4.1 核心特点

- **复用**：同一 `reminder-toast` 标签窗口被复用，新通知通过 `window.addToastNotification(...)` 追加卡片；休息计时则通过 Tauri 事件 `catrace-rest-timer` 推送状态。
- **透明背景**：窗口本身透明，视觉完全由 Vue 卡片 CSS 控制。
- **尺寸自适应**：`ReminderToast.vue` 通过 ResizeObserver 监听内容高度，调用 `adjustWindowSize()` 让 Rust 窗口匹配高度（最大 600px）。
- **右下角定位**：Rust 读取当前工作区，将窗口放在包含鼠标光标的显示器右下角。
- **FLIP 动画**：关闭卡片时记录旧位置，更新数据后让下方卡片平滑上移。
- **调试模式**：`toast_debug_mode` 开启时，`ReminderToast.vue` 通过 `.debug-bg` 给窗口根节点加上半透明黄色背景，便于确认窗口范围。切换开关后 Rust 侧通过 Tauri 事件 `catrace-toast-debug-changed` 广播状态变更，Toast 窗口前端用 `listen` 监听并实时更新背景，无需重新创建窗口。Rust 侧 WebviewWindow 的 `background_color` 始终透明，调试背景完全由前端 CSS 控制。
- **休息计时卡片**：当活跃 block 已触发提醒、用户进入休息时，Rust 后端每分钟推送 `catrace-rest-timer` 事件，前端渲染绿色液体球计时器：球内液面高度随 `rest_streak / break_minutes` 上升，表面带有两层反向旋转的波浪与上升气泡动画，球心显示已连续休息分钟数。满 `break_minutes` 后继续累计；恢复活跃后延迟 4 秒自动移除。

### 4.2 卡片类型

- `kind: 'rest'`：紫色主题，按钮为「5 分钟后提醒」「10 分钟后提醒」「跳过本次」。
- `kind: 'water'`：蓝色主题，按钮为「已喝水」「5 分钟后提醒」「跳过本次」。
- `kind: 'update'`：橙色主题，标题为「发现新版本 {version}」，按钮为「查看详情」「立即更新」。点击「查看详情」展开/收起更新日志；点击「立即更新」下载并安装，完成后自动重启。更新卡片不会自动关闭。
- `kind: 'rest-timer'`：绿色主题，以一个带液体流动与气泡动画的球体呈现休息进度，球心显示已连续休息分钟数，正文显示「已连续休息 N 分钟，还需 M 分钟」。不自动关闭，满 `break_minutes` 后标题变为「休息已完成」并继续累计休息时长；恢复活跃后延迟 4 秒移除。该类型不由 `addToastNotification` 直接添加，而是通过 `catrace-rest-timer` 事件驱动。

---

## 5. Popup 窗口

- 尺寸：**440×300** 逻辑像素。
- 位置：主窗口中央。
- 无焦点显示：Windows 下通过 `window_manager` 设置 `WS_EX_NOACTIVATE`，不抢夺当前输入焦点。
- 「自定义」输入框聚焦时临时恢复可聚焦模式，便于输入分钟数。

---

## 6. 无焦点窗口实现

### 6.1 模块

```
src-tauri/src/window_manager/
├── mod.rs          # 插件入口与命令封装
├── shared.rs       # 窗口常量与通用辅助函数
├── windows.rs      # Windows：WS_EX_NOACTIVATE + SW_SHOWNOACTIVATE
└── macos.rs        # macOS：回退到普通显示
```

### 6.2 Windows 核心逻辑

```rust
// 设置 WS_EX_NOACTIVATE
let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
let new_style = style | WS_EX_NOACTIVATE.0 as isize;
SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);

// 无焦点显示并置顶
ShowWindow(hwnd, SW_SHOWNOACTIVATE);
SetWindowPos(
    hwnd,
    Some(HWND_TOPMOST),
    0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER
        | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
);
```

### 6.3 范围

- 使用无焦点显示：`reminder-toast`、`reminder-popup`
- 保持原有行为：`reminder-fullscreen`、主窗口

### 6.4 前端命令

```ts
showWindow(label, noActivate, pinned)
hideWindow(label)
setWindowActiveMode(label, active)
```

### 6.5 窗口复用

Toast/Popup 关闭时调用 `window_manager::hide_window_internal` 隐藏，而非 `close()` 销毁，便于下次无焦点显示。

---

## 7. 全屏背景图

- **存储**：文件存磁盘（`app_data_dir/bg/fullscreen_bg.{ext}`），DB 只存路径。
- **默认图**：首次启动将 bundled `src-tauri/assets/catrace.png` 复制到应用数据目录。
- **渲染**：
  - 底层：模糊放大铺满（`filter: blur(40px) saturate(1.2)` + `scale(1.05)`）
  - 上层：原图居中 contain 显示
- **透明穿透**：进入全屏路由时，`App.vue` 将 `html/body/#app` 背景设为透明。

---

## 8. 全屏元素独立编辑

每个元素（标题、正文、倒计时、按钮）可独立调整位置、缩放、旋转：

```json
{
  "title": { "x": 50, "y": 20, "scale": 1.0, "rotate": 0 },
  "body": { "x": 50, "y": 40, "scale": 1.0, "rotate": 0 },
  "countdown": { "x": 50, "y": 60, "scale": 1.0, "rotate": 0 },
  "actions": { "x": 50, "y": 80, "scale": 1.0, "rotate": 0 }
}
```

交互：点击锁图标进入编辑 → 选中元素 → 拖动位置 / 滚轮缩放 / 滑块旋转 → 再次点击锁图标保存。

---

## 9. 相关文件

| 文件 | 说明 |
|---|---|
| `src-tauri/src/lib.rs` | `create_toast_window`, `create_popup_window`, `create_fullscreen_window`, `show_notification`, `set_fullscreen_settings`, `close_reminder_window`，以及休息计时事件推送 |
| `src-tauri/src/reminder.rs` | 提醒状态机 `ReminderState`（含 `break_timer_active`） |
| `src-tauri/src/db.rs` | 连续休息时长计算 `get_current_rest_streak` |
| `src-tauri/src/reminder_toast.rs` | Toast 窗口位置、复用、调试背景 |
| `src-tauri/src/window_manager/` | 无焦点窗口管理 |
| `src-tauri/capabilities/default.json` | 窗口权限配置 |
| `src/main.ts` | 历史兼容的 query 参数预读路由 |
| `src/App.vue` | 提醒路由 vs 主布局切换 |
| `src/router/index.ts` | 提醒路由（非懒加载） |
| `src/views/ReminderToast.vue` | Toast UI |
| `src/views/ReminderPopup.vue` | Popup UI |
| `src/views/ReminderFullscreen.vue` | 全屏 UI |
| `src/views/Settings.vue` | 设置页容器 |
| `src/components/settings/NotificationSettingsCard.vue` | 提醒模式、全屏背景、文案 |
| `src/components/settings/MediaSettingsCard.vue` | 媒体计入活跃开关与排除列表 |
| `src/views/Debug.vue` | 调试开关与实时状态 |
