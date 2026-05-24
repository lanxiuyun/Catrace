import type { MinuteData } from '../components/Timeline.vue'

export interface TimeBlock {
  startIdx: number
  endIdx: number
  startTs: number
  endTs: number
  active: boolean | null
  isCurrent: boolean
  minutes: MinuteData[]
}

export function computeTimeBlocks(
  minutes: MinuteData[],
  windowMinutes: number,
  breakMinutes: number,
  nowIdx: number
): TimeBlock[] {
  if (minutes.length === 0) return []

  let firstIdx = minutes.findIndex(m => m.active !== null)
  if (firstIdx === -1) firstIdx = 0

  const result: TimeBlock[] = []
  const W = windowMinutes
  const B = breakMinutes

  function isRest(m: MinuteData): boolean {
    return m.active === false || m.active === null
  }

  // 前缀：firstIdx 之前的无记录分钟单独成一个窗口
  if (firstIdx > 0) {
    result.push({
      startIdx: 0,
      endIdx: firstIdx,
      startTs: minutes[0].ts,
      endTs: minutes[firstIdx - 1].ts,
      active: null,
      isCurrent: nowIdx >= 0 && nowIdx < firstIdx,
      minutes: minutes.slice(0, firstIdx),
    })
  }

  function findBreakEnd(start: number, maxScan: number): number {
    let restStreak = 0
    let breakStart = -1
    for (let i = start; i < Math.min(start + maxScan, minutes.length); i++) {
      if (isRest(minutes[i])) {
        if (breakStart === -1) breakStart = i
        restStreak++
        if (restStreak >= B) {
          let end = i + 1
          while (end < minutes.length && isRest(minutes[end])) {
            end++
          }
          return end
        }
      } else {
        restStreak = 0
        breakStart = -1
      }
    }
    return -1
  }

  let s = firstIdx
  while (s < minutes.length) {
    const breakEnd = findBreakEnd(s, W)

    if (breakEnd !== -1) {
      const isCur = nowIdx >= s && nowIdx < breakEnd
      result.push({
        startIdx: s,
        endIdx: breakEnd,
        startTs: minutes[s].ts,
        endTs: minutes[breakEnd - 1].ts,
        active: false,
        isCurrent: isCur,
        minutes: minutes.slice(s, breakEnd),
      })
      s = breakEnd
    } else {
      const end = Math.min(s + W, minutes.length)
      const isCur = nowIdx >= s && nowIdx < end
      result.push({
        startIdx: s,
        endIdx: end,
        startTs: minutes[s].ts,
        endTs: minutes[end - 1]?.ts ?? minutes[s].ts,
        active: true,
        isCurrent: isCur,
        minutes: minutes.slice(s, end),
      })
      s = end
    }
  }

  return result
}

export function mergeRestBlocks(blocks: TimeBlock[]): TimeBlock[] {
  if (blocks.length === 0) return []

  const result: TimeBlock[] = []
  let cur: TimeBlock | null = null

  for (const b of blocks) {
    if (!cur) {
      cur = { ...b, minutes: [...b.minutes] }
    } else if (!b.isCurrent && !cur.isCurrent && cur.active === false && b.active === false) {
      cur.minutes.push(...b.minutes)
      cur.endIdx = b.endIdx
      cur.endTs = b.endTs
    } else {
      result.push(cur)
      cur = { ...b, minutes: [...b.minutes] }
    }
  }
  if (cur) result.push(cur)
  return result
}
