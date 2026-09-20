# settle 只看全屏窗口是否存在，不要缓存 fullscreen_active

全屏提醒弹出时，这一分钟应记休息（键鼠不算活跃）。事实来源只能是 **`reminder-fullscreen` 窗口还在不在**。

## 现行行为

`lib.rs` settle 每分钟：

```rust
let is_fullscreen = app_handle
    .get_webview_window(window_manager::FULLSCREEN_WINDOW_LABEL)
    .is_some();
```

`true` → 本分钟 `active=false` 写入 records；`false` → 按 `count >= 3 || media` 判定。

插件/前端快照里的 `fullscreen_active` 字段仍返回，但每次也是现场查窗口，不读进程内 flag。

## 为什么必须这样

曾经用 `AtomicBool fullscreen_active`：创建全屏窗时置 true，关闭时置 false。窗口创建失败、销毁事件没跑到、或窗口已经没了但 flag 还是 true，settle 会**连续数小时** `fscreen=true active=false`，仪表盘全天休息。

窗口在不在是 Win32/tao 的事实；flag 是第二份状态，必然分叉。

## 不要做的

- 不要再给 settle 引入 `AtomicBool` / 快照字段当权威
- 不要在 `skip` / `snooze` 里靠清 flag「恢复追踪」——关窗本身就会让下一分钟变活跃
- 不要把 activity snapshot 里的 `fullscreen_active` 理解成独立开关，它只是窗口存在性的 API 形状
