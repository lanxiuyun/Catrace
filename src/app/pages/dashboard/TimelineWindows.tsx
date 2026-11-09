import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { MinuteData } from '../../../types/minute'
import { computeTimeBlocks, mergeRestBlocks, type TimeBlock } from '../../../utils/timeBlocks'
import { useT } from '../../i18n'
import './timeline-windows.css'

const MINUTES_PER_DAY = 1440
const CHUNK_MINUTES = 10

interface WindowBlock {
  active: boolean | null
  isCurrent: boolean
  startIdx: number
  endIdx: number
  startTs: number
  endTs: number
  minutes: MinuteData[]
}

interface Segment {
  active: boolean | null
  count: number
}

interface DisplayItem {
  type: 'segment' | 'cells'
  active: boolean | null
  count: number
  startTs: number
  minutes: MinuteData[]
}

interface ChunkRow {
  minutes: MinuteData[]
  isLast: boolean
}

function formatTime(ts: number): string {
  const date = new Date(ts * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function getLabel(
  t: (key: string) => string,
  active: boolean | null,
  isCurrent: boolean,
): string {
  if (isCurrent) return t('timelineWindows.inProgress')
  if (active === null) return t('timeline.null')
  if (active) return t('timeline.active')
  return t('timeline.rest')
}

function getColor(active: boolean | null): string {
  if (active === null) return 'var(--ct-border-strong)'
  if (active) return 'var(--ct-accent)'
  return 'var(--ct-success)'
}

function chunkMinutes(minutes: MinuteData[], size: number): MinuteData[][] {
  const chunks: MinuteData[][] = []
  for (let i = 0; i < minutes.length; i += size) {
    chunks.push(minutes.slice(i, i + size))
  }
  return chunks
}

function segmentRow(row: MinuteData[]): Segment[] {
  if (row.length === 0) return []
  const segments: Segment[] = []
  let current: Segment = { active: row[0].active, count: 1 }
  for (let i = 1; i < row.length; i++) {
    if (row[i].active === current.active) {
      current.count += 1
    } else {
      segments.push(current)
      current = { active: row[i].active, count: 1 }
    }
  }
  segments.push(current)
  return segments
}

function buildDisplayItems(row: MinuteData[]): DisplayItem[] {
  const segments = segmentRow(row)
  const items: DisplayItem[] = []
  let offset = 0
  for (const segment of segments) {
    if (segment.count >= 5) {
      items.push({
        type: 'segment',
        active: segment.active,
        count: segment.count,
        startTs: row[0].ts + offset * 60,
        minutes: [],
      })
    } else {
      items.push({
        type: 'cells',
        active: segment.active,
        count: segment.count,
        startTs: row[0].ts + offset * 60,
        minutes: row.slice(offset, offset + segment.count),
      })
    }
    offset += segment.count
  }
  return items
}

/** 合并连续同状态的 10 分钟行 */
function mergeChunkRows(chunks: MinuteData[][]): MinuteData[][] {
  if (chunks.length === 0) return []
  const merged: MinuteData[][] = []
  let current = chunks[0]
  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    const currentSegments = segmentRow(current)
    const nextSegments = segmentRow(next)
    if (
      currentSegments.length === 1 &&
      nextSegments.length === 1 &&
      currentSegments[0].active === nextSegments[0].active
    ) {
      current = current.concat(next)
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)
  return merged
}

function visibleMinutes(block: WindowBlock, nowIdx: number): MinuteData[] {
  if (!block.isCurrent) return block.minutes
  const end = Math.min(block.minutes.length, nowIdx - block.startIdx + 1)
  return block.minutes.slice(0, Math.max(0, end))
}

function chunkRows(block: WindowBlock, nowIdx: number): ChunkRow[] {
  const rows = mergeChunkRows(chunkMinutes(visibleMinutes(block, nowIdx), CHUNK_MINUTES))
  return rows.map((minutes, index) => ({ minutes, isLast: index === rows.length - 1 }))
}

function countActiveInBlock(block: WindowBlock): number {
  return block.minutes.filter((minute) => minute.active === true).length
}

/**
 * 概览视图：block 卡片网格 + 点击整行展开分钟色块。
 *
 * 信息顺序：状态胶囊 → 时间范围 → 时长（休息 block 再补「活跃 Xm」）。
 *
 * 可访问性：卡片外壳是普通 div，真正可聚焦的是盖住摘要区的 <button>；
 * 展开的明细是按钮的兄弟节点，不会因为「button 后代一律 presentational」而被读屏吞掉。
 */
export function TimelineWindows({
  minutes,
  windowMinutes = 45,
  breakMinutes = 5,
}: {
  minutes: MinuteData[]
  windowMinutes?: number
  breakMinutes?: number
}) {
  const t = useT()
  // 展开态用 block.startTs 做 key：block 列表每天会在头部插入新段，用数组下标会让展开状态串到别的卡。
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  // 展开过的卡片保留明细节点：否则收起时内容先被卸载，高度过渡没有可收回的东西。
  const [mounted, setMounted] = useState<Set<number>>(() => new Set())
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  const showTip = (event: ReactMouseEvent<HTMLElement>, text: string) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTip({ text, x: rect.left + rect.width / 2, y: rect.top - 6 })
  }

  const dayStart = minutes[0]?.ts ?? 0
  const nowIdx = dayStart
    ? Math.max(
        0,
        Math.min(MINUTES_PER_DAY - 1, Math.floor((Math.floor(Date.now() / 1000) - dayStart) / 60)),
      )
    : 0
  const nowTs = dayStart ? dayStart + nowIdx * 60 : Math.floor(Date.now() / 1000)

  const blocks = useMemo<WindowBlock[]>(() => {
    const raw = computeTimeBlocks(minutes, windowMinutes, breakMinutes, nowIdx)
    return mergeRestBlocks(raw)
      .map((block: TimeBlock) => ({
        active: block.active,
        isCurrent: block.isCurrent,
        startIdx: block.startIdx,
        endIdx: block.endIdx,
        startTs: block.startTs,
        endTs: block.endTs,
        minutes: block.minutes,
      }))
      .reverse()
  }, [minutes, windowMinutes, breakMinutes, nowIdx])

  const toggleBlock = (index: number) => {
    const grid = gridRef.current
    // 计算列数时只认 px 值：computed 在极端情况下可能是 "none"
    const columns = grid
      ? Math.max(1, (getComputedStyle(grid).gridTemplateColumns.match(/\d+(?:\.\d+)?px/g) ?? []).length)
      : 1
    const row = Math.floor(index / columns)
    const start = row * columns
    const end = Math.min(start + columns, blocks.length)
    const rowKeys = Array.from(
      { length: end - start },
      (_, offset) => blocks[start + offset].startTs,
    )
    setExpanded((previous) => {
      const anyExpanded = rowKeys.some((key) => previous.has(key))
      const next = new Set(previous)
      for (const key of rowKeys) {
        if (anyExpanded) next.delete(key)
        else next.add(key)
      }
      return next
    })
    setMounted((previous) => {
      const next = new Set(previous)
      for (const key of rowKeys) next.add(key)
      return next
    })
  }

  return (
    <div className="ct-timeline-windows">
      <div ref={gridRef} className="grid">
        {blocks.map((block, index) => {
          const key = block.startTs
          const isOpen = expanded.has(key)
          const detailId = `ct-block-detail-${key}`
          const nestedActive = block.active === false ? countActiveInBlock(block) : 0
          // 当前段的胶囊跟状态走：休息中的「进行中」是绿胶囊，不能显示成蓝色活跃。
          const badgeClass =
            block.active === false
              ? 'badge-rest'
              : block.isCurrent
                ? 'badge-current'
                : block.active === true
                  ? 'badge-active'
                  : 'badge-null'
          return (
            <div
              key={key}
              className={`card${block.isCurrent ? ' is-current' : ''}${isOpen ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="card-summary"
                aria-expanded={isOpen}
                aria-controls={detailId}
                onClick={() => toggleBlock(index)}
              >
                <span className="card-top">
                  <span className={`badge ${badgeClass}`}>
                    <span
                      className={block.isCurrent ? 'badge-dot is-pulse' : 'badge-dot'}
                      style={{ backgroundColor: getColor(block.active) }}
                    />
                    {getLabel(t, block.active, block.isCurrent)}
                  </span>
                  <ChevronDown
                    className="card-chevron"
                    size={14}
                    strokeWidth={2.2}
                    aria-hidden="true"
                  />
                </span>

                <span className="card-time">
                  {formatTime(block.startTs)}
                  <span className="time-sep">→</span>
                  {formatTime(block.isCurrent ? nowTs : block.endTs + 60)}
                </span>

                <span className="card-meta">
                  <span className="card-duration">
                    {formatDuration(
                      block.isCurrent ? nowIdx - block.startIdx : block.endIdx - block.startIdx,
                    )}
                  </span>
                  {block.active === false && nestedActive > 0 && (
                    <span className="card-nested-active">
                      {t('timelineWindows.activeShort')} {formatDuration(nestedActive)}
                    </span>
                  )}
                </span>
              </button>

              <div
                id={detailId}
                className={isOpen ? 'detail-wrap is-open' : 'detail-wrap'}
                aria-hidden={!isOpen}
              >
                <div className="detail">
                  {mounted.has(key) && (
                    <div className="detail-body">
                      <div className="minute-rows">
                        {chunkRows(block, nowIdx).map((row, rowIndex) => (
                          <div key={rowIndex} className="minute-row">
                            <div className="minute-row-bar">
                              {buildDisplayItems(row.minutes).map((item, itemIndex) =>
                                item.type === 'segment' ? (
                                  <div
                                    key={itemIndex}
                                    className={`m-seg ${
                                      item.active === true
                                        ? 'm-seg-active'
                                        : item.active === false
                                          ? 'm-seg-rest'
                                          : 'm-seg-null'
                                    }`}
                                    style={{ flex: item.count }}
                                    onMouseEnter={(event) =>
                                      showTip(
                                        event,
                                        `${formatTime(item.startTs)}–${formatTime(item.startTs + item.count * 60)} · ${formatDuration(item.count)}`,
                                      )
                                    }
                                    onMouseLeave={() => setTip(null)}
                                  />
                                ) : (
                                  <div key={itemIndex} className="m-cells" style={{ flex: item.count }}>
                                    {item.minutes.map((minute, minuteIndex) => (
                                      <div
                                        key={minuteIndex}
                                        className={`m-cell ${
                                          minute.active === true
                                            ? 'm-cell-active'
                                            : minute.active === false
                                              ? 'm-cell-rest'
                                              : 'm-cell-null'
                                        }`}
                                        onMouseEnter={(event) =>
                                          showTip(
                                            event,
                                            `${formatTime(minute.ts)} · ${getLabel(t, minute.active, false)}`,
                                          )
                                        }
                                        onMouseLeave={() => setTip(null)}
                                      />
                                    ))}
                                  </div>
                                ),
                              )}
                              {row.isLast && row.minutes.length < CHUNK_MINUTES && (
                                <div
                                  className="m-placeholder"
                                  style={{ flex: CHUNK_MINUTES - row.minutes.length }}
                                />
                              )}
                            </div>
                            <span className="minute-row-time">
                              {formatTime(row.minutes[0].ts)}–
                              {formatTime(row.minutes[row.minutes.length - 1].ts + 60)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {tip &&
        createPortal(
          <div className="ct-seg-tip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </div>,
          document.body,
        )}
    </div>
  )
}
