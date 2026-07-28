# 护眼提醒

护眼不再是内置模块，而是 **定时提醒插件（`timer`）** 的一条规则预设。  
产品路径：插件中心 → 定时提醒 → 预设「护眼」，或自建间隔规则并打开「休息重置」。

## 一句话

连续活跃满 N 分钟（默认 20）弹一次护眼 Toast；若本轮间隔内发生过「真正休息」，则从休息结束重新计时。卡片默认停留 25 秒，也可改成常驻。

## 涉及文件

| 路径 | 角色 |
|------|------|
| `tools/plugin-demo/timer/manifest.json` | 外部插件 id=`timer` |
| `tools/plugin-demo/timer/background.mjs` | 分钟对齐调度；`reset_on_rest` + `plugin_get_last_real_rest` |
| `tools/plugin-demo/timer/settings.mjs` | 规则 CRUD；护眼预设；卡片停留/常驻 |
| `tools/plugin-demo/timer/ui.mjs` | Toast 卡 |
| `src-tauri/src/plugin_commands.rs` | `plugin_get_last_real_rest`（阈值读久坐 `break_minutes`） |
| `src-tauri/src/db.rs` | `get_last_real_rest_ts` |
| `src/views/toastWindows/ReminderToast.vue` | 读 `payload.auto_hide_ms` / `event.sticky` 控制停留 |

Debug 构建会把 `tools/plugin-demo/timer` junction 到 `app_data/plugins/timer`。详见 [[m10-external-plugins]] 与 `tools/plugin-demo/README.md`。

## 规则配置（护眼预设）

| 字段 | 值 | 说明 |
|------|----|------|
| `mode` | `interval` | 仅当前分钟**活跃**时检查 |
| `interval_minutes` | `20` | 间隔 |
| `reset_on_rest` | `true` | UI 文案「休息重置」 |
| `sticky` | `false` | 不常驻 |
| `card_duration_sec` | `25` | Toast 自动关闭秒数 |

用户可改间隔、停留秒数，或开 `sticky` 常驻。无需再配独立的休息阈值。

## 触发逻辑（`reset_on_rest`）

每分钟 tick（对齐整分）：

1. 插件总开关 + 规则启用；未 snooze；活跃（`plugin_get_activity`）
2. 无 `last_fired_at` → 只锚点不弹（防启用瞬间连弹）
3. 开了休息重置时：调 `plugin_get_last_real_rest`
   - 若 `lastRest > last_fired_at` → **真休息落在本轮间隔内** → 把 `last_fired_at` 写成 `lastRest` 并落盘 runtime
4. `now - last_fired_at ≥ interval` → `plugin_publish_event`（`kind=timer`，`dedupe_key=reminder.timer.due:<ruleId>`）

「真正休息」判定在宿主：连续空闲 ≥ 久坐插件 `break_minutes`（默认 5），见 `db.get_last_real_rest_ts`。

例子（间隔 20 分、久坐 break=5）：

- 连续敲 20 分 → 弹
- 弹完再敲 20 分 → 再弹
- 中间离开 10 分（≥5 算真休息）→ 回来从休息结束重新数 20 分
- 离开 3 分（<5）→ 不重置，接着原进度

## Toast

- 宿主按 `sticky` / `payload.auto_hide_ms`（= `card_duration_sec * 1000`）计时
- 进度条 CSS 变量 `--toast-auto-hide-ms` 跟 `totalMs` 对齐
- 动作：`ack` / `snooze_5` / `skip`（背景脚本经 `catrace:plugin-event-resolved` 处理）

## 存储

| 层 | 位置 |
|----|------|
| 可移植配置 | Store `plugin_config:timer`（规则列表；runtime 字段剥离） |
| 运行态 | SQLite `plugin_storage(timer, runtime)` → 每规则 `last_fired_at` / `last_daily_keys` |
| 进程态 | background 内 snooze / 1s 去重 Map |

## 与旧内置的关系

旧 `eye.rs` / `EyeToastCard` / `EyeSettingsCard` / 设置页护眼卡已移除。  
历史过程见 devlog：`2026-07-10-eye-reminder*.md`、`2026-07-11-eye-toast-snooze-skip-buttons.md`。

## 相关

- [[toast-window]] — Toast 窗口与 auto-hide
- [[reminder]] — 久坐插件；提供 `break_minutes` 给真休息判定
- [[water-reminder]] — 同类「间隔提醒」产品叙事（实现路径可能仍独立或收敛到 timer）
- [[m10-external-plugins]] — 外部插件加载与 Card 合同
- `tools/plugin-demo/README.md` — timer 插件总说明
