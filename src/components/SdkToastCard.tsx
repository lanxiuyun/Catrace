import { Button } from '@heroui/react'
import type { EventAction, EventLevel, EventProgress } from '../types/event'
import { ToastCardHeader } from './ToastCardHeader'
import './SdkToastCard.css'

export interface SdkToastCardProps {
  title: string
  body: string
  level?: EventLevel | string
  isHovered?: boolean
  sticky?: boolean
  progress?: EventProgress | null
  actions?: EventAction[]
  onClose?: () => void
  onAction?: (actionId: string) => void
}

export default function SdkToastCard({ title, body, level, isHovered, sticky, progress, actions, onClose, onAction }: SdkToastCardProps) {
  const levelClass = level === 'success' || level === 'warning' || level === 'error' ? `level-${level}` : 'level-info'
  return (
    <div className={`ct-sdk-toast-card ${levelClass}`}>
      <ToastCardHeader title={title} leading={<div className="pulse-dot" />} onClose={onClose} />
      {!sticky && <div className={`progress-bar${isHovered ? ' paused' : ''}`} />}
      {body && <p className="body-text">{body}</p>}
      {progress && progress.total > 0 && <div className="sdk-progress">
        <div className="sdk-progress-track"><div className="sdk-progress-fill" style={{ width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }} /></div>
        <div className="sdk-progress-text">{progress.label || `${Math.round(progress.current)}/${Math.round(progress.total)}`}</div>
      </div>}
      {!!actions?.length && <div className="actions">{actions.map((action, index) => <Button key={action.id} size="sm" variant={index === actions.length - 1 ? 'primary' : 'tertiary'} onClick={() => onAction?.(action.id)}>{action.label}</Button>)}</div>}
    </div>
  )
}
