import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { Button, Dialog, Flex, IconButton, SegmentedControl } from '@radix-ui/themes'
import {
  ChartColumn,
  ChevronRight,
  LayoutGrid,
  Moon,
  Plug,
  Settings2,
  Sun,
} from 'lucide-react'
import { useT } from '../i18n'
import { useShellStore } from '../store'
import { useTheme } from '../../composables/useTheme'
import './shell.css'

const NAV_ITEMS = [
  { to: '/dashboard', labelKey: 'nav.overview', Icon: LayoutGrid },
  { to: '/plugins', labelKey: 'nav.plugins', Icon: Plug },
  { to: '/debug', labelKey: 'nav.debug', Icon: ChartColumn },
  { to: '/settings', labelKey: 'nav.systemSettings', Icon: Settings2 },
] as const

/**
 * 主窗外壳：左侧图标导航 + 顶栏面包屑 + 工作区（对齐 catrace-ui-concept.html）。
 * Radix 主题只包住导航栏和顶栏；Vue 岛页面留在主题作用域外，避免样式互相影响。
 */
export function MainShell({ children }: { children: ReactNode }) {
  const t = useT()
  const resolved = useShellStore((state) => state.resolvedTheme)
  const themeMode = useShellStore((state) => state.themeMode)
  const { setMode } = useTheme()
  const location = useLocation()
  const [version, setVersion] = useState('')

  useEffect(() => {
    let alive = true
    void getVersion()
      .then((value) => {
        if (alive) setVersion(value)
      })
      .catch(() => {
        /* 非 Tauri 预览环境没有版本号 */
      })
    return () => {
      alive = false
    }
  }, [])

  const activeItem = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))
  const pageTitle = activeItem ? t(activeItem.labelKey) : ''

  const changeThemeMode = (value: string) => {
    void setMode(value === 'dark' || value === 'light' ? value : 'system')
  }

  return (
    <div className="ct-app">
      <aside className="ct-rail">
          <div className="ct-brand" title={version ? `Catrace v${version}` : 'Catrace'}>
            C
          </div>

          <nav className="ct-rail-nav" aria-label="Primary navigation">
            {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `ct-rail-link${isActive ? ' is-active' : ''}`}
                aria-label={t(labelKey)}
                title={t(labelKey)}
              >
                <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
              </NavLink>
            ))}
          </nav>

          <div className="ct-rail-bottom">
            <Dialog.Root>
              <Dialog.Trigger>
                <IconButton
                  variant="ghost"
                  color="gray"
                  aria-label={t('shell.appearance')}
                  title={t('shell.appearance')}
                >
                  <Sun size={18} strokeWidth={1.9} aria-hidden="true" />
                </IconButton>
              </Dialog.Trigger>
              <Dialog.Content maxWidth="420px">
                <Dialog.Title>{t('shell.appearance')}</Dialog.Title>
                <Dialog.Description size="2" mb="4">
                  {t('shell.appearanceDesc')}
                </Dialog.Description>
                <SegmentedControl.Root
                  value={themeMode}
                  size="2"
                  onValueChange={changeThemeMode}
                >
                  <SegmentedControl.Item value="light">{t('shell.light')}</SegmentedControl.Item>
                  <SegmentedControl.Item value="dark">{t('shell.dark')}</SegmentedControl.Item>
                  <SegmentedControl.Item value="system">{t('shell.system')}</SegmentedControl.Item>
                </SegmentedControl.Root>
                <Flex justify="end" mt="4">
                  <Dialog.Close>
                    <Button>{t('shell.done')}</Button>
                  </Dialog.Close>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>
          </div>
      </aside>

      <div className="ct-main">
        <header className="ct-topbar">
            <div className="ct-breadcrumb">
              <span>{t('shell.workspace')}</span>
              <ChevronRight size={12} aria-hidden="true" />
              <strong>{pageTitle}</strong>
            </div>
            <div className="ct-topbar-actions">
              {version && <span className="ct-version">v{version}</span>}
              <IconButton
                variant="surface"
                color="gray"
                aria-label={t('shell.appearance')}
                title={t('shell.appearance')}
                onClick={() => {
                  void setMode(resolved === 'dark' ? 'light' : 'dark')
                }}
              >
                {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </IconButton>
            </div>
        </header>

        <main className="ct-workspace">{children}</main>
      </div>
    </div>
  )
}
