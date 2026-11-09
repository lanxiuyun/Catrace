/**
 * React 迁移期的外部插件开关。
 * 外部 legacy Vue 组件通过 VueIsland 兼容，不要求插件先迁移到 React。
 * 此开关与 Rust `src-tauri/src/plugins.rs` 保持一致；启用仍由用户显式授权。
 * 只恢复外部插件，内置插件仍由 registerBuiltins 单独限制为 rest。
 */
export const REST_ONLY_MIGRATION = false

/** 迁移期允许出现/运行的插件 id（宿主内置）。 */
export const MIGRATION_ENABLED_PLUGIN_IDS = ['rest'] as const

export function isPluginAllowedDuringMigration(id: string): boolean {
  return (MIGRATION_ENABLED_PLUGIN_IDS as readonly string[]).includes(id)
}
