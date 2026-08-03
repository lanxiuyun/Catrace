//! 特殊纪念日 toast 彩蛋。
//!
//! 以独立 memorial toast 卡片形式出现；命中当天且在 6–20 点活跃时，
//! 全天仅弹出一次。

use chrono::{Datelike, Local, Timelike};

use crate::{db, reminder_toast, ReminderWindowStore};

/// 纪念日分类。
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub enum MemorialCategory {
    /// 肃穆历史：国家公祭、抗战纪念
    History,
    /// 现代生活/青年致敬
    Life,
}

/// 纪念日主题（视觉 + 文案）。
#[derive(Clone, serde::Serialize)]
pub struct MemorialTheme {
    pub category: MemorialCategory,
    /// 标签文字，如「历史铭记」「生活致敬」
    pub tag: &'static str,
    /// 图标 emoji
    pub icon: &'static str,
    /// 主标题
    pub title: &'static str,
    /// 导语（副文案）
    pub body: &'static str,
}

/// 纪念日日期（供前端选择器使用）。
#[derive(serde::Serialize)]
pub struct MemorialDate {
    pub month: u32,
    pub day: u32,
}

/// 返回所有已配置纪念日的列表。
pub fn memorial_dates() -> Vec<MemorialDate> {
    vec![
        MemorialDate { month: 1, day: 1 },
        MemorialDate { month: 3, day: 8 },
        MemorialDate { month: 4, day: 1 },
        MemorialDate { month: 5, day: 1 },
        MemorialDate { month: 5, day: 4 },
        MemorialDate { month: 6, day: 1 },
        MemorialDate { month: 7, day: 7 },
        MemorialDate { month: 8, day: 15 },
        MemorialDate { month: 9, day: 3 },
        MemorialDate { month: 9, day: 18 },
        MemorialDate { month: 10, day: 1 },
        MemorialDate { month: 12, day: 13 },
    ]
}

/// 若今天是已知纪念日，返回完整主题；否则 None。
pub fn today_memorial_theme(locale: &str) -> Option<MemorialTheme> {
    let now = Local::now().date_naive();
    memorial_theme_for(now.month(), now.day(), locale)
}

/// 弹出纪念日彩蛋 toast（当天仅一次，且仅在 6–20 点之间）。
pub fn show_memorial_notification(
    app_handle: &tauri::AppHandle,
    locale: &str,
    store: &ReminderWindowStore,
    db: &db::Db,
) {
    let now = Local::now();
    let hour = now.hour();
    if hour < 6 || hour > 20 {
        return;
    }
    let today = now.date_naive().to_string();
    if db.get_setting("memorial_toast_shown_date", "") == today {
        return;
    }
    let Some(theme) = today_memorial_theme(locale) else {
        return;
    };
    reminder_toast::create_memorial_toast_window(
        app_handle,
        0,
        &theme,
        "memorial",
        store,
    );
    let _ = db.set_setting("memorial_toast_shown_date", &today);
}

/// 强制预览指定月/日的纪念日彩蛋（Debug 用）。
pub fn preview_memorial_theme(month: u32, day: u32, locale: &str) -> Option<MemorialTheme> {
    memorial_theme_for(month, day, locale)
}

fn memorial_theme_for(month: u32, day: u32, locale: &str) -> Option<MemorialTheme> {
    if locale == "zh-CN" {
        zh_memorial_theme(month, day)
    } else {
        en_memorial_theme(month, day)
    }
}

fn zh_memorial_theme(month: u32, day: u32) -> Option<MemorialTheme> {
    Some(match (month, day) {
        // —— 节日 / 生活致敬 ——
        (1, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "🎊",
            title: "元旦",
            body: "新的一年，也别忘了站起来走走。",
        },
        (3, 8) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "🌸",
            title: "国际妇女节",
            body: "不被定义，自有光芒。愿你成为自己的风暴，也成为自己的港湾。",
        },
        (4, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "🃏",
            title: "愚人节",
            body: "认真工作，偶尔也开个无伤大雅的玩笑。",
        },
        (5, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "🛠️",
            title: "劳动节",
            body: "休息也是生产力的一部分，今天也请善待自己。",
        },
        (5, 4) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "⚡",
            title: "五四青年节",
            body: "青春无关年龄，在于心底的那份热忱。保持好奇，无畏前行。",
        },
        (6, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "🎈",
            title: "儿童节",
            body: "心里住着个小孩，工作也会轻松点。",
        },
        (10, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "生活致敬",
            icon: "🇨🇳",
            title: "国庆节",
            body: "山河无恙，家国安宁。愿你今天也有片刻舒展。",
        },

        // —— 历史铭记 ——
        (7, 7) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "历史铭记",
            icon: "🕯️",
            title: "七七事变",
            body: "烽火岁月不可忘，山河无恙吾辈强。铭记历史，致敬英雄。",
        },
        (8, 15) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "历史铭记",
            icon: "🕊️",
            title: "日本投降纪念日",
            body: "胜利来之不易，历史不容遗忘。正义永存，吾辈当自强。",
        },
        (9, 3) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "历史铭记",
            icon: "🎗️",
            title: "中国人民抗日战争胜利纪念日",
            body: "硝烟已散，精神永存。以和平之名，奋进新时代。",
        },
        (9, 18) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "历史铭记",
            icon: "🔔",
            title: "九一八事变",
            body: "警钟长鸣，震慑心魄；勿忘国耻，实干兴邦。",
        },
        (12, 13) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "历史铭记",
            icon: "🕯️",
            title: "南京大屠杀死难者国家公祭日",
            body: "昭昭前事，惕惕后人。以永不忘却之名，守护和平。",
        },

        _ => return None,
    })
}

fn en_memorial_theme(month: u32, day: u32) -> Option<MemorialTheme> {
    Some(match (month, day) {
        (1, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "🎊",
            title: "New Year's Day",
            body: "A new year — don't forget to stand up and stretch.",
        },
        (3, 8) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "🌸",
            title: "International Women's Day",
            body: "Undefined, unstoppable. Be your own storm and your own harbor.",
        },
        (4, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "🃏",
            title: "April Fools' Day",
            body: "Work hard, joke lightly.",
        },
        (5, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "🛠️",
            title: "Labor Day",
            body: "Rest is part of the work. Be kind to yourself today.",
        },
        (5, 4) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "⚡",
            title: "Youth Day",
            body: "Youth is a state of mind. Stay curious, keep moving.",
        },
        (6, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "🎈",
            title: "Children's Day",
            body: "Keep a little wonder at your desk.",
        },
        (10, 1) => MemorialTheme {
            category: MemorialCategory::Life,
            tag: "Life",
            icon: "🇨🇳",
            title: "National Day",
            body: "Peaceful lands, steady hearts. Take a moment to breathe.",
        },
        (7, 7) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "History",
            icon: "🕯️",
            title: "July 7 Incident",
            body: "The fires of war must not be forgotten. Honor the heroes, guard the peace.",
        },
        (8, 15) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "History",
            icon: "🕊️",
            title: "V-J Day",
            body: "Victory was hard-won; history must be remembered. Justice endures.",
        },
        (9, 3) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "History",
            icon: "🎗️",
            title: "Victory Day",
            body: "The smoke has cleared, but the spirit lives on. In the name of peace, forge ahead.",
        },
        (9, 18) => MemorialTheme {
            category: MemorialCategory::History,
            tag: "History",
            icon: "🔔",
            title: "Mukden Incident",
            body: "Let the alarm ring on. Never forget, and build a stronger tomorrow.",
        },
        (12, 13) => MemorialTheme {
            category: MemorialCategory::History,
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
        let theme = zh_memorial_theme(8, 15).unwrap();
        assert!(theme.title.contains("日本投降"));
        assert!(matches!(theme.category, MemorialCategory::History));
    }

    #[test]
    fn may_4_zh() {
        let theme = zh_memorial_theme(5, 4).unwrap();
        assert!(theme.title.contains("青年节"));
        assert!(matches!(theme.category, MemorialCategory::Life));
    }

    #[test]
    fn ordinary_day_none() {
        assert!(zh_memorial_theme(2, 14).is_none());
    }
}
