import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@heroui/react'
import { X } from 'lucide-react'
import { useT } from '../app/i18n'

/**
 * Shared Toast card header: optional leading glyph, title, extra header content,
 * and the close button. Card-specific CSS still owns colors and spacing.
 */
export function ToastCardHeader({
  title,
  leading,
  children,
  onClose,
  showClose = true,
  className,
  leftClassName,
  titleClassName,
  closeClassName,
  closeStyle,
}: {
  title: ReactNode
  leading?: ReactNode
  children?: ReactNode
  onClose?: () => void
  showClose?: boolean
  className?: string
  leftClassName?: string
  titleClassName?: string
  closeClassName?: string
  closeStyle?: CSSProperties
}) {
  const t = useT()
  return (
    <div className={className ? `header ${className}` : 'header'}>
      <div className={leftClassName ? `header-left ${leftClassName}` : 'header-left'}>
        {leading}
        <h2 className={titleClassName ? `title ${titleClassName}` : 'title'}>{title}</h2>
        {children}
      </div>
      {showClose && onClose && (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t('common.close')}
          className={closeClassName ? `ct-toast-card-close ${closeClassName}` : 'ct-toast-card-close'}
          style={closeStyle}
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      )}
    </div>
  )
}
