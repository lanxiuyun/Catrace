import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { Theme } from '@radix-ui/themes'
import { ChartColumn, LayoutGrid, MessageCircle, Plug, Settings2 } from 'lucide-react'
import { useT } from '../i18n'
import { useShellStore } from '../store'
import './shell.css'

const NAV_ITEMS = [
  { to: '/dashboard', labelKey: 'nav.overview', Icon: LayoutGrid },
  { to: '/plugins', labelKey: 'nav.plugins', Icon: Plug },
  { to: '/debug', labelKey: 'nav.debug', Icon: ChartColumn },
  { to: '/settings', labelKey: 'nav.systemSettings', Icon: Settings2 },
] as const

export function MainShell({ children }: { children: ReactNode }) {
  const t = useT()
  const appearance = useShellStore((state) => state.resolvedTheme)
  const [version, setVersion] = useState('')

  useEffect(() => {
    let alive = true
    void getVersion()
      .then((value) => {
        if (alive) setVersion(value)
      })
      .catch(() => {
        /* 非 Tauri 环境（纯浏览器预览）没有版本号，忽略 */
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="app-shell">
      {/* Radix 主题只作用于 React 壳顶栏；Vue 岛页面留在作用域外，避免两套 UI 库样式互相影响。 */}
      <Theme
        asChild
        appearance={appearance}
        accentColor="iris"
        grayColor="slate"
        radius="large"
        scaling="100%"
        hasBackground={false}
      >
        <header className="global-header">
        <div className="brand-block">
          <div className="brand-copy">
            <strong>Catrace</strong>
            <span>v{version}</span>
          </div>
        </div>

        <nav className="global-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
            >
              <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="global-header-actions">
          <span className="community-tag" title={t('plugins.community')}>
            <MessageCircle size={12} strokeWidth={2} aria-hidden="true" />
            <span>{t('plugins.community')}</span>
            <strong>{t('plugins.communityNumber')}</strong>
          </span>
        </div>
        </header>
      </Theme>

      <main className="app-workspace">{children}</main>
    </div>
  )
}
