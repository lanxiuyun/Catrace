import { Button } from '@heroui/react'
import { useT } from '../app/i18n'
import { ToastCardHeader } from './ToastCardHeader'
import './RestToastCard.css'

export interface RestToastCardProps {
  title: string
  body: string
  isHovered?: boolean
  onClose?: () => void
  onSnooze?: (minutes: number) => void
  onSkip?: () => void
}

export default function RestToastCard({ title, body, isHovered, onClose, onSnooze, onSkip }: RestToastCardProps) {
  const t = useT()
  return (
    <div className="ct-rest-toast-card">
      <ToastCardHeader title={title} leading={<div className="pulse-dot" />} onClose={onClose} />
      <div className={`progress-bar${isHovered ? ' paused' : ''}`} />
      <p className="body-text">{body}</p>
      <div className="actions">
        <Button size="sm" variant="secondary" className="ct-toast-action" onClick={() => onSnooze?.(5)}>{t('reminder.snooze5')}</Button>
        <Button size="sm" variant="secondary" className="ct-toast-action" onClick={() => onSnooze?.(10)}>{t('reminder.snooze10')}</Button>
        <Button size="sm" variant="primary" className="ct-toast-action" onClick={onSkip}>{t('reminder.skip')}</Button>
      </div>
    </div>
  )
}
