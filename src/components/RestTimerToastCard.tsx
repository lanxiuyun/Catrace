import { Button } from '@heroui/react'
import { X } from 'lucide-react'
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
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.close')} onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      <div className="rest-timer-visual"><div className="liquid-ball"><RestTimerBall restStreak={restStreak || 0} breakMinutes={breakMinutes || 1} /></div></div>
      <p className="body-text">{body}</p>
    </div>
  )
}
