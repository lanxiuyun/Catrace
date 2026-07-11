# 2026-07-10 护眼提醒功能完成

## 会话目标

实现 GitHub issue #3：为 Catrace 添加护眼提醒功能，并修复相关 Toast 通知的崩溃与显示问题。

## 完成项

- 新增独立的护眼提醒后端模块 `src-tauri/src/eye.rs`
- 前端设置页增加护眼提醒卡片，支持开关、间隔设置、测试通知
- ReminderToast.vue 增加 `kind="eye"` 卡片与绿色主题
- 修复快速连续点击测试按钮导致的 Toast 窗口并发崩溃
- 修复多条通知堆叠时窗口超出屏幕、内容显示不全的问题
- 中文文案统一从「视力提醒」重命名为「护眼提醒」
- 按功能拆分为 4 个独立 git commit

## 后续 UI 精简与组件拆分（同会话追加）

- 护眼提醒改为 25 秒自动关闭，移除「稍后 5/10 分钟」「跳过本次」操作
- 卡片仅保留标题行，移除正文文本，高度自然收缩
- 倒计时移到进度条右侧
- 拆分出 `src/components/EyeToastCard.vue`，独立管理倒计时/进度条/关闭
- 补全 `core:window:allow-current-monitor` 权限，前端 `currentMonitor()` 定位生效
- Rust 端已有窗口分支不再重复定位

## 关键文件变更

| 文件 | 变更 |
|------|------|
| `src-tauri/src/eye.rs` | 新增护眼提醒模块；移除 snooze/skip，仅保留 1s 去重 |
| `src-tauri/src/lib.rs` | 集成护眼提醒到每分钟结算循环；移除 snooze/skip 命令 |
| `src-tauri/src/reminder_toast.rs` | 全局 Mutex 串行化 Toast 窗口操作；已有窗口分支不再定位 |
| `src-tauri/capabilities/default.json` | 补 `core:window:allow-current-monitor` |
| `src/views/ReminderToast.vue` | 护眼卡片改为调度 EyeToastCard；scrollHeight 量高；前端定位 |
| `src/components/EyeToastCard.vue` | 新增护眼专用卡片 |
| `src/components/settings/EyeSettingsCard.vue` | 新增设置卡片 |
| `src/views/Settings.vue` | 注册护眼提醒卡片 |
| `src/api/tauri.ts` | 移除 snooze/skip API |
| `src/i18n/locales/zh-CN.ts` / `en-US.ts` | 护眼提醒文案 |
| `package.json` / `Cargo.toml` / `tauri.conf.json` | 版本升级至 26.7.10 |

## 版本

- 功能提交：`26.7.8`
- Toast 并发修复：`26.7.9`
- 显示优化与文案重命名：`26.7.10`
- 护眼倒计时 + 组件拆分：本次会话追加

## 相关

- [护眼提醒](../features/eye-reminder/README.md)
- [Toast 窗口](../features/toast-window/README.md)
- [Toast 并发崩溃](../bugs/2026-07-10-toast-concurrent-crash.md)
- [Toast 堆叠显示](../bugs/2026-07-10-toast-stacking-display.md)
