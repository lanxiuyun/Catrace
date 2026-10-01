use crate::log_debug;

/// 在异步运行时中上报应用启动事件。
/// 上报服务暂缺，接口保留为空实现，后续接入新服务后填充。
pub fn spawn_report_app_start(_app_handle: tauri::AppHandle, _db: crate::db::Db) {
    // 两条都是「本次启动不上报」的常态解释，逐次 info 是纯噪音（dev 下随热重载还会多刷），降 debug
    if cfg!(debug_assertions) {
        log_debug!("report", "dev mode, skip app_start report");
        return;
    }
    log_debug!("report", "report service not configured, skip app_start report");
}
