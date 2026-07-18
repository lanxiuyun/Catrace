# 2026-07-18 合并前清理 + 版本 bump + hover 修复

## Session goal

合并 `agent通知` 分支前：清理冗余文件、更新版本号到 26.7.18、修复审批卡 hover 消失问题。

## Completed

- 删除根目录 `test-catrace-hook.bat` / `.ps1`，统一入口到 `tools/agent-hook-tester/index.html`
- 删除 tester 旧文件：`server.py`、`agent_hook_tester.py`、`requirements.txt`
- 更新 `tools/agent-hook-tester/README.md` 为只讲双击 html
- 移除 `Dashboard.vue` macOS 诊断 `console.log`
- 版本号 `26.7.16` → `26.7.18`（`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）
- 修复 `ReminderToast.vue` hover 生命周期未豁免 `permission` 卡，导致鼠标移出即关闭

## Remaining

- 合并 `agent通知` 到 main
- 真机回归 P5/P6 场景后发布

## Key file changes

| File | Change |
|------|--------|
| `src/views/Dashboard.vue` | 删除调试日志 |
| `src/views/ReminderToast.vue` | `handleMouseEnter/Leave` 豁免 `kind === 'permission'` |
| `tools/agent-hook-tester/*` | 精简为 `index.html` + `README.md` |
| `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` | bump 26.7.18 |
