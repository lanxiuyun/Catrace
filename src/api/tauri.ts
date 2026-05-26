import { invoke } from '@tauri-apps/api/core'

export interface AppConfig {
  window_minutes: number
  break_minutes: number
}

export interface DailyStats {
  active_minutes: number
  rest_minutes: number
}

/** 获取工作窗口与休息判定配置 */
export async function getConfig(): Promise<AppConfig> {
  return invoke('get_config')
}

/** 保存工作窗口与休息判定配置 */
export async function setConfig(config: AppConfig): Promise<void> {
  return invoke('set_config', { config })
}

/** 跳过当前 block 的提醒，直到下一个 block 边界 */
export async function skipReminder(boundary: number): Promise<void> {
  return invoke('skip_reminder', { boundary })
}

/** 推迟提醒 N 分钟 */
export async function snoozeReminder(minutes: number): Promise<void> {
  return invoke('snooze_reminder', { minutes })
}

/** 获取静默启动开关 */
export async function getSilentStart(): Promise<boolean> {
  return invoke('get_silent_start')
}

/** 设置静默启动开关 */
export async function setSilentStart(enabled: boolean): Promise<void> {
  return invoke('set_silent_start', { enabled })
}

/** 获取今日活跃/休息分钟数 */
export async function getTodayStats(): Promise<DailyStats> {
  return invoke('get_today_stats')
}

/** 获取今日每分钟记录 */
export async function getTodayRecords(): Promise<[number, boolean][]> {
  return invoke('get_today_records')
}

/** 获取今日应用使用统计 */
export async function getAppStats(): Promise<[string, number][]> {
  return invoke('get_app_stats')
}

/** 发送一条测试 Toast 通知 */
export async function testNotification(): Promise<void> {
  return invoke('test_notification')
}
