# 护眼提醒

按间隔提醒用户看向远处休息眼睛，提醒卡片以 25 秒倒计时自动关闭，无需用户手动处理。

## 涉及文件

- `src-tauri/src/eye.rs` — 状态机 `EyeReminderState`、设置读写、命令、每分钟结算检查
- `src-tauri/src/lib.rs` — 每分钟活跃结算时调用 `eye::check_and_notify()`；注册 `snooze_eye_reminder` / `skip_eye_reminder` 命令
- `src/components/EyeToastCard.vue` — 护眼提醒专用 Toast 卡片（标题 + 倒计时 + 进度条 + 绿色正文 + 稍后/跳过按钮）
- `src/components/settings/EyeSettingsCard.vue` — 设置页护眼提醒卡片
- `src/views/ReminderToast.vue` — 通用 Toast 堆叠容器，调度 `EyeToastCard`；通用 body 渲染已排除 `eye`（正文由卡片自渲染）
- `src/api/tauri.ts` — 前端 API 封装
- `src/i18n/locales/zh-CN.ts` / `en-US.ts` — 中英文字符串（按钮文案复用 `reminder.snooze5` / `reminder.skip`）

## 触发逻辑

一句话：**每连续用电脑满 N 分钟（默认 20）就弹一次护眼提醒；中途真正休息过，就从休息结束重新计时。**

判断「这一分钟该不该弹」分四步：

1. **只在活跃时检查。** 这一分钟用户敲了键盘或动了鼠标，才往下走；用户在休息，什么都不做。
2. **定一个计时起点。** 取下面两个时间里更晚的那个：
   - 上次弹护眼提醒的时间
   - 上次真正休息结束的时间（连续不活动 ≥ `break_minutes` 分钟，才算一次「真正休息」）
   - 谁更近就从谁开始数。两个都还没有（刚启动）→ 以现在为起点、本轮不弹，等满一个间隔再说。
3. **到期就弹。** 「现在 − 起点」≥ 提醒间隔 → 弹右下角 Toast，并把「上次提醒时间」更新成现在。
4. **同一秒只弹一次**，防止重复。

例子（间隔 20 分钟、`break_minutes` 5 分钟）：

- 连续敲 20 分钟代码 → 弹。
- 弹完接着敲 20 分钟 → 再弹。
- 中间离开 10 分钟喝水（≥ 5 分钟，算真正休息）→ 回来后从「坐下那一刻」重新数 20 分钟。
- 离开 3 分钟接个电话（< 5 分钟，不算休息）→ 不影响计时，回来接着之前的进度数。

> **为什么休息后是「查上次休息结束时间」，而不是在休息时直接把计时清零？**
> 清零得由外层结算循环改写护眼模块内部的「上次提醒时间」，会把内部 key 和「休息后重置」这条规则泄漏出去，模块不再自包含。查一次今日记录（最多 1440 行，命中连续休息就停）就能把判断留在 eye 模块内部，概念上等价于「休息完重新计时」。

## UI

- 设置卡片使用绿色主题，与喝水提醒蓝色主题区分
- Toast 卡片：脉冲点 + 标题、25 秒倒计时、绿色进度条、绿色正文、关闭按钮
- 卡片底部两个按钮：「稍后5分钟」（`snooze_eye_reminder`）、「跳过本次」（`skip_eye_reminder`，等同推迟一个 `eye_interval`）
- 倒计时位于进度条右侧，每秒刷新
- Hover 不暂停倒计时，到时间自动关闭
- 中文界面显示「护眼提醒」，英文为 "Eye Care Reminder"

## 状态机

`EyeReminderState`（进程级，重启后重置）：
- `last_reminder_sent` — 1 秒去重，防同一秒重复弹
- `snooze_until` — 用户点「稍后」或「跳过」后写入；结算检查时若处于 snooze 期内则不弹。`snooze_until` 一过期自动失效，无需主动清除

## 配置

| 配置名 | 说明 | 默认值 |
|--------|------|--------|
| `eye_reminder_enabled` | 开启护眼提醒 | true |
| `eye_interval_minutes` | 连续活跃多久提醒护眼（分钟） | 20 |

## 测试

`eye.rs` 包含 2 个测试：`can_send_reminder` 1 秒去重、`is_snoozed` 推迟逻辑。

## 相关

- [[water-reminder]] — 同类提醒系统的实现参考
- [[toast-window]] — Toast 通知承载窗口
- [[database]] — `get_last_real_rest_ts` 真正休息查询
