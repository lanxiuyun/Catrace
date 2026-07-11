# 提醒窗口开发细节

> 补充 [toast-window README](README.md) 中未覆盖的实现细节。

## 数据共享

Rust 侧用 `Arc<Mutex<HashMap<String, ReminderWindowData>>>` 存储提醒数据：

```rust
pub struct ReminderWindowData {
    pub kind: String,        // "rest" | "water" | "update"（"rest-timer" 通过事件驱动）
    pub boundary: i64,
    pub title: String,
    pub body: String,
    pub break_minutes: i64,
    pub fullscreen_bg: Option<String>,
    pub fullscreen_opacity: i64,
    pub fullscreen_fit_mode: String,
    pub fullscreen_element_transforms: String,
}
```

新窗口通过 `get_reminder_data(label)` 命令读取。

## 路由

提醒路由非懒加载，hash 直接创建窗口：

```rust
tauri::WebviewUrl::App("index.html#/reminder-popup".into())
```

`App.vue` 通过 `route.path` 判断当前是否处于提醒窗口。

## Toast 窗口细节

- **复用**：同一 `reminder-toast` 标签窗口复用，新通知通过事件追加卡片
- **尺寸自适应**：ResizeObserver 监听内容高度 → `adjustWindowSize()` 匹配窗口
- **定位**：读取工作区，放在包含鼠标光标的显示器右下角；窗口高度不超过工作区高度
- **并发安全**：`reminder_toast.rs` 使用全局 `tokio::sync::Mutex` 串行化所有创建/显示/eval 操作，防止快速连续触发崩溃
- **去重**：同一类非持久提醒（eye/water）只保留一个，避免重复堆叠
- **调试**：`toast_debug_mode` 开启时前端 CSS 加半透明黄色背景，Rust 侧 `background_color` 始终透明
- **休息计时**：Rust 每分钟推送 `catrace-rest-timer` 事件，前端渲染绿色液体球

## Popup 窗口

- 尺寸 440×300
- 主窗口中央定位
- Windows 无焦点显示
- 「自定义」输入框聚焦时临时恢复可聚焦模式

## 全屏背景图

- 文件存磁盘 `app_data_dir/bg/`，DB 只存路径
- 默认图首次启动从 bundled assets 复制
- 双层背景：底层 `blur(40px)` 放大 + 上层原图居中
- 进入全屏路由时 `App.vue` 设 `html/body/#app` 背景透明

## 全屏元素独立编辑

```json
{
  "title": { "x": 50, "y": 20, "scale": 1.0, "rotate": 0 },
  "body": { "x": 50, "y": 40, "scale": 1.0, "rotate": 0 },
  "countdown": { "x": 50, "y": 60, "scale": 1.0, "rotate": 0 },
  "actions": { "x": 50, "y": 80, "scale": 1.0, "rotate": 0 }
}
```

交互：锁图标进入编辑 → 选中元素 → 拖动/滚轮/滑块 → 锁图标保存。
