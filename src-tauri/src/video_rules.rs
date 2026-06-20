use active_win_pos_rs::get_active_window;
use regex::RegexBuilder;
use serde::Deserialize;

use crate::db::Db;

pub struct CompiledRule {
    pub regex: regex::Regex,
    pub pattern: String,
}

pub struct CompiledVideoRules {
    pub rules: Vec<CompiledRule>,
}

impl CompiledVideoRules {
    pub fn empty() -> Self {
        Self { rules: Vec::new() }
    }
}

/// 旧版规则格式（兼容本次开发周期内可能已保存的 JSON），迁移时只取 pattern。
#[derive(Deserialize)]
struct LegacyVideoActiveRule {
    pattern: String,
    enabled: bool,
}

/// 默认规则：由原先硬编码关键词转换而来，每行一个正则字符串。
pub fn default_rules() -> Vec<String> {
    [
        "youtube",
        "bilibili",
        "netflix",
        "twitch",
        "爱奇艺",
        "腾讯视频",
        "优酷",
        "芒果tv",
        "disney\\+",
        "hbo max",
        "prime video",
        "hulu",
        "crunchyroll",
        "niconico",
        "dailymotion",
        "vimeo",
        "live",
        "直播",
        "vlc",
        "mpv",
        "potplayer",
        "mpc-hc",
        "mpc-be",
        "kmplayer",
        "gom",
        "mx player",
        "infuse",
        "iina",
        "quicktime",
        "movies & tv",
        "电影和电视",
        "windows media player",
        "媒体播放器",
    ]
    .into_iter()
    .map(|s| s.to_string())
    .collect()
}

/// 从数据库加载规则；若未设置、解析失败或为空，则写入默认规则并返回。
pub fn load_rules(db: &Db) -> Vec<String> {
    let raw = db.get_setting("video_active_rules", "");
    if raw.is_empty() {
        return save_default_rules(db);
    }

    // 优先按新的字符串数组解析
    if let Ok(rules) = serde_json::from_str::<Vec<String>>(&raw) {
        return if rules.is_empty() {
            save_default_rules(db)
        } else {
            rules
        };
    }

    // 兼容旧版对象数组格式（enabled 且 pattern 非空）
    if let Ok(legacy) = serde_json::from_str::<Vec<LegacyVideoActiveRule>>(&raw) {
        let rules: Vec<String> = legacy
            .into_iter()
            .filter(|r| r.enabled && !r.pattern.trim().is_empty())
            .map(|r| r.pattern)
            .collect();
        if !rules.is_empty() {
            if let Ok(json) = serde_json::to_string(&rules) {
                let _ = db.set_setting("video_active_rules", &json);
            }
            return rules;
        }
    }

    eprintln!("[video_rules] 解析规则失败，恢复默认");
    save_default_rules(db)
}

fn save_default_rules(db: &Db) -> Vec<String> {
    let defaults = default_rules();
    if let Ok(json) = serde_json::to_string(&defaults) {
        let _ = db.set_setting("video_active_rules", &json);
    }
    defaults
}

/// 把纯文本解析为规则列表。
/// - 空行忽略
/// - 以 `#` 开头的行视为注释忽略
/// - 其余行作为正则表达式
pub fn parse_rules_text(text: &str) -> Vec<String> {
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_string())
        .collect()
}

/// 编译规则为正则集合；遇到无效正则会返回错误。
pub fn compile_rules(rules: &[String]) -> Result<CompiledVideoRules, String> {
    let mut compiled = Vec::new();
    for pattern in rules {
        if pattern.trim().is_empty() {
            continue;
        }
        let regex = RegexBuilder::new(pattern)
            .case_insensitive(true)
            .build()
            .map_err(|e| format!("[{}] 正则无效: {}", pattern, e))?;
        compiled.push(CompiledRule {
            regex,
            pattern: pattern.clone(),
        });
    }
    Ok(CompiledVideoRules { rules: compiled })
}

/// 根据规则检查当前焦点窗口是否命中视频/媒体活跃。
/// 返回 (是否命中, 命中的规则, 窗口标题, 应用名, 进程路径)。
pub fn check_media_active(
    rules: &CompiledVideoRules,
) -> (bool, Option<String>, String, String, String) {
    match get_active_window() {
        Ok(win) => {
            let title = win.title;
            let app_name = win.app_name;
            let process_path = win.process_path.to_string_lossy().to_string();
            let process_name = std::path::Path::new(&process_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let fields = [&title, &app_name, &process_name, &process_path];
            for rule in &rules.rules {
                if fields.iter().any(|field| rule.regex.is_match(field)) {
                    return (
                        true,
                        Some(rule.pattern.clone()),
                        title,
                        app_name,
                        process_path,
                    );
                }
            }
            (false, None, title, app_name, process_path)
        }
        Err(_) => (
            false,
            None,
            "Unknown".to_string(),
            "Unknown".to_string(),
            "Unknown".to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_valid_rules() {
        let rules = vec!["youtube".to_string()];
        let compiled = compile_rules(&rules).unwrap();
        assert_eq!(compiled.rules.len(), 1);
    }

    #[test]
    fn test_compile_invalid_rule_returns_error() {
        let rules = vec!["[".to_string()];
        assert!(compile_rules(&rules).is_err());
    }

    #[test]
    fn test_parse_rules_text_ignores_comments_and_empty() {
        let text = "youtube\n\n# comment\nbilibili";
        let rules = parse_rules_text(text);
        assert_eq!(rules, vec!["youtube", "bilibili"]);
    }

    #[test]
    fn test_empty_rules_compiles_to_empty() {
        let compiled = compile_rules(&[]).unwrap();
        assert!(compiled.rules.is_empty());
    }
}
