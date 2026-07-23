import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

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

/** 打开日志目录 */
export async function openLogsDir(): Promise<void> {
  return invoke('open_logs_dir')
}

/** 前端日志写入后端统一日志文件 */
export async function logFrontend(level: 'info' | 'warn' | 'error', message: string): Promise<void> {
  return invoke('log_frontend', { payload: { level, message } })
}

/** 发送一条测试 Toast 通知 */
export async function testNotification(): Promise<void> {
  return invoke('test_notification')
}

/** 开始循环测试通知，每隔 intervalSeconds 秒触发一次 */
export async function startNotificationTest(intervalSeconds: number): Promise<void> {
  return invoke('start_notification_test', { intervalSeconds })
}

/** 停止循环测试通知 */
export async function stopNotificationTest(): Promise<void> {
  return invoke('stop_notification_test')
}

/** 发送一条测试喝水提醒 */
export async function testWaterNotification(): Promise<void> {
  return invoke('test_water_notification')
}

export interface EyeSettings {
  enabled: boolean
  interval_minutes: number
}

export async function getEyeSettings(): Promise<EyeSettings> {
  return invoke('get_eye_settings')
}

export async function setEyeSettings(enabled: boolean, intervalMinutes: number): Promise<void> {
  return invoke('set_eye_settings', { enabled, intervalMinutes })
}

/** 发送一条测试护眼提醒 */
export async function testEyeNotification(): Promise<void> {
  return invoke('test_eye_notification')
}

/** 推迟护眼提醒 N 分钟 */
export async function snoozeEyeReminder(minutes: number): Promise<void> {
  return invoke('snooze_eye_reminder', { minutes })
}

/** 跳过本次护眼提醒 */
export async function skipEyeReminder(): Promise<void> {
  return invoke('skip_eye_reminder')
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

export type TimerMode = 'interval' | 'daily'

export interface TimerRule {
  id: string
  enabled: boolean
  title: string
  body: string
  mode: TimerMode
  interval_minutes: number
  daily_times: string[]
  last_fired_at?: number | null
  last_daily_keys?: string[]
}

export interface TimerSettings {
  enabled: boolean
  rules: TimerRule[]
}

export async function getTimerSettings(): Promise<TimerSettings> {
  return invoke('get_timer_settings')
}

export async function setTimerSettings(settings: TimerSettings): Promise<TimerSettings> {
  return invoke('set_timer_settings', { settings })
}

export async function testTimerNotification(ruleId?: string): Promise<void> {
  return invoke('test_timer_notification', { ruleId: ruleId ?? null })
}

export async function snoozeTimerReminder(ruleId: string, minutes: number): Promise<void> {
  return invoke('snooze_timer_reminder', { ruleId, minutes })
}

export async function ackTimerReminder(ruleId: string): Promise<void> {
  return invoke('ack_timer_reminder', { ruleId })
}

export async function skipTimerReminder(ruleId: string): Promise<void> {
  return invoke('skip_timer_reminder', { ruleId })
}

export interface AudioSessionInfo {
  pid: number
  process_name: string
  peak: number
  whitelisted: boolean
}

export interface MediaDebugInfo {
  audio_sessions: AudioSessionInfo[]
  audio_active: boolean
  audio_error: string | null

  focus_window_title: string
  focus_app_name: string
  focus_process_path: string

  media_active: boolean
  mouse_keyboard_count: number
}

/** 获取媒体检测调试信息 */
export async function getMediaDebugInfo(): Promise<MediaDebugInfo> {
  return invoke('get_media_debug_info')
}

/** 轻量活跃快照，供休息计时卡片每 2 秒轮询使用 */
export interface ActivitySnapshot {
  count: number
  media_active: boolean
  fullscreen_active: boolean
}

export async function getActivitySnapshot(): Promise<ActivitySnapshot> {
  return invoke('get_activity_snapshot')
}

/** 前端手动关闭休息计时卡片后通知后端清理状态 */
export async function dismissRestTimer(): Promise<void> {
  return invoke('dismiss_rest_timer')
}

/** 获取当前运行平台 */
export async function getPlatform(): Promise<string> {
  return invoke('get_platform')
}

/** 获取 macOS 辅助功能权限状态（非 macOS 恒为 true） */
export async function getAccessibilityPermissionStatus(): Promise<boolean> {
  return invoke('get_accessibility_permission_status')
}

/** 请求 macOS 辅助功能权限（非 macOS 恒为 true） */
export async function requestAccessibilityPermission(): Promise<boolean> {
  return invoke('request_accessibility_permission')
}

/** 获取「媒体计入活跃」开关 */
export async function getMediaActiveEnabled(): Promise<boolean> {
  return invoke('get_media_active_enabled')
}

/** 设置「媒体计入活跃」开关 */
export async function setMediaActiveEnabled(enabled: boolean): Promise<void> {
  return invoke('set_media_active_enabled', { enabled })
}

/** 获取媒体排除白名单文本（一行一个进程名） */
export async function getMediaWhitelistText(): Promise<string> {
  return invoke('get_media_whitelist_text')
}

/** 设置媒体排除白名单文本（一行一个进程名） */
export async function setMediaWhitelistText(text: string): Promise<void> {
  return invoke('set_media_whitelist_text', { text })
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

// ------------------------------------------------------------------
// 窗口管理（无焦点提醒窗口）
// ------------------------------------------------------------------

/** 显示窗口；noActivate=true 时不抢夺焦点（仅提醒窗口生效） */
export async function showWindow(label: string, noActivate: boolean, pinned: boolean): Promise<void> {
  return invoke('plugin:catrace-window|show_window', { label, noActivate, pinned })
}

/** 隐藏窗口 */
export async function hideWindow(label: string): Promise<void> {
  return invoke('plugin:catrace-window|hide_window', { label })
}

/** 动态切换窗口激活模式；active=true 恢复可聚焦 */
export async function setWindowActiveMode(label: string, active: boolean): Promise<void> {
  return invoke('plugin:catrace-window|set_window_active_mode', { label, active })
}

// ---------- Agent 通知 ----------

/** 获取 agent 通知开关 */
export async function getAgentNotificationEnabled(): Promise<boolean> {
  return invoke('get_agent_notification_enabled')
}

/** 设置 agent 通知开关 */
export async function setAgentNotificationEnabled(enabled: boolean): Promise<void> {
  return invoke('set_agent_notification_enabled', { enabled })
}

/** 获取支持的 agent 列表 */
export async function getSupportedAgents(): Promise<string[]> {
  return invoke('get_supported_agents')
}

/** 一键安装 agent hook（agent: claude / codex / gemini / kimi） */
export async function installAgentHooks(agent: string): Promise<{ installed_events?: string[]; installed_targets?: string[] }> {
  return invoke('install_agent_hooks', { agent })
}

/** 卸载 agent hook */
export async function uninstallAgentHooks(agent: string): Promise<{ removed: number }> {
  return invoke('uninstall_agent_hooks', { agent })
}

/** 检测 hook 是否已安装 */
export async function isAgentHookInstalled(agent: string): Promise<boolean> {
  return invoke('is_agent_hook_installed', { agent })
}

export type AgentEventMode = 'off' | 'auto' | 'sticky'

export interface AgentEventModeEntry {
  event: string
  mode: AgentEventMode
}

/** 获取每个 hook 事件的显示策略 */
export async function getAgentEventModes(): Promise<AgentEventModeEntry[]> {
  return invoke('get_agent_event_modes')
}

/** 设置单个事件的显示策略：off=不通知 / auto=自动消失 / sticky=常驻 */
export async function setAgentEventMode(event: string, mode: AgentEventMode): Promise<void> {
  return invoke('set_agent_event_mode', { event, mode })
}

/** 在 cwd 下新开终端，恢复 Claude Code 会话 */
export async function openAgentSession(cwd: string, sessionId: string): Promise<void> {
  return invoke('open_agent_session', { cwd, sessionId })
}

/** P6 权限审批：把用户的 Allow/Deny 决策回给后端挂起的阻塞请求。
 *  decision: 'allow' | 'deny' | 'timeout'（timeout = 回退终端审批）。
 *  返回 false 表示该请求已超时/不存在（卡片应直接消失，无需再处理）。 */
export async function resolvePermission(requestId: number, decision: string): Promise<boolean> {
  return invoke('resolve_permission', { requestId, decision })
}

export type AgentSoundMode = 'builtin' | 'custom' | 'muted'

export interface AgentSoundSettings {
  mode: AgentSoundMode
  custom_path: string
  volume: number
}

export async function getAgentSoundSettings(): Promise<AgentSoundSettings> {
  return invoke('get_agent_sound_settings')
}

export async function setAgentSoundSettings(mode: AgentSoundMode, customPath: string, volume: number): Promise<void> {
  return invoke('set_agent_sound_settings', { mode, customPath, volume })
}

/** 弹出系统文件选择器，返回单个音频文件路径；取消返回 null */
export async function pickAgentSoundFile(): Promise<string | null> {
  return open({
    multiple: false,
    directory: false,
    filters: [
      { name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] },
    ],
  })
}

/** 返回提示音 data URL；muted 或读不到时返回 null */
export async function getAgentSoundDataUrl(): Promise<string | null> {
  return invoke('get_agent_sound_data_url')
}

// ---------- Event Bus ----------

import type { BusEvent, EventPatch, EventResolution } from '../types/event'

export async function publishEvent(event: Partial<BusEvent> & Pick<BusEvent, 'event_type' | 'kind' | 'title'>): Promise<BusEvent> {
  return invoke('publish_event', { event })
}

export async function updateEvent(id: string, patch: EventPatch): Promise<BusEvent> {
  return invoke('update_event', { id, patch })
}

export async function resolveEvent(id: string, resolution: EventResolution): Promise<BusEvent> {
  return invoke('resolve_event', { id, resolution })
}

export async function resolveEventAction(
  id: string,
  actionId: string,
  payload?: unknown,
): Promise<BusEvent> {
  return invoke('resolve_event_action', { id, actionId, payload })
}

export async function getActiveEvents(): Promise<BusEvent[]> {
  return invoke('get_active_events')
}

// ---------- Event SDK HTTP ----------

export interface EventSdkStatus {
  enabled: boolean
  port: number
  token: string
  base_url: string
}

export async function getEventSdkStatus(): Promise<EventSdkStatus> {
  return invoke('get_event_sdk_status')
}

export async function setEventSdkEnabled(enabled: boolean): Promise<void> {
  return invoke('set_event_sdk_enabled', { enabled })
}

export async function rotateEventSdkToken(): Promise<string> {
  return invoke('rotate_event_sdk_token')
}

// ---------- External plugins ----------

export interface ExternalPluginInfo {
  id: string
  name: string
  version: string
  description: string
  main?: string | null
  background?: string | null
  events: string[]
  permissions: string[]
  enabled: boolean
  enabledByDefault: boolean
  dir: string
  hasUi: boolean
  hasBackground: boolean
  error?: string | null
}

export async function listExternalPlugins(): Promise<ExternalPluginInfo[]> {
  return invoke('list_external_plugins')
}

export async function setExternalPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<ExternalPluginInfo> {
  return invoke('set_external_plugin_enabled', { id, enabled })
}

export async function getPluginUiUrl(id: string): Promise<string> {
  return invoke('get_plugin_ui_url', { id })
}

/** Read plugin ui.mjs source text (host loads via Blob URL). */
export async function getPluginUiSource(id: string): Promise<string> {
  return invoke('get_plugin_ui_source', { id })
}

export async function openPluginsDir(): Promise<void> {
  return invoke('open_plugins_dir')
}

export async function getPluginsDir(): Promise<string> {
  return invoke('get_plugins_dir')
}

// ---------- Signal ----------

export interface SignalRuntimeConfig {
  key_sequence_enabled: boolean
  retention_hours: number
  snapshot: Record<string, unknown>
}

export interface SignalMinuteRecord {
  timestamp: number
  dominant_process_name: string
  foreground_sample_count: number
  foreground_counts_json: string | null
  key_count: number
  key_sequence_json: string | null
  key_sequence_enabled: boolean
  mouse_distance_px: number
  mouse_sample_count: number
  mouse_seconds_json: string | null
  collector_version: number
}

export async function setSignalKeySequenceEnabled(enabled: boolean): Promise<void> {
  return invoke('set_signal_key_sequence_enabled', { enabled })
}

export async function setSignalKeySequenceRetentionHours(hours: number): Promise<void> {
  return invoke('set_signal_key_sequence_retention_hours', { hours })
}

export async function getSignalRuntimeConfig(): Promise<SignalRuntimeConfig> {
  return invoke('get_signal_runtime_config')
}

export async function purgeKeySequences(): Promise<number> {
  return invoke('purge_key_sequences')
}

export async function getRecentSignalMinutes(limit = 30): Promise<SignalMinuteRecord[]> {
  return invoke('get_recent_signal_minutes', { limit })
}
