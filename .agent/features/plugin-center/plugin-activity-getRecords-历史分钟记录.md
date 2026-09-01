# 外置插件读过往热力图：`plugin.activity.getRecords`

Dashboard 只查「今天 0:00 起」。0 点后 UI 换天，**不删** `records`。过往分钟要给插件画热力图，走这条 API，不要让插件自己每分钟 poll 再存一份。

## 用法

```js
const startOfLocalDay = (y, m, d) => Math.floor(new Date(y, m - 1, d).getTime() / 1000)
const from = startOfLocalDay(2026, 8, 31)
const to = startOfLocalDay(2026, 9, 1)
const rows = await plugin.activity.getRecords({ from, to })
// [{ timestamp, active }, ...]
```

- `from` / `to`：unix **秒**（与 `records.timestamp` 同口径），半开区间 `[from, to)`
- 最长 **31 天**；`from >= to` 或跨度过大 → 错误字符串
- 稀疏：没落库的分钟不出现（和宿主 `get_today_records` 一样）。插件自己补 1440 格
- 不含 `process_name` / `signal_minutes`。热力图只需要 `active`
- 要插件**已启用**；窗口 label 须对上（`require_plugin_api`）

Sidecar JSONL / Event HTTP **没有**这条。JS `plugin.activity` 才有。

Demo 插件：`tools/plugin-demo/heatmap/`（作息回顾，settings 翻日期三种视图）。默认关闭。

## 对应代码

| 层 | 位置 |
|---|---|
| DB | `db.get_records_between` |
| 命令 | `plugin_api_get_records`（`plugin_api/events.rs`） |
| JS | `plugin.activity.getRecords`（`src/plugins/pluginApi.ts`） |

## 不要做

- 不要把 `get_records_since(0)` 暴露给插件（无上限，会把整库倒出去）
- 不要在 Dashboard 之外再给宿主加第二套热力图页，除非产品明确要日期切换
- 不要走 sidecar `request` 查 records；那是 host→sidecar RPC
