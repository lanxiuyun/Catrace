import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SegmentedControl, Switch } from '@radix-ui/themes'
import { getConfig, getHideStats, getTodayRecords, setHideStats } from '../../api/tauri'
import { computeTimeBlocks } from '../../utils/timeBlocks'
import type { MinuteData } from '../../types/minute'
import { useT } from '../i18n'
import { useShellStore } from '../store'
import { PageScroll } from '../components/PageScroll'
import { RadixPage } from '../components/RadixPage'
import { TimelineGrid } from './dashboard/TimelineGrid'
import { TimelineWindows } from './dashboard/TimelineWindows'
import './dashboard.css'

const MINUTES_PER_DAY = 1440
const EGG_HOVER_DELAY = 500
const EGG_FADE_OUT_DELAY = 500
const POLL_INTERVAL_MS = 10000
const DEFAULT_CONFIG = { window_minutes: 45, break_minutes: 5 }

type TimelineMode = 'segments' | 'grid'

function startOfDayTs(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

function currentMinuteIndex(dayStart: number): number {
  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor((now - dayStart) / 60)))
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** 今日统计页（Dashboard 的 React 版，替代 views/mainWindow/Dashboard.vue）。 */
export function Dashboard() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)

  const [records, setRecords] = useState<Map<number, boolean>>(() => new Map())
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [hideStats, setHideStatsState] = useState(false)
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('segments')
  const [eggVisible, setEggVisible] = useState(false)
  const eggTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [nextConfig, nextHideStats] = await Promise.all([getConfig(), getHideStats()])
      setConfig({
        window_minutes: Number(nextConfig.window_minutes),
        break_minutes: Number(nextConfig.break_minutes),
      })
      setHideStatsState(nextHideStats)
      const raw = await getTodayRecords()
      const map = new Map<number, boolean>()
      for (const [ts, active] of raw) map.set(ts, active)
      setRecords(map)
    } catch (error) {
      console.error('Failed to load data', error)
    }
  }, [])

  useEffect(() => {
    void loadData()
    const timer = setInterval(() => {
      void loadData()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [loadData])

  useEffect(
    () => () => {
      if (eggTimer.current) clearTimeout(eggTimer.current)
    },
    [],
  )

  const showEgg = () => {
    if (eggTimer.current) clearTimeout(eggTimer.current)
    eggTimer.current = setTimeout(() => {
      setEggVisible(true)
      eggTimer.current = null
    }, EGG_HOVER_DELAY)
  }

  const hideEgg = () => {
    if (eggTimer.current) clearTimeout(eggTimer.current)
    eggTimer.current = setTimeout(() => {
      setEggVisible(false)
      eggTimer.current = null
    }, EGG_FADE_OUT_DELAY)
  }

  const toggleHideStats = async (value: boolean) => {
    try {
      await setHideStats(value)
      setHideStatsState(value)
    } catch (error) {
      console.error('Failed to set hide stats', error)
    }
  }

  const dayStart = startOfDayTs()

  const allMinutes = useMemo<MinuteData[]>(() => {
    const result: MinuteData[] = []
    for (let i = 0; i < MINUTES_PER_DAY; i++) {
      const ts = dayStart + i * 60
      result.push({ ts, active: records.has(ts) ? records.get(ts)! : null })
    }
    return result
  }, [dayStart, records])

  const blocks = useMemo(() => {
    const nowIdx = currentMinuteIndex(dayStart)
    return computeTimeBlocks(allMinutes, config.window_minutes, config.break_minutes, nowIdx)
  }, [allMinutes, config, dayStart])

  // 与 Vue 版一致：活跃 block 全部时长算活跃；休息 block 里逐分钟拆活跃/休息。
  const blockStats = useMemo(() => {
    let activeMinutes = 0
    let restMinutes = 0
    for (const block of blocks) {
      if (block.active === null) continue
      if (block.active === true) {
        activeMinutes += block.endIdx - block.startIdx
        continue
      }
      for (const minute of block.minutes) {
        if (minute.active === true) activeMinutes += 1
        else restMinutes += 1
      }
    }
    return { activeMinutes, restMinutes }
  }, [blocks])

  const activityPercent = useMemo(() => {
    const total = blockStats.activeMinutes + blockStats.restMinutes
    return total > 0 ? Math.round((blockStats.activeMinutes / total) * 100) : 0
  }, [blockStats])

  const activeBlockCount = useMemo(
    () => blocks.filter((block) => block.active === true).length,
    [blocks],
  )

  const dateLabel = new Date().toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return (
    <PageScroll>
      <RadixPage className="ct-dashboard-page">
        <div className="ct-dashboard">
          <div
            className={eggVisible ? 'egg-toast egg-toast--visible' : 'egg-toast'}
            aria-hidden="true"
            onMouseEnter={showEgg}
            onMouseLeave={hideEgg}
          >
            <span className="demo-thanks">{t('dashboard.thanks')}</span>
          </div>

          <header className="header">
            <p className="subtitle">{dateLabel}</p>
            <div className="header-actions">
              <span className="hide-stats-label">{t('dashboard.hideStats.label')}</span>
              <Switch
                checked={hideStats}
                size="1"
                onCheckedChange={(value) => {
                  void toggleHideStats(value)
                }}
              />
            </div>
          </header>

          {!hideStats && (
            <section className="stats">
              <div className="stat stat-active">
                <div className="stat-head">
                  <span className="dot dot-active" />
                  <span className="stat-label">{t('dashboard.stats.active')}</span>
                </div>
                <p className="stat-value">{formatDuration(blockStats.activeMinutes)}</p>
              </div>
              <div className="stat stat-rest">
                <div className="stat-head">
                  <span className="dot dot-rest" />
                  <span className="stat-label">{t('dashboard.stats.rest')}</span>
                </div>
                <p className="stat-value">{formatDuration(blockStats.restMinutes)}</p>
              </div>
              <div className="stat stat-ratio">
                <div className="stat-head">
                  <span className="dot dot-ratio" />
                  <span className="stat-label">{t('dashboard.stats.ratio')}</span>
                </div>
                <p className="stat-value">
                  {activityPercent}
                  <span className="stat-unit">%</span>
                </p>
              </div>
              <div className="stat stat-blocks">
                <div className="stat-head">
                  <span className="dot dot-muted" />
                  <span className="stat-label">{t('dashboard.stats.blocks')}</span>
                </div>
                <p className="stat-value">
                  {activeBlockCount}
                  {t('dashboard.stats.blocksUnit') && (
                    <span className="stat-unit">{t('dashboard.stats.blocksUnit')}</span>
                  )}
                </p>
              </div>
            </section>
          )}

          <section className="activity-section">
            <div className="activity-head">
              <div className="activity-title-row">
                <h2 className="activity-title">{t('dashboard.activity.title')}</h2>
                <span className="activity-count">
                  {t('dashboard.activity.count', { n: blocks.length })}
                </span>
              </div>
              <SegmentedControl.Root
                className="ct-segmented"
                value={timelineMode}
                size="1"
                onValueChange={(value) => setTimelineMode(value === 'grid' ? 'grid' : 'segments')}
              >
                <SegmentedControl.Item value="segments">
                  {t('dashboard.activity.overview')}
                </SegmentedControl.Item>
                <SegmentedControl.Item value="grid">
                  {t('dashboard.activity.detailed')}
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </div>

            {timelineMode === 'grid' ? (
              <div className="activity-panel">
                <TimelineGrid minutes={allMinutes} />
              </div>
            ) : (
              <TimelineWindows
                minutes={allMinutes}
                windowMinutes={config.window_minutes}
                breakMinutes={config.break_minutes}
              />
            )}

            {records.size === 0 && <p className="empty">{t('dashboard.activity.empty')}</p>}
          </section>
        </div>
      </RadixPage>
    </PageScroll>
  )
}
