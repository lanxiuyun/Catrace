# 2026-07-12 Agent 通知卡片：摘要/前往会话/提示音 + AgentToastCard 抽离

## Session goal

把 agent 通知从「只有标题的门铃」升级成「会话待办列表」：正文给摘要帮用户判断要不要管，点击直达对应会话，带提示音；同时按用户要求把 agent 卡片从 ReminderToast.vue 抽成独立组件。

## Completed

- hook 脚本透传 `cwd` / `transcript_path` / `prompt`；Rust `summarize_transcript` 倒读 JSONL 取末条 assistant 文本做摘要（截 80 字，失败降级）
- `open_agent_session` 命令：Windows `cmd /c start cmd /k claude -r <sid>`，macOS osascript Terminal，在会话 cwd 下打开
- AgentToastCard.vue 独立组件：项目名+摘要标题、聚合展开式列表（每行前往按钮）、全部已读
- sticky 合并粒度从「按事件名叠加」改为「按 sessionId 增/刷条目」
- 提示音：内置 wav（Node 生成的 180ms/880Hz）释放到 app_data_dir，自定义读本地路径，统一 data URL 给前端 Audio 播；设置页三态（内置/自定义/静音）+ 文本框路径
- 修复双进度条：父模板 progress-bar 条件漏排除 agent kind

## Remaining

- 自动销项（用户已在终端对话时撤掉 sticky 卡）——已确认要做，留后续
- 提示音路径用手填文本框而非文件选择器（避免引入 plugin-dialog），体验不好再换
- 区分事件类型不同提示音未做，先全局一个

## Key file changes

| File | Change |
|------|--------|
| `src-tauri/src/agent_hook.rs` | payload 加字段、summarize_transcript、open_agent_session、提示音三个命令 |
| `src-tauri/src/reminder_toast.rs` | create_agent_toast_window 透传 sessionId/cwd/prompt/summary |
| `src-tauri/resources/catrace-agent-hook.cjs` | 透传 cwd/transcript_path/prompt |
| `src-tauri/resources/agent-notify.wav` | 新增内置提示音 |
| `src/components/AgentToastCard.vue` | 新增：agent 卡片独立组件 |
| `src/views/ReminderToast.vue` | 换用 AgentToastCard；按 sessionId 合并；挂 playAgentSound；修双进度条 |
| `src/components/settings/AgentSettingsCard.vue` | 提示音设置块 |

## 踩坑

- **抽组件后父模板 v-if 漏改 → 双份渲染**：通用 header / body-text / progress-bar 三处按 kind 分支，新组件接管某 kind 时必须把这三处都排除该 kind。双进度条 bug 就是 progress-bar 条件漏加 `item.kind !== 'agent'`，组件内部一条 + 父模板一条叠一起
- **没 ffmpeg / Python 生成提示音**：Windows 上直接用 Node Buffer 手写 WAV 头 + PCM 正弦波（attack-decay 包络），15KB 够用
- **不想为选文件引入 plugin-dialog**：自定义提示音路径用文本框手填，最小依赖；HTML Audio 对 wav/mp3/ogg 都宽容
