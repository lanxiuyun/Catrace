use std::time::{Duration, Instant};

/// 喝水提醒状态机（进程级，重启后重置）
#[derive(Default)]
pub struct WaterReminderState {
    /// 推迟提醒直到该时刻
    pub snooze_until: Option<Instant>,
    /// 最后一次发送喝水提醒的时刻，用于防止同一分钟内重复触发
    pub last_reminder_sent: Option<Instant>,
}

impl WaterReminderState {
    pub fn is_snoozed(&self) -> bool {
        self.snooze_until.map_or(false, |t| t > Instant::now())
    }

    /// 距离上次发送是否已超过 1 秒，避免同一秒内重复弹窗
    pub fn can_send_reminder(&self) -> bool {
        self.last_reminder_sent
            .map_or(true, |t| t.elapsed() >= Duration::from_secs(1))
    }

    pub fn record_drink(&mut self) {
        // 喝水后清除 snooze，让下一次按正常间隔计算
        self.snooze_until = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_water_state_snooze() {
        let mut state = WaterReminderState::default();
        assert!(!state.is_snoozed());

        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        assert!(state.is_snoozed());

        state.snooze_until = Some(Instant::now() - Duration::from_secs(1));
        assert!(!state.is_snoozed());
    }

    #[test]
    fn test_water_state_can_send_reminder() {
        let mut state = WaterReminderState::default();
        assert!(state.can_send_reminder());

        state.last_reminder_sent = Some(Instant::now());
        assert!(!state.can_send_reminder());

        thread::sleep(Duration::from_secs(2));
        assert!(state.can_send_reminder());
    }

    #[test]
    fn test_water_state_record_drink_clears_snooze() {
        let mut state = WaterReminderState::default();
        state.snooze_until = Some(Instant::now() + Duration::from_secs(60));
        state.record_drink();
        assert!(state.snooze_until.is_none());
    }
}
