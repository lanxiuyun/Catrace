use crate::log_info;

/// 在异步运行时中上报应用启动事件。
/// 上报服务暂缺，接口保留为空实现，后续接入新服务后填充。
pub fn spawn_report_app_start(_app_handle: tauri::AppHandle, _db: crate::db::Db) {
    if cfg!(debug_assertions) {
        log_info!("report", "dev mode, skip app_start report");
        return;
    }
    log_info!("report", "report service not configured, skip app_start report");
}
