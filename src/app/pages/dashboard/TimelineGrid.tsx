import { memo, useRef, useState, type CSSProperties } from 'react'
import type { MinuteData } from '../../../types/minute'
import { useT } from '../../i18n'
import './timeline-grid.css'

const MINUTES_PER_DAY = 1440
const COLS = 60
const ROWS = 24
const MINUTE_TICKS = [0, 15, 30, 45]
/** 小时标签每 3 小时一个：24 行网格每行只有 7~8px，逐小时标会挤在一起 */
const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21]

/** 单个格子的宽高表达式（扣掉格间距），给「当前分钟」覆盖环定位用。 */
const CELL_W_EXPR = '((100% - 59 * 0.125rem) / 60)'
const CELL_H_EXPR = '((100% - 23 * 0.125rem) / 24)'

function formatTime(ts: number): string {
  const date = new Date(ts * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 状态 → 颜色语义的 class（蓝=活跃 / 绿=休息 / 灰=无记录），和概览卡同一套。 */
function stateClassOf(active: boolean | null): string {
  if (active === null) return 'is-null'
  if (active) return 'is-active'
  return 'is-rest'
}

/** 「当前分钟」覆盖环的位置：按列/行索引 + 格间距换算成百分比。 */
function nowRingStyle(index: number): CSSProperties {
  const row = Math.floor(index / COLS)
  const col = index % COLS
  return {
    left: `calc(${col} * ${CELL_W_EXPR} + ${col} * 0.125rem)`,
    top: `calc(${row} * ${CELL_H_EXPR} + ${row} * 0.125rem)`,
    width: `calc(${CELL_W_EXPR})`,
    height: `calc(${CELL_H_EXPR})`,
  }
}

/**
 * 1440 个格子单独包一层 memo，并且只依赖分钟数据。
 * 悬停时**不重渲染它们**：否则每次 mousemove 都要协调 1440 个节点，
 * 主线程被这些渲染/重绘占满，输入事件会排队，表现就是「hover 卡死」。
 */
const Cells = memo(function Cells({ minutes }: { minutes: MinuteData[] }) {
  return (
    <>
      {minutes.map((minute, index) => (
        <div key={index} className={`cell ${stateClassOf(minute.active)}`} />
      ))}
    </>
  )
})

/** 全天分钟网格视图。 */
export function TimelineGrid({ minutes }: { minutes: MinuteData[] }) {
  const t = useT()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const lastHoveredRef = useRef<number | null>(null)

  const now = Math.floor(Date.now() / 1000)
  const dayStart = minutes[0]?.ts ?? 0
  const nowRaw = dayStart ? Math.floor((now - dayStart) / 60) : -1
  const nowIndex = nowRaw >= 0 && nowRaw < MINUTES_PER_DAY ? nowRaw : null

  const labelOf = (minute: MinuteData): string => {
    if (minute.active === null) return t('timeline.null')
    if (minute.active) return t('timeline.active')
    return t('timeline.rest')
  }

  // 同一格不重复 setState：鼠标在格子边缘抖动时不该触发 React 渲染
  const setHovered = (index: number | null) => {
    if (lastHoveredRef.current === index) return
    lastHoveredRef.current = index
    setHoveredIndex(index)
  }

  const onGridMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const grid = gridRef.current
    if (!grid) return
    const rect = grid.getBoundingClientRect()
    const col = Math.floor((event.clientX - rect.left) / (rect.width / COLS))
    const row = Math.floor((event.clientY - rect.top) / (rect.height / ROWS))
    const index = row * COLS + col
    setHovered(index >= 0 && index < MINUTES_PER_DAY ? index : null)
  }

  const hovered = hoveredIndex !== null ? minutes[hoveredIndex] : undefined

  return (
    <div className="ct-timeline">
      <div className="grid-body">
        <div className="minute-ticks" aria-hidden="true">
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
          <div className="hour-labels" aria-hidden="true">
            {HOUR_LABELS.map((hour) => (
              <div key={hour} className="hour-label" style={{ gridRow: hour + 1 }}>
                {String(hour).padStart(2, '0')}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="grid"
            onMouseMove={onGridMouseMove}
            onMouseLeave={() => setHovered(null)}
          >
            <Cells minutes={minutes} />
            {nowIndex !== null && (
              <div className="now-ring" style={nowRingStyle(nowIndex)} aria-hidden="true" />
            )}
          </div>
        </div>
      </div>

      <div className="timeline-footer">
        <div className="hover-readout">
          {hovered ? (
            <>
              <span className="hover-time">{formatTime(hovered.ts)}</span>
              <span className={`hover-badge ${stateClassOf(hovered.active)}`}>
                {labelOf(hovered)}
              </span>
            </>
          ) : (
            <span className="hover-hint">{t('timeline.hoverHint')}</span>
          )}
        </div>

        <div className="legend">
          <span className="legend-item">
            <span className="legend-dot is-active" aria-hidden="true" />
            {t('timeline.active')}
          </span>
          <span className="legend-item">
            <span className="legend-dot is-rest" aria-hidden="true" />
            {t('timeline.rest')}
          </span>
          <span className="legend-item">
            <span className="legend-dot is-null" aria-hidden="true" />
            {t('timeline.null')}
          </span>
          <span className="legend-item">
            <span className="legend-dot is-now" aria-hidden="true" />
            {t('timeline.current')}
          </span>
        </div>
      </div>
    </div>
  )
}
