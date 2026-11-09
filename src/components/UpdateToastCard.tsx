import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getUpdateSource, setUpdateSource, type UpdateSourceId } from '../api/tauri'
import { useT } from '../app/i18n'
import './UpdateToastCard.css'

export interface UpdateToastCardProps {
  version?: string
  updateBody?: string
  showUpdateBody?: boolean
  updateInstalling?: boolean
  downloadProgress?: number
  onClose?: () => void
  onToggleDetails?: () => void
  onToggleBody?: () => void
  onResize?: () => void
  onInstall?: (source: UpdateSourceId) => void
  onSourceChange?: (source: UpdateSourceId) => void
}

const SOURCE_OPTIONS: { id: UpdateSourceId; labelKey: string }[] = [
  { id: 'auto', labelKey: 'settings.update.sourceAuto' },
  { id: 'ghfast', labelKey: 'settings.update.sourceGhfast' },
  { id: 'ghddlc', labelKey: 'settings.update.sourceGhddlc' },
  { id: 'ghproxy', labelKey: 'settings.update.sourceGhproxy' },
  { id: 'github', labelKey: 'settings.update.sourceGithub' },
]
const LOCAL_PREVIEW = import.meta.env.DEV
const NOTES_URL = LOCAL_PREVIEW ? 'http://localhost:1420/website/latest/preview.html' : 'https://lanxiuyun.github.io/Catrace/latest/'
const BROWSER_NOTES_URL = 'https://lanxiuyun.github.io/Catrace/latest/'
const NOTES_MAX_HEIGHT = 440

export default function UpdateToastCard({ version, updateBody, showUpdateBody, updateInstalling, downloadProgress, onClose, onToggleDetails, onToggleBody, onResize, onInstall, onSourceChange }: UpdateToastCardProps) {
  const t = useT()
  const [source, setSource] = useState<UpdateSourceId>('auto')
  const [notesFrameVisible, setNotesFrameVisible] = useState(LOCAL_PREVIEW)
  const [notesFrameFailed, setNotesFrameFailed] = useState(false)
  const [notesFrameHeight, setNotesFrameHeight] = useState(160)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resizeRef = useRef(onResize)
  resizeRef.current = onResize

  useEffect(() => {
    let alive = true
    void getUpdateSource().then((next) => { if (alive) setSource(next) }).catch(() => {})
    const onNotesMessage = (event: MessageEvent) => {
      const origin = LOCAL_PREVIEW ? 'http://localhost:1420' : 'https://lanxiuyun.github.io'
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return
      const payload = event.data as { type?: unknown; height?: unknown } | null
      if (!payload || payload.type !== 'catrace-release-notes-height' || typeof payload.height !== 'number' || !Number.isFinite(payload.height)) return
      setNotesFrameHeight(Math.max(120, Math.min(Math.ceil(payload.height), NOTES_MAX_HEIGHT)))
    }
    window.addEventListener('message', onNotesMessage)
    return () => {
      alive = false
      if (notesTimer.current) clearTimeout(notesTimer.current)
      window.removeEventListener('message', onNotesMessage)
    }
  }, [])

  useLayoutEffect(() => { resizeRef.current?.() }, [showUpdateBody, notesFrameHeight, notesFrameFailed, notesFrameVisible, updateInstalling])

  const showLatestNotes = () => {
    setNotesFrameVisible(true)
    setNotesFrameFailed(false)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => setNotesFrameFailed(true), 8000)
  }
  const onNotesFrameLoad = () => {
    setNotesFrameFailed(false)
    if (notesTimer.current) clearTimeout(notesTimer.current)
  }
  const changeSource = async (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.currentTarget.value as UpdateSourceId
    const previous = source
    setSource(next)
    try {
      await setUpdateSource(next)
      onSourceChange?.(next)
    } catch (error) {
      setSource(previous)
      console.error(error)
    }
  }

  return (
    <div className="ct-update-toast-card">
      <div className="header">
        <div className="header-left">
          <div className="pulse-dot" /><h2 className="title">{t('settings.update.newVersion', { version: version || '' })}</h2>
          <select className="source-select" value={source} disabled={!!updateInstalling} aria-label={t('settings.update.source')} onChange={(event) => void changeSource(event)}>{SOURCE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(option.labelKey)}</option>)}</select>
        </div>
        {!updateInstalling && <button type="button" className="close-btn" aria-label={t('common.close')} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>}
      </div>
      {showUpdateBody && <section className="release-notes" aria-label="最新版本更新说明">
        {notesFrameVisible && !notesFrameFailed && <iframe ref={frameRef} className="release-notes-frame" src={NOTES_URL} title="Catrace 最新版本更新说明" loading="eager" sandbox={LOCAL_PREVIEW ? undefined : 'allow-same-origin allow-scripts'} referrerPolicy="no-referrer" style={{ height: `${notesFrameHeight / 16}rem`, maxHeight: `${NOTES_MAX_HEIGHT / 16}rem` }} onLoad={onNotesFrameLoad} onError={() => setNotesFrameFailed(true)} />}
        {notesFrameFailed && <div className="release-notes-fallback"><p>{updateBody || '暂时无法加载官网更新说明，请检查网络后重试。'}</p></div>}
        {!LOCAL_PREVIEW && <div className="release-notes-footer">
          {(!notesFrameVisible || notesFrameFailed) && <button type="button" className="notes-link" onClick={showLatestNotes}>{notesFrameFailed ? '重试加载' : '加载官网最新说明'}</button>}
          <button type="button" className="notes-link" onClick={() => void openUrl(BROWSER_NOTES_URL).catch((error) => console.error('Failed to open release notes:', error))}>浏览器打开 ↗</button>
        </div>}
      </section>}
      {updateInstalling && <div className="update-progress"><div className="update-progress-track"><div className="update-progress-fill" style={{ width: `${downloadProgress || 0}%` }} /></div><div className="update-progress-text">{downloadProgress || 0}%</div></div>}
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onToggleDetails ?? onToggleBody}>{t(showUpdateBody ? 'settings.update.hideDetails' : 'settings.update.viewDetails')}</button>
        <button type="button" className="btn btn-primary" disabled={!!updateInstalling} onClick={() => onInstall?.(source)}>{t(updateInstalling ? 'settings.update.downloading' : 'settings.update.updateNow')}</button>
      </div>
    </div>
  )
}
