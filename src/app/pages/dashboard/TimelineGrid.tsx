import { useRef, useState } from 'react'
import type { MinuteData } from '../../../types/minute'
import { useT } from '../../i18n'
import './timeline-grid.css'

const MINUTES_PER_DAY = 1440
const MINUTE_TICKS = [0, 15, 30, 45]

function formatTime(ts: number): string {
  const date = new Date(ts * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function colorOf(minute: MinuteData): string {
  if (minute.active === null) return 'var(--ct-accent-soft)'
  if (minute.active) return 'var(--ct-accent)'
  return 'var(--ct-cyan)'
}

/** 全天分钟网格视图（原 components/Timeline.vue 的 React 版）。 */
export function TimelineGrid({ minutes }: { minutes: MinuteData[] }) {
  const t = useT()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  const now = Math.floor(Date.now() / 1000)
  const dayStart = minutes[0]?.ts ?? 0
  const nowRaw = dayStart ? Math.floor((now - dayStart) / 60) : -1
  const nowIndex = nowRaw >= 0 && nowRaw < MINUTES_PER_DAY ? nowRaw : null

  const labelOf = (minute: MinuteData): string => {
    if (minute.active === null) return t('timeline.null')
    if (minute.active) return t('timeline.active')
    return t('timeline.rest')
  }

  const isAdjacentSame = (index: number): boolean => {
    if (index <= 0 || index >= minutes.length - 1) return false
    const current = minutes[index].active
    return current === minutes[index - 1].active || current === minutes[index + 1].active
  }

  const onGridMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const grid = gridRef.current
    if (!grid) return
    const rect = grid.getBoundingClientRect()
    const col = Math.floor((event.clientX - rect.left) / (rect.width / 60))
    const row = Math.floor((event.clientY - rect.top) / (rect.height / 24))
    const index = row * 60 + col
    setHoveredIndex(Math.max(0, Math.min(MINUTES_PER_DAY - 1, index)))
  }

  const hovered = hoveredIndex !== null ? minutes[hoveredIndex] : undefined

  return (
    <div className="ct-timeline">
      <div className="grid-body">
        <div className="minute-ticks">
          {MINUTE_TICKS.map((minute) => (
            <div
              key={minute}
              className="minute-tick"
              style={{ left: `${(minute / 60) * 100}%` }}
            >
              {minute}
            </div>
          ))}
        </div>

        <div className="grid-area">
          <div className="hour-labels">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="hour-label">
                {String(hour).padStart(2, '0')}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="grid"
            onMouseMove={onGridMouseMove}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {minutes.map((minute, index) => {
              const className = [
                'cell',
                nowIndex === index ? 'is-now' : '',
                hoveredIndex === index ? 'is-hovered' : '',
                selectedIndex === index ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')
              const radius =
                minute.active !== null && isAdjacentSame(index) ? '0.0625rem' : undefined
              return (
                <div
                  key={index}
                  className={className}
                  style={{ backgroundColor: colorOf(minute), borderRadius: radius }}
                  onClick={() =>
                    setSelectedIndex((previous) => (previous === index ? null : index))
                  }
                />
              )
            })}
          </div>
        </div>
      </div>

      <div className="hover-row">
        {hovered ? (
          <div className="hover-info">
            <span className="hover-time">{formatTime(hovered.ts)}</span>
            <span className="hover-badge" style={{ backgroundColor: colorOf(hovered) }}>
              {labelOf(hovered)}
            </span>
          </div>
        ) : (
          <div className="hover-placeholder">{t('timeline.hoverHint')}</div>
        )}
      </div>

      <div className="legend">
        <div className="legend-item">
          <span className="dot" style={{ background: 'var(--ct-accent)' }} />
          <span>{t('timeline.active')}</span>
        </div>
        <div className="legend-item">
          <span className="dot" style={{ background: 'var(--ct-cyan)' }} />
          <span>{t('timeline.rest')}</span>
        </div>
        <div className="legend-item">
          <span className="dot" style={{ background: 'var(--ct-accent-soft)' }} />
          <span>{t('timeline.null')}</span>
        </div>
        <div className="legend-item">
          <span className="dot is-now-demo" />
          <span>{t('timeline.current')}</span>
        </div>
      </div>
    </div>
  )
}
