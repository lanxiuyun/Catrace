import { useEffect, useRef, useState, type ReactElement } from 'react'
import Sortable from 'sortablejs'
import { useT } from '../i18n'
import { PageScroll } from '../components/PageScroll'
import { RadixPage } from '../components/RadixPage'
import { getSettingsStore } from '../lib/settingsStore'
import { MediaSettingsCard } from './settings/MediaSettingsCard'
import { SignalSettingsCard } from './settings/SignalSettingsCard'
import { SysNotifySettingsCard } from './settings/SysNotifySettingsCard'
import { LinksSettingsCard } from './settings/LinksSettingsCard'
import { SystemSettingsCard } from './settings/SystemSettingsCard'
import './settings.css'

const CORE_KEYS = ['media', 'signal', 'system', 'sysNotify', 'links'] as const
type CoreKey = (typeof CORE_KEYS)[number]

const CARD_BY_KEY: Record<CoreKey, () => ReactElement> = {
  media: () => <MediaSettingsCard />,
  signal: () => <SignalSettingsCard />,
  system: () => <SystemSettingsCard />,
  sysNotify: () => <SysNotifySettingsCard />,
  links: () => <LinksSettingsCard />,
}

const isCoreKey = (value: unknown): value is CoreKey =>
  typeof value === 'string' && (CORE_KEYS as readonly string[]).includes(value)

function normalizeOrder(saved: unknown): CoreKey[] {
  const order: CoreKey[] = []
  if (Array.isArray(saved)) {
    for (const value of saved) {
      if (isCoreKey(value) && !order.includes(value)) order.push(value)
    }
  }
  for (const key of CORE_KEYS) {
    if (!order.includes(key)) order.push(key)
  }
  return order
}

/** 系统设置页（React 版网格 + Sortable 拖拽排序），5 张设置卡全部是 React 组件。 */
export function Settings() {
  const t = useT()
  const [order, setOrder] = useState<CoreKey[]>([...CORE_KEYS])
  const [ready, setReady] = useState(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const store = await getSettingsStore()
        const saved = await store.get<string[]>('settings_group_order')
        const normalized = normalizeOrder(saved)
        if (!alive) return
        setOrder(normalized)
        if (JSON.stringify(saved) !== JSON.stringify(normalized)) {
          await store.set('settings_group_order', normalized)
        }
      } catch (error) {
        console.error('Failed to load settings group order', error)
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    if (!ready || !grid) return
    const sortable = Sortable.create(grid, {
      forceFallback: true,
      animation: 200,
      ghostClass: 'ct-dragging',
      dragClass: 'ct-drag-over',
      handle: '.ct-drag-handle',
      filter:
        'input, textarea, select, button, a, .rt-SliderRoot, .rt-SwitchRoot, .rt-SelectTrigger',
      preventOnFilter: false,
      onEnd: () => {
        const keys = Array.from(grid.children)
          .map((child) => child.getAttribute('data-group-key'))
          .filter(isCoreKey)
        if (keys.length !== CORE_KEYS.length) return
        setOrder(keys)
        void (async () => {
          try {
            const store = await getSettingsStore()
            await store.set('settings_group_order', keys)
          } catch (error) {
            console.error('Failed to save settings group order', error)
          }
        })()
      },
    })
    return () => sortable.destroy()
  }, [ready])

  return (
    <PageScroll>
      <RadixPage className="ct-settings-page">
        <div className="ct-settings">
          <h1 className="ct-settings-title">{t('settings.title')}</h1>
          <p className="ct-settings-subtitle">{t('settings.subtitle')}</p>

          <div className="ct-settings-grid" ref={gridRef}>
            {order.map((key) => (
              <div key={key} className="ct-settings-slot" data-group-key={key}>
                {CARD_BY_KEY[key]()}
                <div
                  className="ct-drag-handle"
                  role="button"
                  tabIndex={0}
                  aria-label={t('settings.dragHandle')}
                  title={t('settings.dragHandle')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="5" r="2" />
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="19" cy="5" r="2" />
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </RadixPage>
    </PageScroll>
  )
}
