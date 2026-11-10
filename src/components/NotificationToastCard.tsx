import { Button } from '@heroui/react'
import { X } from 'lucide-react'
import { useT } from '../app/i18n'
import type { EventAction } from '../types/event'
import './NotificationToastCard.css'

export interface NotificationToastCardProps {
  appName?: string
  icon?: string
  title: string
  body: string
  isHovered?: boolean
  /** Backend-filtered source notification actions. */
  actions?: EventAction[]
  bodyAction?: boolean
  onClose?: () => void
  onAction?: (action: EventAction) => void
  onActivate?: () => void
}

export default function NotificationToastCard({ appName, icon, title, body, isHovered, actions, bodyAction, onClose, onAction, onActivate }: NotificationToastCardProps) {
  const t = useT()
  const displayName = appName || 'Windows'
  return (
    <div className={`ct-notification-toast-card${bodyAction ? ' clickable' : ''}`} onClick={() => { if (bodyAction) onActivate?.() }}>
      <div className="header">
        {icon ? <img className="app-icon" src={icon} alt="" /> : <div className="app-icon app-icon-fallback">{displayName.slice(0, 1).toUpperCase()}</div>}
        <span className="app-name">{displayName}</span>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.close')} onClick={(event) => { event.stopPropagation(); onClose?.() }}>
          <X size={14} />
        </Button>
      </div>
      {/* Keep the same progress element mounted so CSS and host lifetime resume together. */}
      <div className={`progress-bar${isHovered ? ' paused' : ''}`} />
      {title && <p className="notif-title">{title}</p>}
      {body && body !== title && <p className="notif-body">{body}</p>}
      {!!actions?.length && <div className="notif-actions">{actions.map((action) => <Button key={action.id} size="sm" variant="tertiary" onClick={(event) => { event.stopPropagation(); onAction?.(action) }}>{action.label}</Button>)}</div>}
    </div>
  )
}
