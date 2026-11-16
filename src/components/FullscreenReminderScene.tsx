import type { ReactNode } from 'react'
import { Button } from '@heroui/react'
import type { ElementTransforms } from '../api/tauri'
import { useT } from '../app/i18n'
import {
  fullscreenElementStyle, formatFullscreenTime, type FullscreenElementName,
} from './fullscreenReminderModel'
import '../app/windows/reminder-fullscreen.css'

export interface FullscreenReminderSceneProps {
  title: string
  body: string
  bgImage: string
  opacity: number
  fitMode: string
  remainingSeconds: number
  elementTransforms: ElementTransforms
  renderElement?: (name: FullscreenElementName, content: ReactNode) => ReactNode
  onSnooze?: (minutes: number) => void
  onSkip?: () => void
}

/** Presentation only: no timers, native window calls, or persistence. */
export function FullscreenReminderScene({
  title, body, bgImage, opacity, fitMode, remainingSeconds, elementTransforms,
  renderElement, onSnooze, onSkip,
}: FullscreenReminderSceneProps) {
  const t = useT()
  const element = (name: FullscreenElementName, content: ReactNode) => renderElement
    ? renderElement(name, content)
    : <div className="reminder-fullscreen-editable-element" style={fullscreenElementStyle(elementTransforms[name])}>{content}</div>

  return (
    <div className="reminder-fullscreen-scene">
      {bgImage && <>
        <div className="reminder-fullscreen-bg" style={{ backgroundImage: `url(${bgImage})`, opacity: opacity / 100 }} />
        <div className="reminder-fullscreen-sharp" style={{ backgroundImage: `url(${bgImage})`, backgroundSize: fitMode === 'fill' ? '100% 100%' : fitMode, opacity: opacity / 100 }} />
      </>}
      {element('title', <h1 className="reminder-fullscreen-title">{title}</h1>)}
      {element('body', <p className="reminder-fullscreen-subtitle">{body}</p>)}
      {element('countdown', <div className="reminder-fullscreen-countdown">
        <div className="reminder-fullscreen-countdown-label">{t('reminder.countdown')}</div>
        <div className="reminder-fullscreen-countdown-time">{formatFullscreenTime(remainingSeconds)}</div>
      </div>)}
      {element('actions', <div className="reminder-fullscreen-actions">
        <Button type="button" variant="tertiary" size="lg" onClick={(event) => { event.stopPropagation(); onSnooze?.(5) }}>{t('reminder.snooze5')}</Button>
        <Button type="button" variant="tertiary" size="lg" onClick={(event) => { event.stopPropagation(); onSnooze?.(10) }}>{t('reminder.snooze10')}</Button>
        <Button type="button" variant="primary" size="lg" onClick={(event) => { event.stopPropagation(); onSkip?.() }}>{t('reminder.skip')}</Button>
      </div>)}
    </div>
  )
}
