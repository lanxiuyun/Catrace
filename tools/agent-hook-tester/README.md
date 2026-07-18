# Catrace Agent Hook 测试页

一个纯 HTML 调试页，大按钮测 agent 通知 / 审批。

## 启动

1. 先开 **Catrace**（需含 CORS 的版本；agent_hook 已回 `Access-Control-Allow-Origin: *`），Agent 通知开关打开
2. 双击打开：

```
tools/agent-hook-tester/index.html
```

页面**直连** `http://127.0.0.1:23456`，无需额外服务。

## 怎么用

1. 点 **探测服务** → 显示「在线」
2. 点 **Stop** → Catrace 应弹常驻待办卡
3. 点 **UserPromptSubmit** → 卡应消失
4. 点 **发审批** → 琥珀色卡，去 Catrace 点 Allow/Deny，日志出结果
5. 或跑一键场景 **S5**：审批弹出后自动发 prompt，测「session 变了不卡死」
