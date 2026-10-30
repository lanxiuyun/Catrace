import { NavLink } from 'react-router-dom'
import { Bug, ChartPie, Plug, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '../i18n'
import { Toaster } from '../ui/toast'
import './shell.css'

const NAV_ITEMS = [
  { to: '/dashboard', labelKey: 'nav.overview', Icon: ChartPie },
  { to: '/plugins', labelKey: 'nav.plugins', Icon: Plug },
  { to: '/debug', labelKey: 'nav.debug', Icon: Bug },
  { to: '/settings', labelKey: 'nav.systemSettings', Icon: Settings },
] as const

/**
 * 主窗外壳：macOS 风格透光侧边栏 + 工作区。
 * 侧边栏只剩导航（Profile、分组标题、底部外观入口都已去掉；主题改在「系统设置 → 外观主题」里）。
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
              className={({ isActive }) => `ct-sidebar-item${isActive ? ' is-active' : ''}`}
            >
              <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
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
