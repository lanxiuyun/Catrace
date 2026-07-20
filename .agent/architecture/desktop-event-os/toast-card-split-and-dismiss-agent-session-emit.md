# Toast Card 拆分与 dismiss-agent-session emit

## 目标

- 去掉 `window.dismissAgentSession` eval 专用通道
- 将 rest/water/update/rest-timer 内联 UI 拆成与 Eye/Agent/Permission 同级的卡片组件

## 实现

### dismiss

- Rust `dismiss_agent_session_toast` → `app.emit("catrace:dismiss-agent-session", session_id)`
- 前端 `ReminderToast` `listen('catrace:dismiss-agent-session')` → 既有 `dismissAgentSession()` 逻辑
- 调用方不变：`agent_hook` UserPromptSubmit / permission 顶替

### 卡片组件

| kind | 组件 |
|------|------|
| rest | `RestToastCard.vue` |
| water | `WaterToastCard.vue` |
| update | `UpdateToastCard.vue` |
| rest-timer | `RestTimerToastCard.vue` |
| eye / agent / permission | 既有组件 |

`ReminderToast.vue` 保留：堆叠、resize、bus 映射、计时/动作 handlers。

## 手测

1. 久坐测试：rest 卡样式/按钮正常
2. rest-timer：计时球 + 关卡不反复冒出
3. Agent sticky：回到会话或新 permission 顶替 → 旧 session 卡消失（不依赖 eval）
4. 更新卡：详情展开/安装进度（若可触发）
