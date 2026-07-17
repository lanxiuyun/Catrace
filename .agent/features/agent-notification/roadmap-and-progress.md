# Agent 通知：完整开发计划与进度

> 状态基准：2026-07-17（分支 `agent通知`，含 `7b4398b` PermissionRequest 只通知）  
> 对照：clawd-on-desk 机制见 [clawd-on-desk-agent-notification-mechanism.md](../../reference/clawd-on-desk-agent-notification-mechanism.md)  
> 安装细节：[hook-install-development-guide.md](hook-install-development-guide.md)

## 0. 产品定位（别混层）

| 层 | 是什么 | 不是什么 |
|----|--------|----------|
| **L1 会话待办 Toast** | 右下角 sticky 卡：喊你回来 | 不是聊天窗 |
| **L2 权限审批** | 在 Catrace 里 Allow / Deny（阻塞 hook） | 不是完整对话 |
| **L3 交互小窗** | 独立小窗：摘要 / 批 / 停 / 可选发 prompt | 不是 toast 栈里塞输入框 |

三层递进。**未做 ≠ 不做**；本文件是路线图真源。

用户关注点（设计约束）：

1. 任务中断 / 错误 / 异常  
2. 等 approve  
3. 对话完成、等输入  
4. 可配置策略（召唤 sticky、播报 off，**不钉死**）  
5. 远期：小窗常驻交互  

---

## 1. 进度总表

| 阶段 | 名称 | 状态 | 说明 |
|------|------|------|------|
| **P0** | 最小链路（hook → Toast） | ✅ 完成 | 固定 23456、`/state`、Claude 安装 |
| **P1** | 多 agent + 三态策略 | ✅ 完成 | Codex/Gemini/Kimi；off/auto/sticky |
| **P2** | 会话待办体验 | ✅ 基本完成 | 摘要、前往、提示音、按 session 合并、自动销、默认展开 |
| **P3** | 权限「只通知」 | ✅ 完成 | PermissionRequest → sticky，不代批 |
| **P4** | Hook 安装可靠性 | 🔲 未做 | Windows 命令包装、幂等更新 command、node 绝对路径 |
| **P5** | 实测与发版收口 | 🔲 进行中 | 真 Claude/Codex 实测；升版本号 |
| **P6** | 权限真审批（Allow/Deny） | 📋 已规划未做 | 阻塞 HTTP / 挂起响应；Claude-first |
| **P7** | 交互小窗 | 📋 已规划未做 | 独立窗口；批 + 停 + 可选对话 |
| **P8** | 更多 agent / 插件派 | 🧊 暂缓 | OpenCode / OpenClaw / Hermes 等 |

图例：✅ 完成 · 🔲 待做 · 📋 规划 · 🧊 暂缓

---

## 2. 已完成明细

### P0 — 最小链路 ✅

- [x] `tiny_http` 监听 `127.0.0.1:23456`，仅 `POST /state`  
- [x] 内嵌 `catrace-agent-hook.cjs`（`include_bytes!`）释放到 `app_data_dir/hooks/`  
- [x] Claude：`~/.claude/settings.json` 安装/卸载/检测  
- [x] Toast `kind=agent` 复用 [[toast-window]]  

### P1 — 多 agent + 三态 ✅

- [x] Codex / Gemini / Kimi 安装器（JSON / TOML）  
- [x] 事件别名：`BeforeAgent→UserPromptSubmit`，`AfterAgent→Stop`，`PostToolUseFailure→StopFailure`  
- [x] 策略：`agent_event_modes`（SQLite）+ 设置页 per-event off/auto/sticky  
- [x] auto 8s 去重；sticky 不去重  
- [x] 总开关 `agent_notification_enabled`  

### P2 — 会话待办体验 ✅

- [x] payload：`session_id` / `cwd` / `transcript_path` / `prompt`  
- [x] `summarize_transcript`（倒读 JSONL 末条 assistant，截 80 字）  
- [x] sticky 按 **sessionId** 合并；多会话标题「N 个会话在等你」  
- [x] `AgentToastCard` 独立组件；聚合**默认展开**  
- [x] 前往会话 `open_agent_session`（Win/mac；Linux 暂不支持）  
- [x] 多会话「前往」只销当前条目  
- [x] 提示音 builtin / custom / muted  
- [x] **自动销项**：`UserPromptSubmit` 即使 mode=off 也 `dismiss_agent_session_toast`  

### P3 — PermissionRequest 只通知 ✅

- [x] `KNOWN_EVENTS` + 默认 sticky  
- [x] hook 脚本 `PermissionRequest→permission` + 透传 `tool_name`  
- [x] 摘要兜底：`等待批准：{tool}`  
- [x] 安装：Claude / Codex / Kimi 注册；**Gemini 不注册**（无此事件）  
- [x] i18n / 设置文案人话化  
- [x] **明确不做**：阻塞 `/permission`、Allow/Deny UI（留给 P6）  

---

## 3. 待做明细（按推荐顺序）

### P4 — Hook 安装可靠性 🔲（优先，否则真机测不稳）

**问题**：Windows 上 agent 跑 hook 的 shell 与 clawd 不同；Catrace 现写 `node "path"` 可能静默失败。

| 项 | 内容 | 参考 |
|----|------|------|
| P4.1 | Claude Windows：`shell: powershell` + `& "node" "script"` | clawd `hooks/install.js` |
| P4.2 | Codex：`command` + `commandWindows` 双字段；`&` 调用符 | clawd `codex-install-utils` |
| P4.3 | node **绝对路径**解析（PATH 极简）；失败不覆盖已有绝对路径 | 安装指南 §3.1 |
| P4.4 | WSL：无引号 plain command | 同上 |
| P4.5 | 安装幂等改为 **字段级 sync**（更新 command/timeout），非 skip-if-present | 脚本路径变更会陈旧 |
| P4.6 | Codex `ensure_codex_hooks_feature` 按 `[features]` 表解析，避免叠段 | 已知粗糙点 |
| P4.7 | 写配置前 backup（clawd 有，Catrace 多数路径无） | 可选但推荐 |

**验收**：干净 Windows 机装 Claude hook → 真会话 Stop 必出卡；重装后 command 路径随 app_data 更新。

### P5 — 实测与发版收口 🔲

| 项 | 内容 |
|----|------|
| P5.1 | curl 模拟 Stop / PermissionRequest / UserPromptSubmit 销项（见会话内测试说明） |
| P5.2 | 真 Claude：完成一轮 → sticky；再对话 → 销；权限弹窗时 sticky |
| P5.3 | Codex / Gemini / Kimi 各至少一条真触发 |
| P5.4 | 用户已装 hook 的：**再点安装** 写入 PermissionRequest |
| P5.5 | 版本号三处同步升版（读 [version-management](../../reference/version-management.md)） |
| P5.6 | 发版说明写清：只通知不审批、需重装 hook |

### P6 — 权限真审批（Allow / Deny）📋

**目标**：PermissionRequest 时 Catrace 可代批，agent 阻塞等结果；用户仍可回退终端。

#### 6.1 协议（Claude-first）

```
Claude PermissionRequest hook
  → type: "http"  （或兼容的阻塞 command）
  → Catrace POST /permission  （新端点，阻塞）
  → 挂起 tiny_http Response
  → UI Allow / Deny /（可选 Always）
  → 写回 hook 要求的 JSON 决策
  → 释放连接
```

对照 clawd：

- 端口可固定 23456（单例，不必 23333 漂移）  
- DND / 超时：destroy 连接或返回 deny，让 Claude 回退终端  
- **不要**与现有 async command 的 PermissionRequest 双注册（clawd 会清 stale command hook）

#### 6.2 实现清单

| 项 | 内容 |
|----|------|
| P6.1 | `POST /permission`：读 body、挂起、超时（建议 60–600s 可配） |
| P6.2 | 内存表：`request_id → pending response`；前端决策 invoke 完成 |
| P6.3 | 安装：Claude 改为 HTTP PermissionRequest；卸载清干净 |
| P6.4 | UI：toast 上 Allow/Deny **或** 独立 permission 卡（推荐独立，避免和待办混） |
| P6.5 | Codex PermissionRequest 决策字段约束（clawd：fail-close 若干 future 字段） |
| P6.6 | Kimi Code `PermissionRequest` / `PermissionResult` 对齐 |
| P6.7 | Gemini：评估 BeforeTool gating stdout JSON；风险高可继续跳过 |
| P6.8 | 安全：仅 127.0.0.1；无鉴权但拒绝非本机；日志不落敏感命令全文（可截断） |
| P6.9 | 设置：总开关「在 Catrace 审批」默认关或开（产品定） |

**非目标（P6）**：完整聊天、Always Allow 跨会话策略库（可二期）。

**验收**：Claude 要跑 Bash → Catrace 卡出 → 点 Allow → 终端继续且无二次问；点 Deny → 工具拒绝；Catrace 退出/超时时 Claude 不永久卡死。

### P7 — 交互小窗 📋

**目标**：独立常驻小窗，围绕「当前待办 session」做轻交互。

#### 7.1 信息架构

```
┌─ Agent 面板 ─────────────────────────┐
│ 会话列表（sticky 同源）                │
│  ├ project · 状态点 · 摘要一行         │
│ 详情                                   │
│  ├ 最近 assistant 摘要（transcript）   │
│  ├ [前往终端] [已读] [Stop?]           │
│  └ 若 P6 已上： [Allow] [Deny]         │
│ （可选）输入框 → 注入 prompt           │
└────────────────────────────────────────┘
```

#### 7.2 分步

| 项 | 内容 | 依赖 |
|----|------|------|
| P7.1 | 独立 Tauri 窗口（非 toast 栈）；不抢焦点策略与 toast 一致 | window-manager |
| P7.2 | 与 sticky 同源数据：session 列表增删改 | P2 |
| P7.3 | 详情：摘要 + 前往 + 已读 | P2 |
| P7.4 | 接入 P6 审批按钮 | P6 |
| P7.5 | Stop / 中断：仅在 agent 提供 hook/API 时做；Claude 优先调研 | 调研 |
| P7.6 | 发 prompt：能力因 agent 而异（Claude resume / 管道）；**做不到就灰显** | 调研 |
| P7.7 | 多会话切换；空态 | — |
| P7.8 | 设置入口：打开面板 / 仅 toast / 两者 | — |

**非目标（P7 v1）**：完整 transcript 渲染、多 host（WSL/SSH）、宠物动画、Session HUD 全量。

**验收**：两会话 sticky → 小窗列表 2 条 → 批一条权限 → 列表更新；关 Catrace 不留僵尸 hook 连接。

### P8 — 更多 agent 🧊

- OpenCode / OpenClaw / Hermes：**进程内插件派**，现有 install 模式不够  
- Cursor / Copilot / Qwen 等：有需求再按 [files-to-change…](files-to-change-when-adding-a-new-agent-hook-target.md) 加  
- 插件派单独 ADR，不塞进 P6/P7  

---

## 4. 默认策略矩阵（产品约定）

| 事件 | 默认 mode | 用户可改 | 备注 |
|------|-----------|----------|------|
| SessionStart | off | ✅ | 播报 |
| UserPromptSubmit | off | ✅ | 仍自动销 sticky |
| Stop | sticky | ✅ | 完成 / 等输入 |
| StopFailure | sticky | ✅ | 错误 |
| Notification | sticky | ✅ | 喊你 |
| PermissionRequest | sticky | ✅ | P3 只通知；P6 起可带审批 UI |

原则：**召唤 sticky、播报 off；设置页可改，不钉死。**

---

## 5. 架构演进示意

### 现在（P0–P3）

```
agent hooks (command, async)
    → POST /state
    → 策略 / 去重 / 摘要
    → Toast sticky 待办
    → 前往终端 | 手销 | UserPromptSubmit 自动销
```

### P6 后

```
/state     → 待办 Toast（同现在）
/permission → 挂起 → 审批 UI → 响应 hook
```

### P7 后

```
/state + /permission
    → 数据层（session 待办表）
         ├→ Toast（轻量召唤）
         └→ Agent 小窗（处理中心）
```

---

## 6. 风险与纪律

1. **Hook 永不阻塞 agent（除 P6 明确阻塞的 permission）** — 失败 exit 0，短超时  
2. **只改 marker=`catrace-agent-hook` 条目** — 用户其它 hook 原样  
3. **权限代批 = 安全边界** — 仅本机、可关、超时回退  
4. **Windows 安装不可靠会让一切「像没做」** — P4 应先于大面积宣传  
5. **Toast 与小窗解耦** — 小窗挂了不能拖垮休息提醒 toast  
6. **已装用户升级** — 新事件/HTTP permission 需「重装 Hook」或安装器字段级 sync（P4.5）  

---

## 7. 建议排期（可调）

| 顺序 | 阶段 | 预估体量 | 产出 |
|------|------|----------|------|
| 1 | P4 安装可靠性 | 中 | Windows 真 Claude 稳定出卡 |
| 2 | P5 实测 + 升版 | 小 | 可发版的 P0–P3 |
| 3 | P6 真审批 | 大 | Allow/Deny |
| 4 | P7 小窗 v1 | 大 | 列表面板 + 批 + 前往 |
| 5 | P7.6 发 prompt / Stop | 中 | 能力探测后做 |
| 6 | P8 | 按需 | 新 agent |

---

## 8. 当前进度一句话

**P0–P3 已完成**（链路、四 agent、三态、待办体验、Permission 只通知、自动销、默认展开）。  
**下一步：P4 安装可靠性 → P5 实测发版 → P6 真审批 → P7 交互小窗。**  
Allow/Deny 与小窗已写入本路线图，**延期实现，不是砍掉。**

---

## 9. 相关提交 / 文档

| 内容 | 位置 |
|------|------|
| 三态 + 多 agent | devlog 2026-07-12-agent-notification-event-policy… |
| 摘要/前往/提示音 | devlog 2026-07-12-agent-toast-card-summary… |
| 自动销 sticky | devlog 2026-07-17-agent-sticky-auto-dismiss… |
| Permission 只通知 | commit `7b4398b` |
| 安装改造指南 | [hook-install-development-guide.md](hook-install-development-guide.md) |
| clawd 对照 | [clawd-on-desk-agent-notification-mechanism.md](../../reference/clawd-on-desk-agent-notification-mechanism.md) |
