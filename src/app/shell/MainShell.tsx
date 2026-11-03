import { NavLink } from 'react-router-dom'
import { Bug, ChartPie, Plug, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '../i18n'
import { Toaster } from '../ui/toast'
import './shell.css'

const NAV_ITEMS = [
  { to: '/dashboard', labelKey: 'nav.overview', Icon: ChartPie },
  { to: '/plugins', labelKey: 'nav.plugins', Icon: Plug },
  { to: '/settings', labelKey: 'nav.systemSettings', Icon: Settings },
  { to: '/debug', labelKey: 'nav.debug', Icon: Bug },
] as const

/**
 * 主窗外壳：macOS 风格透光侧边栏 + 工作区。
 * 宽窗口侧栏带文字（10rem）；窄于 62rem 收成 3.75rem 图标栏，
 * 名称由 aria-label 提供给读屏，鼠标悬停显示 data-label 做的浮层。
 */
export function MainShell({ children }: { children: ReactNode }) {
  const t = useT()

  return (
    <div className="ct-app">
      <aside className="ct-sidebar">
        <nav className="ct-sidebar-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={t(labelKey)}
              data-label={t(labelKey)}
              className={({ isActive }) => `ct-sidebar-item${isActive ? ' is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="ct-workspace">{children}</main>
      <Toaster />
    </div>
  )
}
