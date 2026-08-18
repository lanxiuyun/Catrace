# 平台输入层

跨平台键鼠监听的模块组织与条件编译策略。

## 模块层级

```
lib.rs (run 入口)
└── signal::start_input_sampling
    ├── 键盘线程: get_keys() 边沿 @ 50ms（非 DeviceEvents）
    ├── 鼠标线程: get_mouse() 位移 @ ~1Hz + legacy 2s 门闩
    ├── 前台采样 → 分钟桶
    └── lib 内另有: media_audio / 每分钟 settle
```

## 数据流

```
键盘边沿 → ActivityState.count（2s 去重）+ Signal key_count
鼠标位移 → ActivityState.count（2s 门闩）+ Signal mouse_*
音频线程 → state.audio_state
          ↓
每分钟结算 tick → count + audio → 活跃/休息 → SQLite / 提醒
```

## 关键约定

- 键盘/鼠标 **legacy 计数**在 `ActivityState` 的 `Mutex` 内，结算时读并清相关窗口语义
- **禁止**对常驻路径使用 `DeviceEvents`（Windows 100µs busy-poll）
- 鼠标用工位轮询；`device_query` 不提供鼠标移动事件
- 采样线程在 signal 模块 `thread::spawn`，生命周期跟随进程
- macOS accessibility 门闩仍在 `lib.rs` 启动路径

## 新增系统输入源时的修改点

1. `signal.rs` — 采样与分钟桶（优先）
2. `lib.rs` — 若仍影响 settle / `ActivityState`
3. `media_audio.rs` — 音频类检测
4. 更新 [[input-monitoring]] 与相关 bug/决策

## 相关

- [[input-monitoring]] · [2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md](../../bugs/2026-07-20-idle-cpu-过高-device-events-百分之一百微秒轮询.md)
