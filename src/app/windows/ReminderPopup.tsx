import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import { Button, Input } from '@heroui/react'
import { X } from 'lucide-react'
import {
  getReminderData, snoozeReminder, skipReminder, setWindowActiveMode, closeReminderWindow,
} from '../../api/tauri'
import { useT } from '../i18n'
import { useShellStore } from '../store'
import './reminder-popup.css'

const POPUP_WIDTH = 440
const POPUP_MIN_HEIGHT = 300
const WINDOW_LABEL = 'reminder-popup'

export default function ReminderPopup() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [customMinutes, setCustomMinutes] = useState('15')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const boundary = useRef(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const customVisible = useRef(false)
  const mounted = useRef(false)
  const resizing = useRef(false)
  const resizeRequested = useRef(false)

  const adjustWindowSize = useCallback(async () => {
    if (!mounted.current || !cardRef.current) return
    if (resizing.current) { resizeRequested.current = true; return }
    resizing.current = true
    try {
      do {
        resizeRequested.current = false
        const win = getCurrentWebviewWindow()
        const pos = await win.outerPosition()
        const size = await win.outerSize()
        const scale = await win.scaleFactor()
        if (!mounted.current || !cardRef.current) return
        const newHeight = Math.min(600, Math.max(POPUP_MIN_HEIGHT, Math.round(cardRef.current.getBoundingClientRect().height)))
        if (Math.round(size.width / scale) === POPUP_WIDTH && Math.round(size.height / scale) === newHeight) continue
        // Resize in logical pixels around the existing window center, including mixed DPI.
        const centerX = pos.x / scale + size.width / scale / 2
        const centerY = pos.y / scale + size.height / scale / 2
        await win.setSize(new LogicalSize(POPUP_WIDTH, newHeight))
        await win.setPosition(new LogicalPosition(centerX - POPUP_WIDTH / 2, centerY - newHeight / 2))
      } while (mounted.current && resizeRequested.current)
    } catch (error) { console.error(error) }
    finally { resizing.current = false }
  }, [])

  useEffect(() => {
    mounted.current = true
    const observer = new ResizeObserver(() => { void adjustWindowSize() })
    if (cardRef.current) observer.observe(cardRef.current)
    void getReminderData(WINDOW_LABEL).then((data) => {
      if (!mounted.current || !data) return
      setTitle(data.title)
      setBody(data.body)
      boundary.current = data.boundary
    }).catch((error) => console.error(error))
    return () => {
      mounted.current = false
      observer.disconnect()
    }
  }, [adjustWindowSize])

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void adjustWindowSize() })
    return () => cancelAnimationFrame(frame)
  }, [title, body, showCustomInput, adjustWindowSize])

  const handleSnooze = async (minutes: number) => {
    try { await snoozeReminder(minutes) }
    catch (error) { console.error(error) }
    await getCurrentWebviewWindow().close()
  }
  const handleCustomSnooze = () => handleSnooze(Math.max(1, Math.round(Number(customMinutes))))
  const toggleCustomInput = async () => {
    const show = !customVisible.current
    customVisible.current = show
    setShowCustomInput(show)
    try {
      await setWindowActiveMode(WINDOW_LABEL, show)
      // Focus only after restoring native activation; the first input must reach the WebView.
      if (mounted.current && customVisible.current && show) inputRef.current?.focus()
    } catch (error) { console.error(error) }
  }
  const handleSkip = async () => {
    try { await skipReminder(boundary.current) }
    catch (error) { console.error(error) }
    await getCurrentWebviewWindow().close()
  }

  return <div className="reminder-popup-root">
    <div ref={cardRef} className="reminder-popup-card">
      <div className="reminder-popup-header">
        <div className="reminder-popup-header-left">
          <div className="reminder-popup-pulse-dot" />
          <h2 className="reminder-popup-title">{title}</h2>
        </div>
        <Button type="button" isIconOnly variant="ghost" size="md" onClick={() => { void closeReminderWindow(WINDOW_LABEL) }} aria-label={locale === 'zh-CN' ? '关闭' : 'Close'}>
          <X size={16} />
        </Button>
      </div>
      <p className="reminder-popup-body-text">{body}</p>
      <div className="reminder-popup-snooze-grid">
        {[5, 10, 15, 30].map((minutes) => <Button type="button" key={minutes} variant="tertiary" size="md" onClick={() => { void handleSnooze(minutes) }}>{minutes} {t('common.minutes')}</Button>)}
        <Button type="button" variant={showCustomInput ? 'primary' : 'tertiary'} size="md" onClick={() => { void toggleCustomInput() }}>{locale === 'zh-CN' ? '自定义' : 'Custom'}</Button>
      </div>
      {showCustomInput && <div className="reminder-popup-custom-row">
        <Input
          ref={inputRef}
          variant="secondary"
          type="number"
          min="1"
          max="120"
          placeholder={t('common.minutes')}
          value={customMinutes}
          onChange={(event) => setCustomMinutes(event.target.value)}
          onKeyUp={(event) => { if (event.key === 'Enter') void handleCustomSnooze() }}
          style={{ flex: 1 }}
        />
        <Button type="button" variant="primary" size="md" onClick={() => { void handleCustomSnooze() }}>{locale === 'zh-CN' ? '确定' : 'Confirm'}</Button>
      </div>}
      <Button type="button" variant="tertiary" size="md" style={{ width: '100%', marginTop: 'auto' }} onClick={() => { void handleSkip() }}>{t('reminder.skip')}</Button>
    </div>
  </div>
}
