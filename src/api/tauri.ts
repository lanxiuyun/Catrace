import { invoke } from '@tauri-apps/api/core'

export interface AppConfig {
  window_minutes: number
  break_minutes: number
}

export interface DailyStats {
  active_minutes: number
  rest_minutes: number
}

export async function getConfig(): Promise<AppConfig> {
  return invoke('get_config')
}

export async function setConfig(config: AppConfig): Promise<void> {
  return invoke('set_config', { config })
}

export async function getTodayStats(): Promise<DailyStats> {
  return invoke('get_today_stats')
}

export async function getDayStats(offsetDays: number): Promise<DailyStats> {
  return invoke('get_day_stats', { offsetDays })
}

export async function getTodayRecords(): Promise<[number, boolean][]> {
  return invoke('get_today_records')
}

export async function getDayRecords(offsetDays: number): Promise<[number, boolean][]> {
  return invoke('get_day_records', { offsetDays })
}

export async function getAppStats(): Promise<[string, number][]> {
  return invoke('get_app_stats')
}

export async function testNotification(): Promise<void> {
  return invoke('test_notification')
}
