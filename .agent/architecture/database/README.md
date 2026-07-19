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

-- Step 2 Signal（分钟级行为指标；与 records 时间戳对齐 = bucket_start+60）
CREATE TABLE signal_minutes (
    timestamp INTEGER PRIMARY KEY,
    dominant_process_name TEXT,
    foreground_sample_count INTEGER NOT NULL DEFAULT 0,
    foreground_counts_json TEXT,
    key_count INTEGER NOT NULL DEFAULT 0,
    key_sequence_json TEXT,              -- 高敏感，默认不写
    key_sequence_enabled INTEGER NOT NULL DEFAULT 0,
    mouse_distance_px REAL NOT NULL DEFAULT 0,
    mouse_sample_count INTEGER NOT NULL DEFAULT 0,
    mouse_seconds_json TEXT,             -- 长度 60，null=漏采
    collector_version INTEGER NOT NULL DEFAULT 1
);
```

## 写入者

- `lib.rs` — 每分钟结算写入 records + settings；调用 `signal::persist_drained`
- `signal.rs` / `db.rs` — `upsert_signal_minute`、键序列 purge
- `water.rs` — 喝水记录写入 water_records
- `media_audio.rs` — 排除列表读
- 前端通过 Tauri 命令读取（invoke）

> `category` 列已弃用，不再写入。`process_name` 优先来自当分钟 Signal dominant 前台；无数据时为 `unknown`。

## 关键查询

| 函数 | 用途 |
|------|------|
| `get_current_rest_streak()` | 从最新记录向前数连续休息分钟数与起点；遇到 >60s 的时间跳跃（应用未运行）停止 |
| `get_last_real_rest_ts(break_minutes)` | 今天最近一次「连续不活跃 ≥ break_minutes」的结束时间戳；无则 `None`。护眼提醒用它实现「休息完重新计时」 |
| `check_should_notify(window, break_m)` | Block 切分核心：当前 block 是否应触发休息提醒 |
| `upsert_signal_minute` / `get_recent_signal_minutes` | Signal 分钟行读写 |
| `purge_key_sequences_older_than` / `purge_all_key_sequences` | 键序列隐私清理 |

> 「真正休息」统一以 `break_minutes` 为阈值，与主提醒的 block 切分、休息计时球保持同一口径。  
> Signal 细节见 [[desktop-event-os]] signal-collection 文档。