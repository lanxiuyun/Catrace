# 数据库

SQLite 文件：`app_data_dir/catrace.db`

## 表结构

```sql
CREATE TABLE records (
    timestamp INTEGER PRIMARY KEY,  -- 整分钟时间戳
    is_active INTEGER,              -- 0=休息, 1=活跃
    process_name TEXT,              -- 焦点窗口进程名
    category TEXT                   -- [已弃用] 保留列兼容旧数据
);

CREATE TABLE water_records (
    timestamp INTEGER PRIMARY KEY   -- 秒级时间戳
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

## 写入者

- `lib.rs` — 每分钟结算写入 records + settings
- `water.rs` — 喝水记录写入 water_records
- `media_audio.rs` — 排除列表读
- 前端通过 Tauri 命令读取（invoke）

> `category` 列已弃用，不再写入。`process_name` 为 `active-win-pos-rs` 获取焦点窗口进程名（可能为空）。

## 关键查询

| 函数 | 用途 |
|------|------|
| `get_current_rest_streak()` | 从最新记录向前数连续休息分钟数与起点；遇到 >60s 的时间跳跃（应用未运行）停止 |
| `get_last_real_rest_ts(break_minutes)` | 今天最近一次「连续不活跃 ≥ break_minutes」的结束时间戳；无则 `None`。护眼提醒用它实现「休息完重新计时」 |
| `check_should_notify(window, break_m)` | Block 切分核心：当前 block 是否应触发休息提醒 |

> 「真正休息」统一以 `break_minutes` 为阈值，与主提醒的 block 切分、休息计时球保持同一口径。
