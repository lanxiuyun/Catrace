import type { SignalMinuteRecord, SignalRuntimeConfig } from '../../../api/tauri'
import { useT } from '../../i18n'
import { DebugMetaItem, DebugPanel } from './DebugPanel'
import { formatDistance, formatMinute, mouseSlotsFilled, toNumber } from './format'

/**
 * Signal 分钟桶：每分钟一条已落库记录（timestamp 是分钟结束时间）。
 *
 * 列顺序按「先定位、再看量」：分钟 → 主导应用 → 前台采样 / 按键 / 鼠标 → 序列标记。
 * 数字列右对齐 + tabular-nums，扫一排数字时小数点能对齐。
 */
export function SignalPanel({
  minutes,
  runtime,
}: {
  minutes: SignalMinuteRecord[]
  runtime: SignalRuntimeConfig | null
}) {
  const t = useT()
  const pending = toNumber(runtime?.snapshot.pending_buckets)

  return (
    <DebugPanel
      title={t('debug.signal.title')}
      meta={
        <>
          <DebugMetaItem
            label={t('debug.signal.keySeq')}
            value={
              runtime
                ? runtime.key_sequence_enabled
                  ? t('debug.signal.seqOn')
                  : t('debug.signal.seqOff')
                : '—'
            }
          />
          <DebugMetaItem
            label={t('debug.signal.retention')}
            value={runtime ? `${runtime.retention_hours}h` : '—'}
          />
          <DebugMetaItem label={t('debug.signal.pending')} value={runtime ? pending : '—'} />
        </>
      }
    >
      {minutes.length > 0 ? (
        <div className="ct-debug-table-wrap ct-debug-signal-scroll">
          <table className="ct-debug-table">
            <thead>
              <tr>
                <th scope="col">{t('debug.signal.colTime')}</th>
                <th scope="col">{t('debug.signal.colApp')}</th>
                <th scope="col" className="is-num">
                  {t('debug.signal.colFg')}
                </th>
                <th scope="col" className="is-num">
                  {t('debug.signal.colKeys')}
                </th>
                <th scope="col" className="is-num">
                  {t('debug.signal.colMouse')}
                </th>
                <th scope="col" className="is-num">
                  {t('debug.signal.colSlots')}
                </th>
                <th scope="col">{t('debug.signal.colSeq')}</th>
              </tr>
            </thead>
            <tbody>
              {minutes.map((row) => (
                <tr key={row.timestamp}>
                  <td className="is-mono">{formatMinute(row.timestamp)}</td>
                  <td>
                    <span
                      className="ct-debug-ellipsis"
                      title={row.dominant_process_name || undefined}
                    >
                      {row.dominant_process_name || '—'}
                    </span>
                  </td>
                  <td className="is-num">{row.foreground_sample_count}</td>
                  <td className="is-num">{row.key_count}</td>
                  <td className="is-num">{formatDistance(row.mouse_distance_px)}</td>
                  <td className="is-num">{mouseSlotsFilled(row.mouse_seconds_json)}</td>
                  <td className="is-muted">
                    {row.key_sequence_json ? t('debug.signal.seqOn') : t('debug.signal.seqOff')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ct-debug-empty">{t('debug.signal.empty')}</p>
      )}
      <p className="ct-debug-hint">{t('debug.signal.hint')}</p>
    </DebugPanel>
  )
}
