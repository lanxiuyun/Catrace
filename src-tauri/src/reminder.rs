use std::time::Instant;

/// 提醒状态机（进程级，重启后重置）
#[derive(Default)]
pub struct ReminderState {
    /// 推迟提醒直到该时刻
    pub snooze_until: Option<Instant>,
    /// 跳过本次提醒直到该 block boundary（时间戳）
    pub skip_until_boundary: Option<i64>,
    /// 活跃 block 已触发提醒，正在等待用户完成有效休息
    pub break_timer_active: bool,
}

impl ReminderState {
    pub fn is_snoozed(&self) -> bool {
        self.snooze_until.map_or(false, |t| t > Instant::now())
    }

    pub fn is_skipped(&self, boundary: i64) -> bool {
        self.skip_until_boundary.map_or(false, |b| b >= boundary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_reminder_state_snooze() {
        let mut state = ReminderState::default();

        // 初始状态：未 snooze
        assert!(!state.is_snoozed());

        // 设置 snooze_until 为未来时刻 → should be snoozed
        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        assert!(state.is_snoozed());

        // 设置 snooze_until 为过去时刻 → should not be snoozed
        state.snooze_until = Some(Instant::now() - Duration::from_secs(60));
        assert!(!state.is_snoozed());

        // 清除 snooze
        state.snooze_until = None;
        assert!(!state.is_snoozed());
    }

    #[test]
    fn test_reminder_state_skip() {
        let mut state = ReminderState::default();

        // 初始状态：未 skip
        assert!(!state.is_skipped(100));

        // 设置 skip_until_boundary = 100
        state.skip_until_boundary = Some(100);

        // boundary == 100 → skipped
        assert!(state.is_skipped(100));
        // boundary > 100 → not skipped（新 block 已开始）
        assert!(!state.is_skipped(101));
        // boundary < 100 → skipped（旧 block 仍在）
        assert!(state.is_skipped(99));
    }

    #[test]
    fn test_snooze_interval_overridden_by_user_choice() {
        // 模拟：通知触发后自动设置 3 分钟 snooze
        // 然后用户点击"5分钟"按钮覆盖
        let mut state = ReminderState::default();

        // 自动 snooze：3 分钟
        state.snooze_until = Some(Instant::now() + Duration::from_secs(3 * 60));
        assert!(state.is_snoozed());

        // 用户点击"5分钟"按钮，覆盖为 5 分钟
        state.snooze_until = Some(Instant::now() + Duration::from_secs(5 * 60));
        assert!(state.is_snoozed());

        // 验证 snooze_until 确实被更新（5分钟 > 3分钟）
        let snooze_time = state.snooze_until.unwrap();
        let expected_min = Instant::now() + Duration::from_secs(4 * 60);
        let expected_max = Instant::now() + Duration::from_secs(6 * 60);
        assert!(snooze_time > expected_min);
        assert!(snooze_time < expected_max);
    }

    #[test]
    fn test_snooze_auto_interval_expiry() {
        // 模拟：自动 snooze 间隔到期后不再 snoozed
        let mut state = ReminderState::default();

        // 设置 snooze_until 为 1 秒后
        state.snooze_until = Some(Instant::now() + Duration::from_secs(1));
        assert!(state.is_snoozed());

        // 等待 2 秒（在测试中模拟时间流逝）
        std::thread::sleep(Duration::from_secs(2));
        assert!(!state.is_snoozed());
    }
}
