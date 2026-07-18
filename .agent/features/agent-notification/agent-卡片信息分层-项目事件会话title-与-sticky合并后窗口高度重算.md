# Agent 卡片信息分层：项目 / 事件 / 会话 title + sticky 合并后必须重算窗口高度

## 信息架构（单条 sticky）

```
┌─────────────────────────────────────┐
│ ● 会话 title（顶栏主标题，可两行） × │  ← 呼吸点 + title + 关闭
│ [项目名]  [任务完成]                 │  ← chip：cwd basename + 事件短标签
│ 摘要 / 默认正文                      │
│                      点击前往会话    │
└─────────────────────────────────────┘
```

| 层 | 字段 / 来源 | 没有时 |
|----|-------------|--------|
| **主标题** | `sessionTitle`（Claude 侧栏名） | 退回项目名 → 再退回「AI 助手」 |
| **项目 chip** | `cwd` 最后一段 | 「未知项目」 |
| **事件 chip** | `event` → i18n `settings.agent.eventStop` 等（与设置页同文案） | 原始 event 名 |
| **正文** | transcript 摘要 / prompt / `agent.bodyXxx` | — |

多会话聚合：顶栏改「N 个会话在等你」；每行仍是 项目 chip + 事件 chip + title + 摘要 +「前往」。

**不要**再把「项目 — AI 助手完成了任务」糊成一行标题——项目、事件、会话名语义不同，用户侧栏认的是 session title。

## 会话 title 从哪来

1. hook payload 可选字段 `session_title` / `sessionTitle` / `aiTitle`（脚本透传）  
2. 否则 Rust `extract_session_title(transcript_path)`：倒读 JSONL，找最新  

```json
{"type":"ai-title","aiTitle":"修复 approve 窗口导致线程卡死","sessionId":"..."}
```

路径示例：`~/.claude/projects/<项目编码>/<session_id>.jsonl`  
测试页无 `transcript_path` 时，可手动填 `session_title` 字段验证 UI。

改了 `catrace-agent-hook.cjs` 后要**重装 Hook**（安装时 `include_bytes!` 释放到 app_data_dir）。

## 卡片交互（相对旧版）

- 顶栏：**呼吸点（pulse-dot，事件色 accent）+ 会话 title + ×**；title 仍占主位，点与 title 首行对齐（`margin-top` 微调）  
- 点卡主体（单条）仍前往会话；聚合仍展开/折叠  
- 展开/折叠 emit `layout`，父级 `adjustWindowSize`

## sticky 合并后窗口高度必重算（易踩坑）

`ReminderToast` 合并进已有 sticky 卡时若直接 `return` **不调** `adjustWindowSize`：

- 窗口仍是旧高度  
- stack `overflow-y: auto` → 内容只在内部滚  
- ResizeObserver 看的是 client 尺寸，**看不到**变高  
- 结果：底部「前往 / 全部已读」被裁掉  

**纪律**：

1. sticky 合并路径：`nextTick` + rAF 后 `adjustWindowSize` + `scrollStackToBottom`  
2. 卡片展开/折叠：`@layout` → 父级重算  
3. `adjustWindowSize` 优先按**每张卡** `scrollHeight` 累加 + `CARD_GAP`，不要只信被窗口卡住时的 `stack.scrollHeight`  
4. `.toast-card-agent` / `.toast-card-permission` 设 `min-height: auto`，内容自撑  

相关实现：`AgentToastCard.vue`、`ReminderToast.vue::adjustWindowSize` / sticky 合并分支。
