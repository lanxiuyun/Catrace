# Catrace Agent Hook 测试页

简单网页，大按钮测 agent 通知 / 审批。不依赖 Qt。

## 启动

1. 先开 **Catrace**（需含 CORS 的版本；agent_hook 已回 `Access-Control-Allow-Origin: *`），Agent 通知开关打开  
2. 任选一种开测试页：

**方式 A — 双击 / 浏览器打开文件（最简单）**

```
tools/agent-hook-tester/index.html
```

**方式 B — 本地小服务**

```bash
python tools/agent-hook-tester/server.py
```

浏览器打开：http://127.0.0.1:8765

页面**直连** `http://127.0.0.1:23456`，不再走代理。

## 怎么用

1. 点 **探测服务** → 显示「在线」  
2. 点 **Stop** → Catrace 应弹常驻待办卡  
3. 点 **UserPromptSubmit** → 卡应消失  
4. 点 **发审批** → 琥珀色卡，去 Catrace 点 Allow/Deny，日志出结果  
5. 或跑一键场景 **S5**：审批弹出后自动发 prompt，测「session 变了不卡死」

## 文件

| 文件 | 作用 |
|------|------|
| `server.py` | 本地服务 + 代理 |
| `index.html` | 测试 UI |
| `agent_hook_tester.py` | 旧 PyQt 版（可选，一般不用） |
