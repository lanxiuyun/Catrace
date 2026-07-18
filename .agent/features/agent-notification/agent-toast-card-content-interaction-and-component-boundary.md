# Agent 通知卡片：内容、交互与组件边界

agent 通知的定位是**会话待办列表**，不是消息推送：每张卡 = 一个需要用户处理的 agent 会话。本文档记录卡片内容来源、交互动作和与 [[toast-window]] 的组件边界。

## 卡片内容从哪来

hook payload 经脚本透传到后端（`catrace-agent-hook.cjs` → `agent_hook.rs`）：

| 字段 | 来源 | 用途 |
|------|------|------|
| `session_id` | hook stdin | 合并粒度 + `claude -r` 恢复 + 审批挂起按 session 清理 |
| `cwd` | hook stdin | 项目 chip（basename）+ 终端工作目录 |
| `transcript_path` | hook stdin | 摘要（末条 assistant）+ 会话 title（`ai-title`） |
| `prompt` | hook stdin | UserPromptSubmit 摘要兜底 |
| `session_title` | 可选 payload / transcript | 卡顶主标题（Claude 侧栏名） |

摘要（`summarize_transcript`）：倒找 `type=assistant` 文本，首行截 80 字；没有则前端 `agent.bodyXxx`。  
会话 title（`extract_session_title` / `resolve_session_title`）：payload 优先，否则 transcript 最新 `{"type":"ai-title","aiTitle":…}`。

**卡面分层**（项目 chip / 事件 chip / 顶栏 title / 正文）详见  
[agent-卡片信息分层-项目事件会话title-与-sticky合并后窗口高度重算.md](agent-卡片信息分层-项目事件会话title-与-sticky合并后窗口高度重算.md)。

## 交互动作

| 动作 | 行为 |
|------|------|
| 点卡片主体（单条） | `open_agent_session(cwd, session_id)`；成功后整卡关 |
| 点卡片主体（聚合） | 展开/折叠，并 `emit('layout')` 让父级重算窗口高度 |
| 聚合列表每行「前往」 | 只销该 session 条目（`dismissEntry`） |
| 右上 × | 已读消失 |
| 聚合卡底部「全部已读」 | 整体消失 |
| **自动销项** | `UserPromptSubmit` → 后端 timeout 该 session 挂起审批 + `dismiss_agent_session_toast` → 前端同时清 agent 条目与 permission 卡 |

打开终端失败时**保留卡片**让用户重试。

## 自动销项细节

- 触发点在 `handle_request`，**先于**三态判断；`UserPromptSubmit` 默认 off 仍销项。
- 只匹配 `session_id` 非空且 ≠ `"unknown"`。
- 前端 `dismissAgentSession`：permission 卡按 session 整卡关 + agent 条目过滤。
- sticky **合并进已有卡**后必须 `adjustWindowSize`，否则窗口高度不涨、底部按钮被裁——见信息分层子文档。

## sticky 合并粒度：按 sessionId

同一会话新事件**刷新**条目，不同会话**追加**。不要用事件名做 merge key。

## 组件边界（解耦纪律）

`ReminderToast.vue` 只管栈生命周期；内容下沉：

```
ReminderToast.vue（栈管理 + 窗口高度）
├── EyeToastCard.vue
├── AgentToastCard.vue      — kind=agent
├── PermissionToastCard.vue — kind=permission（P6）
└── 通用 header/body — rest / water / update / rest-timer
```

父模板里通用 header / body-text / progress-bar 的 v-if **必须排除** agent 与 permission，否则双份渲染。

## 提示音

- 后端 `get_agent_sound_data_url`：builtin 把 `resources/agent-notify.wav` 释放到 `app_data_dir/sounds/` 读回；custom 读用户路径；统一 base64 成 data URL
- 前端 Toast 窗口首次加载缓存 data URL，agent 事件入栈时 `new Audio().play()`
- 配置存 SQLite（`agent_sound_mode` / `agent_sound_path`），设置页三态：内置/自定义/静音
- 不引入 fs/dialog 插件：自定义路径用文本框手填，最小依赖
