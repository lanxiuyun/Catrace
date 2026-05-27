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

export interface MediaSessionInfo {
  title: string
  artist: string
  status: string
  playback_type: string
}

export interface VideoDebugInfo {
  gsmtcsm_available: boolean
  gsmtcsm_session_count: number
  gsmtcsm_sessions: MediaSessionInfo[]
  gsmtcsm_has_playing: boolean
  gsmtcsm_error: string | null

  focus_window_title: string
  focus_app_name: string
  focus_process_path: string

  keyword_matched: boolean
  matched_keyword: string | null

  media_active: boolean
  mouse_keyboard_count: number
}

/** 获取视频检测调试信息 */
export async function getVideoDebugInfo(): Promise<VideoDebugInfo> {
  return invoke('get_video_debug_info')
}

/** 获取「视频计入活跃」开关 */
export async function getVideoActiveEnabled(): Promise<boolean> {
  return invoke('get_video_active_enabled')
}

/** 设置「视频计入活跃」开关 */
export async function setVideoActiveEnabled(enabled: boolean): Promise<void> {
  return invoke('set_video_active_enabled', { enabled })
}
