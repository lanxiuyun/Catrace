import { openUrl } from '@tauri-apps/plugin-opener'
import { openLogsDir } from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'

interface LinkItem {
  url?: string
  title: string
  desc: string
  icon: string
  tone: string
  action?: () => Promise<void>
}

/** 链接：GitHub / 更新日志 / Issues / 日志目录。 */
export function LinksSettingsCard() {
  const t = useT()

  const links: LinkItem[] = [
    {
      url: 'https://github.com/lanxiuyun/Catrace',
      title: t('settings.links.githubTitle'),
      desc: t('settings.links.githubDesc'),
      icon: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z',
      tone: 'default',
    },
    {
      url: 'https://github.com/lanxiuyun/Catrace/releases',
      title: t('settings.links.changelogTitle'),
      desc: t('settings.links.changelogDesc'),
      icon: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
      tone: 'info',
    },
    {
      url: 'https://github.com/lanxiuyun/Catrace/issues',
      title: t('settings.links.issuesTitle'),
      desc: t('settings.links.issuesDesc'),
      icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
      tone: 'warning',
    },
    {
      title: t('debug.openLogsDir'),
      desc: t('settings.links.logsDesc'),
      icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
      tone: 'accent',
      action: () => openLogsDir(),
    },
  ]

  const handleClick = (link: LinkItem) => {
    if (link.action) {
      void link.action().catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error), 'error')
      })
      return
    }
    if (link.url) void openUrl(link.url).catch(() => {})
  }

  return (
    <div className="ct-settings-card">
      <div className="ct-settings-card-label">{t('settings.groups.links')}</div>
      <div className="ct-link-list">
        {links.map((link) => (
          <button
            key={link.title}
            type="button"
            className="ct-link-item"
            onClick={() => handleClick(link)}
          >
            <span className={`ct-link-icon is-${link.tone}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={link.icon} />
              </svg>
            </span>
            <span className="ct-link-body">
              <span className="ct-link-title">{link.title}</span>
              <span className="ct-link-desc">{link.desc}</span>
            </span>
            <svg
              className="ct-link-arrow"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
