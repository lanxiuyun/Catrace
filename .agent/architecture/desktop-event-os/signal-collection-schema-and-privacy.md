# Signal 采集、表结构与隐私

## 采集线程

| 线程 | 频率 | 写入 |
|------|------|------|
| Foreground | 1Hz | 分钟桶进程名频次（锁外 `get_active_window`） |
| Keyboard | callback | `key_count`；可选序列；**另** 2s debounce → `ActivityState.count` |
| Mouse | 1Hz | 欧氏位移 → 分钟总量 + `mouse_seconds[60]`；**另** 2s 移动门闩 → legacy count |

macOS：前台可不依赖辅助功能；键鼠仍走既有 accessibility 门闩。

## 分钟时间约定

- 桶键：`floor(unix/60)*60`（窗口 **开始**）
- 落库 `signal_minutes.timestamp` = 桶键 **+ 60**，与 `records.timestamp`（settle 整分）对齐
- settle：`persist_drained` 在写 `insert_record` 前 drain，dominant 回填 `process_name`

## 表 `signal_minutes`

```
timestamp PK
dominant_process_name
foreground_sample_count / foreground_counts_json
key_count / key_sequence_json / key_sequence_enabled
mouse_distance_px / mouse_sample_count / mouse_seconds_json
collector_version
```

- 独立表，不污染 `records` 提醒查询
- signal 写失败只 log，不挡活跃记录与提醒

## 鼠标

- **不存**坐标、不存轨迹点
- 每秒距离；`null`=漏采，`0`=静止
- 启动首点 / 间隔 >~5s：重置基线，不写虚假大跳

## 按键序列（高敏感）

| 项 | 策略 |
|----|------|
| 默认 | **关**；Rust 运行时默认 false |
| 开启 | 设置页二次确认；plugin-store `signal_key_sequence_enabled` |
| 内容 | 逻辑键名流（`KeyA`/`Enter`…），非 Unicode 打字还原；不关联前台 app |
| 保留 | 默认 24h；可 1h/24h/7d；超时清 `key_sequence_json`，可留 `key_count` |
| 禁止 | 不上 report；不进 Event bus；日志不 dump 明文序列 |

设置：`SignalSettingsCard` + `set_signal_key_sequence_*` / `purge_key_sequences`。

## 与旧 input-monitoring 关系

- 原 `lib.rs` 内嵌采样已下沉 `signal.rs`
- [[input-monitoring]] 文档描述的「2s 去重活跃计数」语义 **保留**，供休息判定
- 扩展指标一律进 `signal_minutes`，不要塞进 `records` JSON 大杂烩

相关：[step2-roadmap…](step2-roadmap-event-core-and-signal-core.md) · [[database]] · [[input-monitoring]]
