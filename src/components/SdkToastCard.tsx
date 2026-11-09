import { useT } from '../app/i18n'
import type { EventAction, EventLevel, EventProgress } from '../types/event'
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
  const t = useT()
  const levelClass = level === 'success' || level === 'warning' || level === 'error' ? `level-${level}` : 'level-info'
  return (
    <div className={`ct-sdk-toast-card ${levelClass}`}>
      <div className="header">
        <div className="header-left"><div className="pulse-dot" /><h2 className="title">{title}</h2></div>
        <button type="button" className="close-btn" aria-label={t('common.close')} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      {!sticky && <div className={`progress-bar${isHovered ? ' paused' : ''}`} />}
      {body && <p className="body-text">{body}</p>}
      {progress && progress.total > 0 && <div className="sdk-progress">
        <div className="sdk-progress-track"><div className="sdk-progress-fill" style={{ width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }} /></div>
        <div className="sdk-progress-text">{progress.label || `${Math.round(progress.current)}/${Math.round(progress.total)}`}</div>
      </div>}
      {!!actions?.length && <div className="actions">{actions.map((action, index) => <button type="button" key={action.id} className={`btn ${index === actions.length - 1 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onAction?.(action.id)}>{action.label}</button>)}</div>}
    </div>
  )
}
