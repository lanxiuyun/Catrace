# Debug 页 Signal 分钟桶展示

## 目的

M6 清单要求能验：运行 ≥2 分钟后 `signal_minutes` 有 dominant / key_count / mouse 60 槽；键序列开关影响 `key_sequence_json`。
此前 API（`get_recent_signal_minutes` / `get_signal_runtime_config`）已有，设置页只有隐私开关，**Debug 页无摘要**。

## 实现

`src/views/Debug.vue` 增加「Signal 分钟桶」卡片：

- 每 2s 与媒体调试一并刷新
- 运行时：键序列开关、保留小时、pending 桶数、当前分钟 key/mouse 快照（**不展示序列明文**）
- 最近 12 条落库分钟：时间（分钟结束 ts）、主导应用、前台采样、按键数、序列有/无、鼠标距离、mouse 槽填充 `n/60`

## 手测

1. `pnpm tauri dev`，打开 Debug，运行 ≥2 分钟并动键鼠。
2. 表中出现行；默认键序列关时「序列」列为无。
3. 设置开启键序列 → 新分钟落库后可为有 → purge 后历史序列清空。
