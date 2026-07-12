# 2026-07-12 Agent 通知：三态策略 + Codex/Gemini/Kimi 接入

## 目标

把 agent 通知从「固定白名单 + 自动消失」升级为「每事件三态策略 + 召唤型常驻」，并接入 Codex / Gemini / Kimi 三个命令 hook 派 agent。

## 完成

- 事件三态策略：off / auto / sticky，存 SQLite `agent_event_modes`，默认 Stop/StopFailure/Notification=sticky，其余 off
- sticky 行为：不去重（后端）、不自动消失、无进度条、hover 不干预、只能手动关；多个 sticky 事件合并进同一张卡片（「N 个会话在等你」）
- 安装器按 agent 分发：Codex（hooks.json + config.toml feature key）、Gemini（settings.json 带 name entry）、Kimi（双代 TOML [[hooks]] 块）
- hook 脚本事件别名映射（BeforeAgent→UserPromptSubmit 等），并改名 .cjs 修复仓库内 ESM 误识别
- 设置页 agent 列表循环渲染

## 遗留

- Codex Windows 平台分支未做（clawd 用 PowerShell `&` + commandWindows 双字段 + WSL interop，Catrace 目前统一 `node "path"`），待实测
- 版本号仍 26.7.15，发版前需三处同步升 26.7.16

## 关键文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/agent_hook.rs` | 三态策略 + 四个 agent 安装器 |
| `src-tauri/resources/catrace-agent-hook.cjs` | 事件别名映射；.js→.cjs |
| `src/views/ReminderToast.vue` | sticky 常驻 + 合并 |
| `src/components/settings/AgentSettingsCard.vue` | agent 列表 + 事件策略 UI |

## 踩坑

- **hook 脚本 .js 在仓库内被当 ESM**：根 package.json 带 `type:module`，Node 按最近 package.json 判定模块类型，`require` 直接崩。release 到 app_data_dir 没问题，但任何仓库内调试/直接执行都会挂——改名 .cjs 根治
