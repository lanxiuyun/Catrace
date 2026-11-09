import type { ReactNode } from 'react'
import './page-scroll.css'

/**
 * 主窗页面唯一的纵向滚动容器，主布局自身不滚动。
 */
export function PageScroll({
  children,
  fillContent = false,
  className,
}: {
  children: ReactNode
  fillContent?: boolean
  className?: string
}) {
  return (
    <div className={className ? `ct-page-scroll ${className}` : 'ct-page-scroll'}>
      <div className={fillContent ? 'ct-page-scroll-content is-fill' : 'ct-page-scroll-content'}>
        {children}
      </div>
    </div>
  )
}
