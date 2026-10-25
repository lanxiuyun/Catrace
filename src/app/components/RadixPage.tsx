import type { ReactNode } from 'react'
import { Theme } from '@radix-ui/themes'
import { useShellStore } from '../store'
import './radix-page.css'

/**
 * React 页面外层的 Radix 主题作用域。
 *
 * 只包 React 页面，不包 Vue 岛——避免 Radix 的样式影响 naive-ui。
 * 注意：Theme 作为根主题时自带 `min-height: 100vh`（见 shell.css 的
 * `.radix-themes.ct-radix-page` 覆盖），这里用 asChild 让 class 落在页面容器上。
 */
export function RadixPage({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const appearance = useShellStore((state) => state.resolvedTheme)
  return (
    <Theme
      asChild
      appearance={appearance}
      accentColor="iris"
      grayColor="slate"
      radius="large"
      scaling="100%"
      hasBackground={false}
    >
      <div className={className ? `ct-radix-page ${className}` : 'ct-radix-page'}>
        {children}
      </div>
    </Theme>
  )
}
