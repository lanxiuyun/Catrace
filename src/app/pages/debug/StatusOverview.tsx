import type { MediaDebugInfo, SignalRuntimeConfig } from '../../../api/tauri'
import { useT } from '../../i18n'
import { DebugPanel } from './DebugPanel'
import { formatDistance, formatMinute, toNumber } from './format'

/**
 * 实时状态：把「最终判定 / 焦点窗口 / Signal 当前分钟」三张卡合成一行四格。
 *
 * 判定口径与后端一致：本分钟键鼠 ≥ 3 次或媒体在播放 → 预计活跃。
 * 状态色沿用概览页：蓝=活跃、绿=休息（不要在调试页另起一套配色）。
 */
export function StatusOverview({
  data,
  runtime,
}: {
  data: MediaDebugInfo | null
  runtime: SignalRuntimeConfig | null
}) {
  const t = useT()

  const snapshot = runtime?.snapshot ?? {}
  const minuteTs = toNumber(snapshot.minute_ts)
  const currentKeys = toNumber(snapshot.key_count)
  const currentMouse = toNumber(snapshot.mouse_distance_px)
  const minuteLabel = minuteTs > 0 ? formatMinute(minuteTs + 60) : '—'

  const active = data ? data.mouse_keyboard_count >= 3 || data.media_active : null
  const mediaLabel = data
    ? data.media_active
      ? t('debug.status.mediaPlaying')
      : t('debug.status.mediaIdle')
    : '—'

  return (
    <DebugPanel title={t('debug.status.title')}>
      <div className="ct-debug-status">
        <div className="ct-debug-stat is-emphasis">
          <span className="ct-debug-stat-label">{t('debug.status.current')}</span>
          <span className="ct-debug-stat-value">
            {active !== null && (
              <span
                className={`ct-debug-dot ${active ? 'is-active' : 'is-rest'}`}
                aria-hidden="true"
              />
            )}
            {active === null ? '—' : active ? t('debug.status.active') : t('debug.status.rest')}
          </span>
          <span className="ct-debug-stat-note">
            {data
              ? t('debug.status.activeHint', {
                  keys: data.mouse_keyboard_count,
                  media: mediaLabel,
                })
              : '—'}
          </span>
        </div>

        <div className="ct-debug-stat">
          <span className="ct-debug-stat-label">{t('debug.status.focus')}</span>
          <span
            className="ct-debug-stat-value"
            title={data?.focus_process_path || undefined}
          >
            {data?.focus_app_name || t('debug.status.focusEmpty')}
          </span>
          <span className="ct-debug-stat-note" title={data?.focus_window_title || undefined}>
            {data?.focus_window_title || '—'}
          </span>
        </div>

        <div className="ct-debug-stat">
          <span className="ct-debug-stat-label">{t('debug.status.media')}</span>
          <span className="ct-debug-stat-value">{mediaLabel}</span>
          <span className="ct-debug-stat-note">
            {data
              ? data.audio_error
                ? t('debug.audio.unavailable')
                : t('debug.audio.count', { n: data.audio_sessions.length })
              : '—'}
          </span>
        </div>

        <div className="ct-debug-stat">
          <span className="ct-debug-stat-label">{t('debug.status.minute')}</span>
          <span className="ct-debug-stat-value is-mono">{minuteLabel}</span>
          <span className="ct-debug-stat-note">
            {runtime
              ? t('debug.status.minuteHint', {
                  keys: currentKeys,
                  mouse: formatDistance(currentMouse),
                })
              : '—'}
          </span>
        </div>
      </div>
    </DebugPanel>
  )
}
