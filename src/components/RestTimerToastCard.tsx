import RestTimerBall from './RestTimerBall'
import { ToastCardHeader } from './ToastCardHeader'
import './RestTimerToastCard.css'

export interface RestTimerToastCardProps {
  title: string
  body: string
  restStreak?: number
  breakMinutes?: number
  onClose?: () => void
}

export default function RestTimerToastCard({ title, body, restStreak, breakMinutes, onClose }: RestTimerToastCardProps) {
  return (
    <div className="ct-rest-timer-toast-card">
      <ToastCardHeader title={title} leading={<div className="pulse-dot" />} onClose={onClose} />
      <div className="rest-timer-visual"><div className="liquid-ball"><RestTimerBall restStreak={restStreak || 0} breakMinutes={breakMinutes || 1} /></div></div>
      <p className="body-text">{body}</p>
    </div>
  )
}
