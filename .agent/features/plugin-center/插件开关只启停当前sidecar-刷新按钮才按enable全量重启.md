# 插件开关只启停当前 sidecar，刷新按钮才按 enable 全量重启

外部插件的本机进程（sidecar）生命周期只跟两件事走，不要用「改了文件 / 开关了别人」去扫全表。

## 三句话

1. **开 = 只启动这一颗；关 = 只停这一颗。** 不碰其他插件的进程树（含 sidecar 拉起的孙进程，如 bt-music 的播放器）。
2. **改了 X 的脚本要只换 X：** 把 X 关掉再打开。关开 = 停旧进程、按磁盘再 spawn，别人不动。
3. **插件页刷新按钮：** 按当前 enable/disable 全量走一遍（enabled 全部重启，disabled 停掉）。这是唯一的「全员 reload」。

没有文件监视。存盘不会自动重启。指纹（entry `len:mtime_ms`）会算、有单测，**不作为重启条件**。

## 对应代码

| 用户动作 | 命令 / API | sidecar 行为 |
|---|---|---|
| 顶栏开关 | `set_external_plugin_enabled` → `sync_plugin(id)` | 只启停 `id`；已在跑且没崩的不重启 |
| 导航栏刷新 | `list_external_plugins(restartSidecars=true)` → `schedule_sync_force` | 全量：enabled 重启，disabled 停 |
| 进页 / toast 拉列表 | `list_external_plugins` 默认 → `schedule_sync` | 只补没起来的、停已禁用的、换已崩溃的；健康进程不弹 |

停进程走 `stop_sidecar`：`shutdown` 宽限后 `taskkill /T /F`，Windows 上 Job Object `KILL_ON_JOB_CLOSE` 兜底。所以**绝不能**把「开关别人」做成 force 全量。

## 不要做

- 不要在 enable/disable 里调 `sync_force` / 全表 `sync()`。那是 `96da4e1` 的回归：任意开关都会杀掉 bt-music 的 `cloudmusic.exe`。
- 不要靠指纹 mismatch 在「开关 Y」时顺带重启 X。要换 X 的代码：关开 X，或点刷新（全量）。
- 不要把刷新按钮理解成「只热更新 UI」。它会重启所有已启用 sidecar。

## 相关

- 误杀案例：[.agent/bugs/2026-08-31-sidecar重启误杀其他插件的子进程树.md](../../bugs/2026-08-31-sidecar重启误杀其他插件的子进程树.md)
- 决策：[.agent/decisions/2026-09-01-sidecar启停只跟开关和刷新按钮走-不用指纹扫全表.md](../../decisions/2026-09-01-sidecar启停只跟开关和刷新按钮走-不用指纹扫全表.md)
- 架构：[[desktop-event-os]] [plugin-native-sidecar-runtime.md](../../architecture/desktop-event-os/plugin-native-sidecar-runtime.md)
