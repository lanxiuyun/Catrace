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
        <button type="button" className="close-btn" aria-label={t('common.close')} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className={`progress-bar${isHovered ? ' paused' : ''}`} />
      <p className="body-text">{body}</p>
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={() => onSnooze?.(5)}>{t('reminder.snooze5')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => onSnooze?.(10)}>{t('reminder.snooze10')}</button>
        <button type="button" className="btn btn-primary" onClick={onSkip}>{t('reminder.skip')}</button>
      </div>
    </div>
  )
}
