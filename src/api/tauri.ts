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

export async function getSilentStart(): Promise<boolean> {
  return invoke('get_silent_start')
}

export async function setSilentStart(enabled: boolean): Promise<void> {
  return invoke('set_silent_start', { enabled })
}

export async function getTodayStats(): Promise<DailyStats> {
  return invoke('get_today_stats')
}

export async function getTodayRecords(): Promise<[number, boolean][]> {
  return invoke('get_today_records')
}

export async function getAppStats(): Promise<[string, number][]> {
  return invoke('get_app_stats')
}

export async function testNotification(): Promise<void> {
  return invoke('test_notification')
}
