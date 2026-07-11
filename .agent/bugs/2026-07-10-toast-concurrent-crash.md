# 2026-07-10 Toast 窗口并发崩溃

## 现象

快速连续点击「护眼提醒」测试按钮时，应用崩溃。

## 根因

`reminder_toast.rs` 中 `create_toast_window` / `create_update_toast_window` 涉及多个 WebviewWindow 操作：

- 定位窗口
- `window.eval()` 向前端注入通知
- `show_reminder_no_activate()` 显示窗口

这些操作在 Windows 上要求主线程，且连续快速触发时会并发执行 `tauri::async_runtime::spawn`，导致 WebView / Win32 状态竞争并崩溃。

## 修复

- 引入全局异步锁 `static TOAST_MUTEX: Mutex<()> = Mutex::const_new(())`
- 将创建/定位/eval/显示等全部窗口操作移入同一把锁保护的异步任务中，保证同一时刻只有一个 Toast 操作在执行
- 兜底创建窗口前在锁内二次检查窗口是否已存在，避免并发重复创建
- `eye.rs` 的测试命令增加 1 秒 debounce，降低用户快速点击时的触发频率

## 涉及文件

- `src-tauri/src/reminder_toast.rs`
- `src-tauri/src/eye.rs`

## 相关

- [[toast-window]]
