import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { Button, Dialog, Flex, SegmentedControl } from '@radix-ui/themes'
import { ChartColumn, LayoutGrid, Plug, Settings2, Sun } from 'lucide-react'
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
 * 主窗外壳：macOS 风格透光侧边栏 + 工作区（去掉顶部 header，内容直接铺满）。
 * 侧边栏结构参考根目录 catrace_macos_edition.html（Profile + 分组导航 + 底部设置）。
 */
export function MainShell({ children }: { children: ReactNode }) {
  const t = useT()
  const themeMode = useShellStore((state) => state.themeMode)
  const { setMode } = useTheme()
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

  const changeThemeMode = (value: string) => {
    void setMode(value === 'dark' || value === 'light' ? value : 'system')
  }

  return (
    <div className="ct-app">
      <aside className="ct-sidebar">
        <div className="ct-sidebar-profile">
          <div className="ct-sidebar-avatar" aria-hidden="true">
            C
          </div>
          <div className="ct-sidebar-profile-copy">
            <strong>Catrace</strong>
            <span>{version ? `v${version}` : 'Desktop Event OS'}</span>
          </div>
        </div>

        <div className="ct-sidebar-group">
          <div className="ct-sidebar-label">{t('shell.workspace')}</div>
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
        </div>

        <div className="ct-sidebar-bottom">
          <Dialog.Root>
            <Dialog.Trigger>
              <button type="button" className="ct-sidebar-item ct-sidebar-item-button">
                <Sun size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>{t('shell.appearance')}</span>
              </button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="420px">
              <Dialog.Title>{t('shell.appearance')}</Dialog.Title>
              <Dialog.Description size="2" mb="4">
                {t('shell.appearanceDesc')}
              </Dialog.Description>
              <SegmentedControl.Root value={themeMode} size="2" onValueChange={changeThemeMode}>
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

      <main className="ct-workspace">{children}</main>
    </div>
  )
}
