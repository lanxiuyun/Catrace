# 自动更新检查

## 涉及文件

- `src-tauri/src/lib.rs` — 启动 3 秒后通过 `tauri-plugin-updater` 检查更新
- `src-tauri/src/reminder_toast.rs` — 创建更新 Toast
- `src/views/ReminderToast.vue` — 更新卡片 UI
- `src/components/settings/SystemSettingsCard.vue` — 设置页手动检查 / 安装更新
- `src-tauri/tauri.conf.json` — updater endpoint（GitHub Release 静态 JSON）

## 行为

- 应用启动 3 秒后异步检查一次
- endpoint 直连 GitHub Release：`https://github.com/lanxiuyun/Catrace/releases/latest/download/latest.json`（跟随 302 跳转到最新 release）
- `latest.json` 由 CI（`tauri-action`）自动生成并上传到 Release
- 有新版本 → 右下角橙色更新 Toast
- 卡片不自动关，含「查看详情」（展开 changelog）和「立即更新」（下载+安装+重启）
- 下载中有进度条
- 检查失败仅日志，不阻断启动
- 整个生命周期只检查一次
