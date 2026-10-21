# Toast 被普通窗口遮挡时的只读诊断日志

2026-10-21 的 15:07:53 通知只留下 `ensure: shown (reuse path)`，实际上这条日志在异步显示任务完成前写入，不能证明置顶成功。此次仅补日志，不改变置顶、焦点、显示或隐藏策略，不宣称已修复。

## 日志怎么找

默认 info 级别即可落盘，搜索 `[DEBUG-toast-zorder]`。这个唯一前缀用于故障排查与后续清理，不要求开启全局 debug。

- `show-before`、`show-after-noactivate-style`、`show-after-topmost-check`、`show-after-showwindow`、`show-completed`：逐段观察样式及层级变化。
- `unminimize`：记录 Tauri 调用结果；`show-completed` 只说明显示函数已执行完毕，不保证之后没有异步状态变化。
- `ensure-before/after`、`hide-before/completed`、`active-mode-before/after`：区分复用、隐藏和用户主动点击带来的变化。
- `sample-change`：每个 Toast 生命周期独立的 500ms 只读采样，记录显示后的状态变化；隐藏后不再扫描桌面，销毁或窗口替换后停止。相同快照不重复落盘。
- 原来的 `shown (reuse path)` 改为 `show requested (reuse path)`，不能当作完成证据。

## 字段与判断边界

`state.toast` 与 `foreground` 包含 HWND、PID/TID、窗口类名、原生可见/最小化状态、扩展样式、TOPMOST/NOACTIVATE、owner、物理矩形及 DWM cloaked 状态。采样另记 `tauri_visible`，便于比较框架与 Win32 状态。

`overlapping_above` 是沿真实 Z 序找到的最多三个可见、未最小化、未 cloaked 的重叠候选窗口，普通窗口也会记录其 `topmost=false`，不预设遮挡者必须置顶。矩形相交不等于不透明像素遮挡，透明窗、owned 弹窗都可能出现，须结合截图判断。

`scan_complete=false` 表示达到候选/遍历上限或读取失败，不得把空列表当成绝对没有遮挡。跨进程枚举不是原子快照；500ms 采样也可能漏掉短暂变化。

不读取窗口标题、浏览器 URL、网页内容、通知正文或进程命令行。仅使用只读 Win32 查询；不新增自愈或层级巡检操作。

## 验证

原生测试在屏幕外创建两个普通窗口，验证能记录普通遮挡窗口且十轮读取不改变焦点、样式、顺序、位置和可见状态。它只验证日志采集，不代表复现了用户原始 bug。

```powershell
cargo test --manifest-path C:\work_sapce\Catrace\src-tauri\Cargo.toml --lib native_snapshot -- --ignored --test-threads=1
```

修改位于本机 `C:\work_sapce\Catrace` 的 `codex/toast-zorder-diagnostics` 分支，已有 tauri dev 可检测源码变化重新编译。不要同时启动两个共享同一用户数据目录的 Catrace 实例。
