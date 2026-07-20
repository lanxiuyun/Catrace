# 外部脚本如何发一条 sdk Toast 与进度更新

## 前置

1. Catrace 在跑（dev 或安装版）
2. **调试 → Event SDK** 确认开关开着，复制 token
3. 在**仓库根**执行相对路径脚本，或改用绝对路径

## 探活（无需 token）

```powershell
Invoke-RestMethod http://127.0.0.1:23457/v1/health
```

## 发布一条 Toast

```powershell
$token = "从调试页复制"
$h = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:23457/v1/events -Headers $h `
  -Body '{"title":"Hello M9","body":"from script","level":"info"}'
```

```powershell
$env:CATRACE_EVENT_TOKEN = "..."
node C:\work_sapce\Catrace\tools\event-sdk\publish.mjs --title "Hello"
```

## 进度条（sticky + 多次 PATCH + resolve）

```powershell
cd C:\work_sapce\Catrace
$env:CATRACE_EVENT_TOKEN = "..."
node tools/event-sdk/progress.mjs
```

期望：一张 sticky 卡进度 0→N，结束后 resolve 消失；hub **不要**第二张卡。

## 失败语义

| 情况 | HTTP |
|------|------|
| 无/错 token | 401 |
| 保留 kind（如 water） | 403 |
| 调试页关闭 API | 503（health 仍 200） |
| 超限流 | 429 |

## 实现注意

- 相对路径 `tools/event-sdk/...` 必须在仓库根执行
- Toast 对 `kind===sdk` 先按 `eventId`/`dedupeKey` 原地刷新，再走 `seenBusEventIds`
- 管理组件路径在 `components/settings/`，**入口是 Debug 页**，不是设置网格
