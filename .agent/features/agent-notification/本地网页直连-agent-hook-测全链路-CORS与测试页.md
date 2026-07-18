# 2026-07-18 — 本地网页直连 agent-hook 测全链路（CORS + 测试页）

## 为什么需要

P6 阻塞审批 + session 取消 + sticky 合并，单靠 `curl` / 旧 ps1 难覆盖「并行请求 / 卡 UI / 决策竞态」。  
需要一个能点按钮、看日志、不挡手的本地测试器。

## 方案

| 项 | 选择 | 理由 |
|----|------|------|
| UI | 单页 `index.html` | 比 Qt 简单；双击即开 |
| 连 Catrace | **浏览器直连** `127.0.0.1:23456` | 少一层代理；对齐真实跨源场景 |
| CORS | Catrace `agent_hook` 回 CORS + OPTIONS | 否则 file:// / localhost 页面被拦 |
| 可选 server | `server.py` 只静态托管 | 标准库；不转发业务 |

**否决**：长期依赖 Python 代理转发——file 协议下相对路径 `/proxy` 非法 URL，已踩过；且多一跳不利于对照真实 hook。

## 文件

```
tools/agent-hook-tester/
  index.html          # 测试 UI（主）
  server.py           # 可选：http://127.0.0.1:8765
  README.md
  agent_hook_tester.py / requirements.txt  # 旧 PyQt 版，一般不用
```

## 用法

1. 启动**含 CORS** 的 Catrace，Agent 通知开关开  
2. 打开 `tools/agent-hook-tester/index.html` 或 `python tools/agent-hook-tester/server.py`  
3. 探测 → S1–S6 / 单按钮  

关键场景：S5（审批 + UserPrompt 取消）、S6（同 session 双 permission）、审批中途 Stop（应立刻弹卡，不排队）。

## Catrace 侧约定

- 只绑 `127.0.0.1`，CORS `*` 仅服务本机页面  
- `/permission` 手写响应也要带 CORS 头，否则 fetch 读不到 decision body  
- 改端口时同步测试页默认 23456
