/**
 * 窗口类型判定与启动前的 URL 归一化（原 src/main.ts 顶部逻辑的平移）。
 * 必须在创建 react-router 之前调用 normalizeReminderHash()。
 */
export type AppWindowMode =
  | 'main'
  | 'toast'
  | 'reminder-popup'
  | 'reminder-fullscreen'
  | 'plugin-host'

export function detectWindowMode(): AppWindowMode {
  const hash = window.location.hash
  if (hash.includes('plugin-host')) return 'plugin-host'
  if (hash.includes('reminder-popup')) return 'reminder-popup'
  if (hash.includes('reminder-fullscreen')) return 'reminder-fullscreen'
  if (hash.includes('reminder-toast')) return 'toast'
  return 'main'
}

/** 兼容旧的 `?reminder=popup|fullscreen` 建窗方式：把 hash 归一成路由路径。 */
export function normalizeReminderHash(): void {
  const url = new URL(window.location.href)
  const reminder = url.searchParams.get('reminder')
  if (reminder === 'popup' || reminder === 'fullscreen') {
    window.location.hash = reminder === 'popup' ? '#/reminder-popup' : '#/reminder-fullscreen'
  }
}
