# 快捷回复输入框：为什么没做，以及要做时的框架

> 2026-09-30 按钮功能落地时的取舍记录。带输入框（`hint-inputId`）的通知按钮目前**不渲染**，解析层记 `needs input` 日志——本文档说明为什么，以及哪天要做时从哪里接手。

## 为什么没做：可达性几乎为零，不是技术不可行

输入值的传递机制是现成的：原生回复就是激活器被调用时收到 `NOTIFICATION_USER_INPUT_DATA { Key: 输入框id, Value: 用户文本 }` 数组，`INotificationActivationCallback::Activate` 本来就有这个参数（当前传空数组）。卡在「谁能被我们调到」：

- **发回复型通知的应用恰好都代点不到**：Outlook、ChatGPT/Codex 这类带 Reply 的全是打包应用，激活器登记在 PackagedCom 目录——不在公共 COM 注册表里，`CoCreateInstance` 实测返回 `REGDB_E_CLASSNOTREG`，只有 Windows 通知平台自己能唤起。目前没有公开的第三方委托机制。
- **能代点的应用又不发回复型通知**：未打包 + 注册了 CustomActivator 的（本机剪映、PowerShell）都不发带输入框的通知。
- 两头一对：功能做完，本机唯一能填它的只有自造的测试通知。

## 要做时的框架（增量都不大）

| 层 | 改动 | 量级 |
|---|---|---|
| 后端解析 | 解析 `<input id/placeholder>`，带输入的 action 从「跳过」改为「携带 input id 存档」进 specs | ~50 行 + 测试 |
| 后端触发 | `trigger_notification_action` 加 `input_value` 参数，构造 `NOTIFICATION_USER_INPUT_DATA` 传给 Activate | ~15 行 |
| 前端卡片 | `NotificationToastCard` 渲染输入框 + 回车提交 + 输入内容随 item 状态保持；点击输入框走现有「点卡片才抢焦点」（toast 窗默认 noactivate，不打焦点没法打字）；IME 中文输入、trim | ~100–150 行，大头 |
| 交互 | 回复卡要考虑停留时长：默认 6s 自动收起对打字太短（hover 本就暂停计时，可再延长或 sticky 化） | 零碎 |

测试素材现成：`e2e-temp/toast-actions.ps1 -WithInput`（仿 ChatGPT Reply 结构：`<input>` + `hint-inputId`）。

## 何时值得做

- 出现真实的**未打包**应用来源发回复型通知（未打包激活器这条路已验证可通），或
- 微软开放打包应用激活的委托机制（目前没有），或
- 明确要支持某个具体应用时，先跑 `e2e-temp/probe-listener.ps1` 看它的通知长什么样再动手。
