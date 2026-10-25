import type { ReactNode } from 'react'
import './page-scroll.css'

/**
 * React 版页面滚动容器（替代 Vue 的 PageScroll.vue / n-scrollbar）。
 * 迁移期 Vue 页面继续用原组件，React 页面用这个；M6 之后再统一。
 */
export function PageScroll({
  children,
  fillContent = false,
}: {
  children: ReactNode
  fillContent?: boolean
}) {
  return (
    <div className="ct-page-scroll">
      <div className={fillContent ? 'ct-page-scroll-content is-fill' : 'ct-page-scroll-content'}>
        {children}
      </div>
    </div>
  )
}
