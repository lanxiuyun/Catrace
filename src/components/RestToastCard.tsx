import { Button } from '@heroui/react'
import { X } from 'lucide-react'
import { useT } from '../app/i18n'
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
      <div className="header">
        <div className="header-left"><div className="pulse-dot" /><h2 className="title">{title}</h2></div>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.close')} onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      <div className={`progress-bar${isHovered ? ' paused' : ''}`} />
      <p className="body-text">{body}</p>
      <div className="actions">
        <Button size="sm" variant="tertiary" className="ct-toast-action" onClick={() => onSnooze?.(5)}>{t('reminder.snooze5')}</Button>
        <Button size="sm" variant="tertiary" className="ct-toast-action" onClick={() => onSnooze?.(10)}>{t('reminder.snooze10')}</Button>
        <Button size="sm" variant="primary" className="ct-toast-action" onClick={onSkip}>{t('reminder.skip')}</Button>
      </div>
    </div>
  )
}
