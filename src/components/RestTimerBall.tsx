import { useId } from 'react'
import { useT } from '../app/i18n'
import './RestTimerBall.css'

export interface RestTimerBallProps {
  restStreak: number
  breakMinutes: number
}

const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const TICK_RADIUS = 53
const TICK_CIRCUMFERENCE = 2 * Math.PI * TICK_RADIUS

export default function RestTimerBall({ restStreak, breakMinutes }: RestTimerBallProps) {
  const t = useT()
  const instanceId = useId().replace(/:/g, '')
  const gradientId = `rest-progress-gradient-${instanceId}`
  const glowId = `rest-progress-glow-${instanceId}`
  const target = Math.max(1, breakMinutes || 1)
  const progress = Math.min(1, Math.max(0, (restStreak || 0) / target))
  const isComplete = progress >= 1
  const segment = TICK_CIRCUMFERENCE / Math.min(12, target)
  return (
    <div className={`ct-rest-timer-ball${isComplete ? ' rest-timer--complete' : ''}`} role="img" aria-label={t('reminder.restTimerTitle')}>
      <svg className="rest-timer__svg" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="var(--ct-cyan)" /><stop offset="100%" stopColor="var(--ct-success)" /></linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter>
        </defs>
        <circle className="rest-timer__bg" cx="60" cy="60" r="52" fill="transparent" />
        <circle className="rest-timer__ticks" cx="60" cy="60" r={TICK_RADIUS} strokeDasharray={`${segment * 0.25} ${segment * 0.75}`} />
        <circle className="rest-timer__track" cx="60" cy="60" r={RADIUS} />
        <circle className="rest-timer__progress" cx="60" cy="60" r={RADIUS} stroke={isComplete ? 'var(--ct-success)' : `url(#${gradientId})`} filter={`url(#${glowId})`} strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - progress)} />
      </svg>
      <div className="rest-timer__content"><div className="rest-timer__number">{restStreak || 0}</div><div className="rest-timer__unit">{t('common.minutes')}</div></div>
      <div className="rest-timer__pulse" aria-hidden="true" />
      <div className="rest-timer__sparkle sparkle--1" aria-hidden="true" />
      <div className="rest-timer__sparkle sparkle--2" aria-hidden="true" />
      <div className="rest-timer__sparkle sparkle--3" aria-hidden="true" />
    </div>
  )
}
