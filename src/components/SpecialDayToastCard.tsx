import { Button } from '@heroui/react'
import { X } from 'lucide-react'
import { useT } from '../app/i18n'
import './SpecialDayToastCard.css'

export type SpecialDayCategory = 'history' | 'life'

export interface SpecialDayToastCardProps {
  title: string
  body: string
  tag: string
  icon: string
  category: SpecialDayCategory
  onClose?: () => void
}

const THEMES = {
  history: {
    tagBg: 'rgba(42, 43, 46, 0.08)', tagFg: 'var(--ct-text-muted)', title: 'var(--ct-text)', body: 'var(--ct-text-muted)',
    divider: 'linear-gradient(90deg, rgba(42,43,46,0.28), rgba(42,43,46,0.06) 80%, transparent)',
    iconBg: 'rgba(42, 43, 46, 0.08)', close: 'var(--ct-text-subtle)',
    bg: 'linear-gradient(135deg, var(--ct-bg) 0%, var(--ct-bg) 60%, var(--ct-border) 100%)',
    border: 'rgba(42, 43, 46, 0.12)', shadow: 'rgba(42, 43, 46, 0.10)',
  },
  life: {
    tagBg: 'rgba(0, 82, 217, 0.08)', tagFg: 'var(--ct-info)', title: 'var(--ct-info)', body: 'var(--ct-info)',
    divider: 'linear-gradient(90deg, rgba(0,82,217,0.30), rgba(0,82,217,0.06) 80%, transparent)',
    iconBg: 'rgba(0, 82, 217, 0.08)', close: 'var(--ct-info)',
    bg: 'linear-gradient(135deg, var(--ct-info-soft) 0%, var(--ct-info-soft) 60%, var(--ct-info-soft) 100%)',
    border: 'rgba(0, 82, 217, 0.14)', shadow: 'rgba(0, 82, 217, 0.12)',
  },
} as const

export default function SpecialDayToastCard({ title, body, tag, icon, category, onClose }: SpecialDayToastCardProps) {
  const t = useT()
  const theme = THEMES[category]
  // Windows WebView2 may render a flag emoji as letters; retain the SVG token.
  const isCnFlag = icon === 'flag-cn' || icon === 'CN' || icon.includes('🇨🇳')
  return (
    <div className="ct-special-day-toast-card" style={{ background: theme.bg, borderColor: theme.border, boxShadow: `0 0.5rem 1.5rem ${theme.shadow}, 0 0.125rem 0.375rem rgba(0,0,0,0.04)` }}>
      <div className="special-header">
        <div className="special-title-row">
          <span className={`special-icon${isCnFlag ? ' special-icon-flag' : ''}`} style={{ background: isCnFlag ? 'transparent' : theme.iconBg }} aria-hidden="true">
            {isCnFlag ? <svg className="cn-flag" viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg">
              <rect width="30" height="20" fill="#DE2910" />
              <g fill="#FFDE00">
                <polygon points="5,2 5.9,4.7 3.2,3.1 6.8,3.1 4.1,4.7" />
                <polygon transform="translate(8.2,1.8) rotate(20) scale(0.35)" points="5,2 5.9,4.7 3.2,3.1 6.8,3.1 4.1,4.7" />
                <polygon transform="translate(9.8,3.6) rotate(40) scale(0.35)" points="5,2 5.9,4.7 3.2,3.1 6.8,3.1 4.1,4.7" />
                <polygon transform="translate(9.8,5.8) rotate(0) scale(0.35)" points="5,2 5.9,4.7 3.2,3.1 6.8,3.1 4.1,4.7" />
                <polygon transform="translate(8.2,7.4) rotate(-20) scale(0.35)" points="5,2 5.9,4.7 3.2,3.1 6.8,3.1 4.1,4.7" />
              </g>
            </svg> : icon}
          </span>
          <div className="special-titles"><h2 className="title" style={{ color: theme.title }}>{title}</h2><span className="special-tag" style={{ background: theme.tagBg, color: theme.tagFg }}>{tag}</span></div>
        </div>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.close')} style={{ color: theme.close }} onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      <div className="special-divider" style={{ background: theme.divider }} />
      <p className="body-text" style={{ color: theme.body }}>{body}</p>
    </div>
  )
}
