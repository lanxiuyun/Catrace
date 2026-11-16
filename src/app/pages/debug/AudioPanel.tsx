import type { MediaDebugInfo } from '../../../api/tauri'
import { useT } from '../../i18n'
import { DebugMetaItem, DebugPanel } from './DebugPanel'

/**
 * 音频会话：当前正在出声的进程 + 白名单判定。
 *
 * 这段是 Windows 专属采集（其他平台 audio_error 非空），所以「不可用」要能一眼看到，
 * 而不是只靠一句空态。表格只在该有会话的时候出现。
 */
export function AudioPanel({ data }: { data: MediaDebugInfo | null }) {
  const t = useT()
  const sessions = data?.audio_sessions ?? []

  return (
    <DebugPanel
      title={t('debug.audio.title')}
      meta={
        data ? (
          <>
            <DebugMetaItem
              label={t('debug.audio.output')}
              value={data.audio_error ? t('debug.audio.unavailable') : t('debug.audio.available')}
            />
            <DebugMetaItem
              label={t('debug.audio.playing')}
              value={
                data.audio_active ? t('debug.status.mediaPlaying') : t('debug.status.mediaIdle')
              }
            />
            <DebugMetaItem
              label={t('debug.audio.sessions')}
              value={data.audio_error ? '—' : sessions.length}
            />
          </>
        ) : undefined
      }
    >
      {!data ? (
        <p className="ct-debug-empty">—</p>
      ) : data.audio_error ? (
        <p className="ct-debug-error-text">
          {t('debug.audio.errorPrefix')}
          {data.audio_error}
        </p>
      ) : sessions.length > 0 ? (
        <div className="ct-debug-table-wrap">
          <table className="ct-debug-table">
            <thead>
              <tr>
                <th scope="col">{t('debug.audio.colProcess')}</th>
                <th scope="col" className="is-num">
                  {t('debug.audio.colPid')}
                </th>
                <th scope="col" className="is-num">
                  {t('debug.audio.colPeak')}
                </th>
                <th scope="col">{t('debug.audio.colWhitelisted')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={`${session.pid}-${session.process_name}`}>
                  <td>
                    <span className="ct-debug-ellipsis" title={session.process_name}>
                      {session.process_name}
                    </span>
                  </td>
                  <td className="is-num is-mono">{session.pid}</td>
                  <td className="is-num is-mono">{session.peak.toFixed(4)}</td>
                  <td className={session.whitelisted ? undefined : 'is-muted'}>
                    {session.whitelisted ? t('debug.audio.yes') : t('debug.audio.no')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ct-debug-empty">{t('debug.audio.empty')}</p>
      )}
    </DebugPanel>
  )
}
