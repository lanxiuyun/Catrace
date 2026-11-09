import { useT } from '../app/i18n'
import RestTimerBall from './RestTimerBall'
import './RestTimerToastCard.css'

export interface RestTimerToastCardProps {
  title: string
  body: string
  restStreak?: number
  breakMinutes?: number
  onClose?: () => void
}

export default function RestTimerToastCard({ title, body, restStreak, breakMinutes, onClose }: RestTimerToastCardProps) {
  const t = useT()
  return (
    <div className="ct-rest-timer-toast-card">
      <div className="header">
        <div className="header-left"><div className="pulse-dot" /><h2 className="title">{title}</h2></div>
        <button type="button" className="close-btn" aria-label={t('common.close')} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="rest-timer-visual"><div className="liquid-ball"><RestTimerBall restStreak={restStreak || 0} breakMinutes={breakMinutes || 1} /></div></div>
      <p className="body-text">{body}</p>
    </div>
  )
}
