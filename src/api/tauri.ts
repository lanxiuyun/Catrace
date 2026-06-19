import { invoke } from '@tauri-apps/api/core'

export interface AppConfig {
  window_minutes: number
  break_minutes: number
  snooze_interval_minutes: number
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

/** 获取界面语言，未设置时返回 null */
export async function getLocale(): Promise<string | null> {
  return invoke('get_locale')
}

/** 设置界面语言 */
export async function setLocale(locale: string): Promise<void> {
  return invoke('set_locale', { locale })
}

/** 获取「隐藏统计面板」开关 */
export async function getHideStats(): Promise<boolean> {
  return invoke('get_hide_stats')
}

/** 设置「隐藏统计面板」开关 */
export async function setHideStats(enabled: boolean): Promise<void> {
  return invoke('set_hide_stats', { enabled })
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

/** 发送一条测试喝水提醒 */
export async function testWaterNotification(): Promise<void> {
  return invoke('test_water_notification')
}

export interface WaterSettings {
  enabled: boolean
  interval_minutes: number
}

export async function getWaterSettings(): Promise<WaterSettings> {
  return invoke('get_water_settings')
}

export async function setWaterSettings(enabled: boolean, intervalMinutes: number): Promise<void> {
  return invoke('set_water_settings', { enabled, intervalMinutes })
}

export async function recordWater(timestamp: number): Promise<void> {
  return invoke('record_water', { timestamp })
}

export async function getWaterStats(): Promise<{ count: number; last_ts: number | null }> {
  return invoke('get_water_stats')
}

export async function getWaterRecords(): Promise<{ records: number[] }> {
  return invoke('get_water_records')
}

export async function deleteLastWater(): Promise<boolean> {
  return invoke('delete_last_water')
}

export async function snoozeWaterReminder(minutes: number): Promise<void> {
  return invoke('snooze_water_reminder', { minutes })
}

export async function skipWaterReminder(): Promise<void> {
  return invoke('skip_water_reminder')
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

/** 获取 Toast 调试模式开关 */
export async function getToastDebugMode(): Promise<boolean> {
  return invoke('get_toast_debug_mode')
}

/** 设置 Toast 调试模式开关 */
export async function setToastDebugMode(enabled: boolean): Promise<void> {
  return invoke('set_toast_debug_mode', { enabled })
}

export async function getReminderMode(): Promise<string> {
  return invoke('get_reminder_mode')
}

export async function setReminderMode(mode: string): Promise<void> {
  return invoke('set_reminder_mode', { mode })
}

export async function getReminderText(): Promise<{ title: string; body: string }> {
  return invoke('get_reminder_text')
}

export async function setReminderText(title: string, body: string): Promise<void> {
  return invoke('set_reminder_text', { title, body })
}

// 元素变换类型
export interface ElementTransform {
  x: number  // 10-90 百分比
  y: number  // 10-90 百分比
  scale: number  // 0.3-3.0
  rotate: number  // -180 到 180 度
}

export interface ElementTransforms {
  title: ElementTransform
  body: ElementTransform
  countdown: ElementTransform
  actions: ElementTransform
}

// 默认元素变换
export const DEFAULT_ELEMENT_TRANSFORMS: ElementTransforms = {
  title: { x: 50, y: 20, scale: 1.0, rotate: 0 },
  body: { x: 50, y: 40, scale: 1.0, rotate: 0 },
  countdown: { x: 50, y: 60, scale: 1.0, rotate: 0 },
  actions: { x: 50, y: 80, scale: 1.0, rotate: 0 },
}

export async function getFullscreenSettings(): Promise<{ bg_image: string; opacity: number; fit_mode: string; element_transforms: string }> {
  return invoke('get_fullscreen_settings')
}

export async function setFullscreenSettings(bg_image: string, opacity: number, fit_mode: string, element_transforms: string): Promise<void> {
  return invoke('set_fullscreen_settings', { bgImage: bg_image, opacity, fitMode: fit_mode, elementTransforms: element_transforms })
}

export async function getMousePosition(): Promise<[number, number]> {
  return invoke('get_mouse_position')
}

export async function getReminderData(label: string): Promise<{
  kind?: string
  boundary: number
  title: string
  body: string
  break_minutes: number
  fullscreen_bg?: string
  fullscreen_opacity: number
  fullscreen_fit_mode?: string
  fullscreen_element_transforms?: string
} | null> {
  return invoke('get_reminder_data', { label })
}

export async function closeReminderWindow(label: string): Promise<void> {
  return invoke('close_reminder_window', { label })
}
