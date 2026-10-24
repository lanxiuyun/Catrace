/**
 * React 迁移期的插件收口开关。
 *
 * 迁移策略见 .agent/architecture/react-migration/README.md：
 * 逐个把插件改写成 React，期间宿主只保留内置「久坐提醒」（rest），
 * 其余插件（外部插件、演示插件、sidecar、后台 WebView）全部停用。
 *
 * 恢复某个插件时，把它同时从本文件与 Rust `src-tauri/src/plugins.rs`
 * 的 `REST_ONLY_MIGRATION` 放出来；整轮迁移结束后删除这两处开关。
 */
export const REST_ONLY_MIGRATION = true

/** 迁移期允许出现/运行的插件 id（宿主内置）。 */
export const MIGRATION_ENABLED_PLUGIN_IDS = ['rest'] as const

export function isPluginAllowedDuringMigration(id: string): boolean {
  return (MIGRATION_ENABLED_PLUGIN_IDS as readonly string[]).includes(id)
}
