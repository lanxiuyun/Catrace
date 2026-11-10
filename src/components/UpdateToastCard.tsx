import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, ListBox, Select } from '@heroui/react'
import { X } from 'lucide-react'
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
  const changeSource = async (next: UpdateSourceId) => {
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
          <Select className="ct-toast-select" variant="secondary" value={source} isDisabled={!!updateInstalling} onChange={(value) => { if (value != null) void changeSource(String(value) as UpdateSourceId) }}>
            <Select.Trigger aria-label={t('settings.update.source')}>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {SOURCE_OPTIONS.map((option) => (
                  <ListBox.Item key={option.id} id={option.id} textValue={t(option.labelKey)}>
                    {t(option.labelKey)}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
        {!updateInstalling && <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.close')} onClick={onClose}>
          <X size={16} />
        </Button>}
      </div>
      {showUpdateBody && <section className="release-notes" aria-label="最新版本更新说明">
        {notesFrameVisible && !notesFrameFailed && <iframe ref={frameRef} className="release-notes-frame" src={NOTES_URL} title="Catrace 最新版本更新说明" loading="eager" sandbox={LOCAL_PREVIEW ? undefined : 'allow-same-origin allow-scripts'} referrerPolicy="no-referrer" style={{ height: `${notesFrameHeight / 16}rem`, maxHeight: `${NOTES_MAX_HEIGHT / 16}rem` }} onLoad={onNotesFrameLoad} onError={() => setNotesFrameFailed(true)} />}
        {notesFrameFailed && <div className="release-notes-fallback"><p>{updateBody || '暂时无法加载官网更新说明，请检查网络后重试。'}</p></div>}
        {!LOCAL_PREVIEW && <div className="release-notes-footer">
          {(!notesFrameVisible || notesFrameFailed) && <Button size="sm" variant="ghost" onClick={showLatestNotes}>{notesFrameFailed ? '重试加载' : '加载官网最新说明'}</Button>}
          <Button size="sm" variant="ghost" onClick={() => void openUrl(BROWSER_NOTES_URL).catch((error) => console.error('Failed to open release notes:', error))}>浏览器打开 ↗</Button>
        </div>}
      </section>}
      {updateInstalling && <div className="update-progress"><div className="update-progress-track"><div className="update-progress-fill" style={{ width: `${downloadProgress || 0}%` }} /></div><div className="update-progress-text">{downloadProgress || 0}%</div></div>}
      <div className="actions">
        <Button size="sm" variant="tertiary" className="ct-toast-action" onClick={onToggleDetails ?? onToggleBody}>{t(showUpdateBody ? 'settings.update.hideDetails' : 'settings.update.viewDetails')}</Button>
        <Button size="sm" variant="primary" className="ct-toast-action" isDisabled={!!updateInstalling} onClick={() => onInstall?.(source)}>{t(updateInstalling ? 'settings.update.downloading' : 'settings.update.updateNow')}</Button>
      </div>
    </div>
  )
}
