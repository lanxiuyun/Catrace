# Agent 通知卡片：内容、交互与组件边界

agent 通知的定位是**会话待办列表**，不是消息推送：每张卡 = 一个需要用户处理的 agent 会话。本文档记录卡片内容来源、交互动作和与 [[toast-window]] 的组件边界。

## 卡片内容从哪来

hook payload 经脚本透传到后端（`catrace-agent-hook.cjs` → `agent_hook.rs`）：

| 字段 | 来源 | 用途 |
|------|------|------|
| `session_id` | hook stdin | 合并粒度 + `claude -r` 恢复 |
| `cwd` | hook stdin | 项目名（取 basename 进标题）+ 终端工作目录 |
| `transcript_path` | hook stdin | Rust 倒读 JSONL 取最后一条 assistant 文本做摘要 |
| `prompt` | hook stdin | UserPromptSubmit 事件的摘要兜底 |

摘要生成规则（`agent_hook.rs::summarize_transcript`）：
- 从 transcript **末尾倒找**第一条 `type=assistant` 的文本 content，取首行截 80 字
- 读不到/没有文本 → None，前端降级为事件默认文案（`agent.bodyXxx`）
- UserPromptSubmit 没有 transcript 可用时，用用户输入的 prompt 原文当摘要

## 交互动作

| 动作 | 行为 |
|------|------|
| 点卡片主体（单条） | `open_agent_session(cwd, session_id)`：Windows `cmd /c start cmd /k claude -r <sid>`，macOS osascript Terminal；成功后卡片消失 |
| 点卡片主体（聚合） | 展开/折叠列表 |
| 聚合列表每行「前往」 | 同上，单个会话 |
| 右上 × | 已读消失 |
| 聚合卡底部「全部已读」 | 整体消失 |

打开终端失败时**保留卡片**让用户重试，不静默吞掉。

## sticky 合并粒度：按 sessionId

同一会话的新事件**刷新**已有条目（新摘要覆盖旧的），不同会话**追加**新条目。
不要用事件名做合并 key——同一事件多次触发会丢信息，同会话多事件又会重复列。

## 组件边界（解耦纪律）

`ReminderToast.vue` 只管通知栈生命周期（入栈、计时、FLIP 动画、窗口尺寸），**卡片内容渲染全部下沉到专用组件**：

```
ReminderToast.vue（栈管理）
├── EyeToastCard.vue     — kind=eye
├── AgentToastCard.vue   — kind=agent（本目录）
└── 通用 header/body/actions — rest / water / update / rest-timer
```

抽组件时**必须同步检查父模板里按 kind 分支的 v-if**：通用 header、body-text、progress-bar 三处都要把新 kind 排除，否则会和组件内部渲染叠成双份（2026-07-12 双进度条 bug 就是这么来的——progress-bar 条件漏加 `item.kind !== 'agent'`）。

## 提示音

- 后端 `get_agent_sound_data_url`：builtin 把 `resources/agent-notify.wav` 释放到 `app_data_dir/sounds/` 读回；custom 读用户路径；统一 base64 成 data URL
- 前端 Toast 窗口首次加载缓存 data URL，agent 事件入栈时 `new Audio().play()`
- 配置存 SQLite（`agent_sound_mode` / `agent_sound_path`），设置页三态：内置/自定义/静音
- 不引入 fs/dialog 插件：自定义路径用文本框手填，最小依赖
