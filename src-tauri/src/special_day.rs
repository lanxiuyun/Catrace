//! 特殊日 toast 彩蛋（宿主内置）。
//!
//! 命中当天且在 6–20 点活跃 settle 时，经 Event Bus 弹出一次；全天仅一次。

use std::sync::atomic::{AtomicI64, Ordering};

use chrono::{Datelike, Local, Timelike};

use crate::db;
use crate::event::{BusEvent, DisplayMode, EventLevel, EventSource, EventStatus};
use crate::log_error;

/// 特殊日分类。
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub enum SpecialDayCategory {
    /// 肃穆历史：国家公祭、抗战纪念
    History,
    /// 现代生活/青年致敬
    Life,
}

/// 特殊日主题（视觉 + 文案）。
#[derive(Clone, serde::Serialize)]
pub struct SpecialDayTheme {
    pub category: SpecialDayCategory,
    /// 标签文字，如「历史铭记」「生活节日」
    pub tag: &'static str,
    /// 图标 emoji
    pub icon: &'static str,
    /// 主标题
    pub title: &'static str,
    /// 导语（副文案）
    pub body: &'static str,
}

/// 若今天是已知特殊日，返回完整主题；否则 None。
pub fn today_special_day_theme(locale: &str) -> Option<SpecialDayTheme> {
    let now = Local::now().date_naive();
    special_day_theme_for(now.month(), now.day(), locale)
}

/// 检查节流：每 3 小时才真正跑一次日期判断，避免 settle 每分钟空转。
const CHECK_INTERVAL_SECS: i64 = 3 * 60 * 60;

/// 上次实际检查的 unix 秒（0 = 从未检查）。
static LAST_CHECK_TS: AtomicI64 = AtomicI64::new(0);

/// 弹出特殊日彩蛋 toast（当天仅一次，且仅在 6–20 点之间）。
/// 节流为每 3 小时检查一次；走 Event Bus；bus 失败不挡主 settle 路径。
pub fn show_special_day_notification(app_handle: &tauri::AppHandle, locale: &str, db: &db::Db) {
    let now_ts = Local::now().timestamp();
    let last = LAST_CHECK_TS.load(Ordering::Relaxed);
    if last != 0 && now_ts - last < CHECK_INTERVAL_SECS {
        return;
    }
    let _ = LAST_CHECK_TS.compare_exchange(
        last,
        now_ts,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );

    let now = Local::now();
    let hour = now.hour();
    if hour < 6 || hour > 20 {
        return;
    }
    let today = now.date_naive().to_string();
    if db.get_setting("special_day_toast_shown_date", "") == today {
        return;
    }
    let Some(theme) = today_special_day_theme(locale) else {
        return;
    };
    if publish_special_day_toast(app_handle, &theme) {
        let _ = db.set_setting("special_day_toast_shown_date", &today);
    }
}

/// 经 Event Bus 下发 kind=special 的 sticky toast。
pub fn publish_special_day_toast(app_handle: &tauri::AppHandle, theme: &SpecialDayTheme) -> bool {
    use tauri::Manager;

    let category_str = match theme.category {
        SpecialDayCategory::History => "history",
        SpecialDayCategory::Life => "life",
    };
    let bus_event = BusEvent {
        id: String::new(),
        event_type: "system.special_day".into(),
        source: EventSource::Internal,
        kind: "special".into(),
        display_mode: DisplayMode::Toast,
        level: EventLevel::Info,
        title: theme.title.to_string(),
        body: theme.body.to_string(),
        actions: vec![],
        progress: None,
        sticky: Some(true),
        payload: serde_json::json!({
            "tag": theme.tag,
            "icon": theme.icon,
            "category": category_str,
        }),
        created_at: 0,
        updated_at: 0,
        status: EventStatus::Active,
        revision: 0,
        resolved_at: None,
        resolution: None,
        expires_at: None,
        correlation_id: None,
        dedupe_key: Some(format!(
            "system.special_day:{}-{}",
            Local::now().date_naive(),
            theme.title
        )),
    };

    if let Some(bus) = app_handle.try_state::<crate::bus::EventBus>() {
        match bus.inner().publish(bus_event) {
            Ok(_) => true,
            Err(e) => {
                log_error!("special-day", "bus.publish failed: {}", e);
                false
            }
        }
    } else {
        log_error!("special-day", "EventBus state missing");
        false
    }
}

fn special_day_theme_for(month: u32, day: u32, locale: &str) -> Option<SpecialDayTheme> {
    if locale == "zh-CN" {
        zh_special_day_theme(month, day)
    } else {
        en_special_day_theme(month, day)
    }
}

fn zh_special_day_theme(month: u32, day: u32) -> Option<SpecialDayTheme> {
    Some(match (month, day) {
        // —— 节日 / 生活节日 ——
        (1, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "🎊",
            title: "元旦",
            body: "新的一年，也别忘了站起来走走。",
        },
        (3, 8) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "🌸",
            title: "国际妇女节",
            body: "不被定义，自有光芒。愿你成为自己的风暴，也成为自己的港湾。",
        },
        (4, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "🃏",
            title: "愚人节",
            body: "认真工作，偶尔也开个无伤大雅的玩笑。",
        },
        (5, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "🛠️",
            title: "劳动节",
            body: "休息也是生产力的一部分，今天也请善待自己。",
        },
        (5, 4) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "⚡",
            title: "五四青年节",
            body: "青春无关年龄，在于心底的那份热忱。保持好奇，无畏前行。",
        },
        (6, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "🎈",
            title: "儿童节",
            body: "心里住着个小孩，工作也会轻松点。",
        },
        (10, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "生活节日",
            icon: "flag-cn",
            title: "国庆节",
            body: "山河无恙，家国安宁。愿你今天也有片刻舒展。",
        },

        // —— 历史铭记 ——
        (7, 7) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "历史铭记",
            icon: "🕯️",
            title: "七七事变",
            body: "烽火岁月不可忘，山河无恙吾辈强。铭记历史，致敬英雄。",
        },
        (8, 15) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "历史铭记",
            icon: "🕊️",
            title: "日本投降纪念日",
            body: "胜利来之不易，历史不容遗忘。正义永存，吾辈当自强。",
        },
        (9, 3) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "历史铭记",
            icon: "🎗️",
            title: "中国人民抗日战争胜利纪念日",
            body: "硝烟已散，精神永存。以和平之名，奋进新时代。",
        },
        (9, 18) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "历史铭记",
            icon: "🔔",
            title: "九一八事变",
            body: "警钟长鸣，震慑心魄；勿忘国耻，实干兴邦。",
        },
        (12, 13) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "历史铭记",
            icon: "🕯️",
            title: "南京大屠杀死难者国家公祭日",
            body: "昭昭前事，惕惕后人。以永不忘却之名，守护和平。",
        },

        _ => return None,
    })
}

fn en_special_day_theme(month: u32, day: u32) -> Option<SpecialDayTheme> {
    Some(match (month, day) {
        (1, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "🎊",
            title: "New Year's Day",
            body: "A new year — don't forget to stand up and stretch.",
        },
        (3, 8) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "🌸",
            title: "International Women's Day",
            body: "Undefined, unstoppable. Be your own storm and your own harbor.",
        },
        (4, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "🃏",
            title: "April Fools' Day",
            body: "Work hard, joke lightly.",
        },
        (5, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "🛠️",
            title: "Labor Day",
            body: "Rest is part of the work. Be kind to yourself today.",
        },
        (5, 4) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "⚡",
            title: "Youth Day",
            body: "Youth is a state of mind. Stay curious, keep moving.",
        },
        (6, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "🎈",
            title: "Children's Day",
            body: "Keep a little wonder at your desk.",
        },
        (10, 1) => SpecialDayTheme {
            category: SpecialDayCategory::Life,
            tag: "Life",
            icon: "flag-cn",
            title: "National Day",
            body: "Peaceful lands, steady hearts. Take a moment to breathe.",
        },
        (7, 7) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "History",
            icon: "🕯️",
            title: "July 7 Incident",
            body: "The fires of war must not be forgotten. Honor the heroes, guard the peace.",
        },
        (8, 15) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "History",
            icon: "🕊️",
            title: "V-J Day",
            body: "Victory was hard-won; history must be remembered. Justice endures.",
        },
        (9, 3) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "History",
            icon: "🎗️",
            title: "Victory Day",
            body: "The smoke has cleared, but the spirit lives on. In the name of peace, forge ahead.",
        },
        (9, 18) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "History",
            icon: "🔔",
            title: "Mukden Incident",
            body: "Let the alarm ring on. Never forget, and build a stronger tomorrow.",
        },
        (12, 13) => SpecialDayTheme {
            category: SpecialDayCategory::History,
            tag: "History",
            icon: "🕯️",
            title: "National Memorial Day",
            body: "Remember the past, hold fast to peace. We shall never forget.",
        },
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aug_15_zh() {
        let theme = zh_special_day_theme(8, 15).unwrap();
        assert!(theme.title.contains("日本投降"));
        assert!(matches!(theme.category, SpecialDayCategory::History));
    }

    #[test]
    fn may_4_zh() {
        let theme = zh_special_day_theme(5, 4).unwrap();
        assert!(theme.title.contains("青年节"));
        assert!(matches!(theme.category, SpecialDayCategory::Life));
    }

    #[test]
    fn ordinary_day_none() {
        assert!(zh_special_day_theme(2, 14).is_none());
    }
}
