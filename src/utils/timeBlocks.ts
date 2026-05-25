import type { MinuteData } from '../components/Timeline.vue'

/**
 * 一个 block 代表一段连续的时间区间，按「前瞻式窗口」切分得到。
 *
 * 切分规则（以 window_minutes=45, break_minutes=5 为例）：
 * 1. 从首个有记录的时间点开始向后扫描。
 * 2. 以 45 分钟为扫描窗口，若窗口内遇到连续 5 分钟休息（active=false 或 null），
 *    则切为「休息 block」，范围延伸到连续休息结束。
 * 3. 若窗口内无足够连续休息，则切为「活跃 block」，固定 45 分钟长度。
 * 4. 当前时间所在 block 标记为 isCurrent。
 *
 * 关键约束：切分只考虑「已发生的分钟」（索引 ≤ nowIdx），
 * 未来未记录的 null 不会被当作「连续休息」来结束当前 block。
 */
export interface TimeBlock {
  startIdx: number   // 起始分钟索引（0~1439，相对于当天 00:00）
  endIdx: number     // 结束分钟索引（不包含边界，即 [start, end)）
  startTs: number    // 起始时间戳（秒）
  endTs: number      // 结束时间戳（秒，对应 endIdx-1 的那一分钟）
  active: boolean | null  // true=活跃, false=休息, null=无记录（仅前缀可能出现）
  isCurrent: boolean // 当前时间是否落在此 block 内
  minutes: MinuteData[]  // 包含的分钟数据（长度 = endIdx - startIdx）
}

/**
 * 前瞻式 block 切分。
 *
 * @param minutes      全天 1440 分钟的 MinuteData（0:00~23:59）
 * @param windowMinutes 工作窗口长度，默认 45
 * @param breakMinutes  连续休息多少分钟算打断，默认 5
 * @param nowIdx        当前分钟的全天索引（0~1439）
 * @returns             切分后的 TimeBlock 数组
 *
 * 为什么截断到 nowIdx + 1：
 * allMinutes 从当前时间到 23:59 都是 null（无记录）。若不排除这些未来 null，
 * findBreakEnd 会把它们当成「连续休息」，切出一个从当前时间直通午夜的超大休息 block，
 * 既污染统计数据，也让 UI 显示幽灵时段。
 */
export function computeTimeBlocks(
  minutes: MinuteData[],
  windowMinutes: number,
  breakMinutes: number,
  nowIdx: number
): TimeBlock[] {
  if (minutes.length === 0) return []

  // 只处理到当前时间为止的数据，避免未来的 null 干扰切分逻辑与统计
  const effectiveMinutes = minutes.slice(0, Math.min(minutes.length, nowIdx + 1))

  let firstIdx = effectiveMinutes.findIndex(m => m.active !== null)
  if (firstIdx === -1) firstIdx = 0

  const result: TimeBlock[] = []
  const W = windowMinutes
  const B = breakMinutes

/**
   * 判断某分钟是否属于「休息」。
   * null 视为休息，这样无记录前缀也能被正确切分为独立 block。
   * （注意：这里的 null 仅限于「已发生的」无记录分钟，未来 null 已通过 effectiveMinutes 排除。）
   */
  function isRest(m: MinuteData): boolean {
    return m.active === false || m.active === null
  }

  // 前缀：firstIdx 之前的无记录分钟单独成一个窗口
  if (firstIdx > 0) {
    result.push({
      startIdx: 0,
      endIdx: firstIdx,
      startTs: effectiveMinutes[0].ts,
      endTs: effectiveMinutes[firstIdx - 1].ts,
      active: null,
      isCurrent: nowIdx >= 0 && nowIdx < firstIdx,
      minutes: effectiveMinutes.slice(0, firstIdx),
    })
  }

/**
   * 从 start 开始向后扫描，查找连续 breakMinutes 休息的结束位置。
   *
   * @param start   扫描起始索引
   * @param maxScan 最大扫描长度（即 windowMinutes）
   * @returns       连续休息的结束索引（不包含边界）；若未找到则返回 -1
   *
   * 逻辑：
   * 1. 在 [start, start+maxScan) 范围内寻找连续 B 个休息分钟。
   * 2. 一旦找到，继续向后延伸，直到遇到非休息分钟为止。
   * 3. 这样可以把「工作窗口内开始的短暂休息 + 后面可能延续的连续休息」合并为一个休息 block。
   */
  function findBreakEnd(start: number, maxScan: number): number {
    let restStreak = 0
    let breakStart = -1
    for (let i = start; i < Math.min(start + maxScan, effectiveMinutes.length); i++) {
      if (isRest(effectiveMinutes[i])) {
        if (breakStart === -1) breakStart = i
        restStreak++
        if (restStreak >= B) {
          let end = i + 1
          while (end < effectiveMinutes.length && isRest(effectiveMinutes[end])) {
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

  // 主循环：从首个有记录的位置开始，逐段切分 block
  let s = firstIdx
  while (s < effectiveMinutes.length) {
    const breakEnd = findBreakEnd(s, W)

    if (breakEnd !== -1) {
      // 在窗口内找到了连续休息 → 切为休息 block
      const isCur = nowIdx >= s && nowIdx < breakEnd
      result.push({
        startIdx: s,
        endIdx: breakEnd,
        startTs: effectiveMinutes[s].ts,
        endTs: effectiveMinutes[breakEnd - 1].ts,
        active: false,
        isCurrent: isCur,
        minutes: effectiveMinutes.slice(s, breakEnd),
      })
      s = breakEnd
    } else {
      // 窗口内无足够连续休息 → 切为活跃 block，固定 windowMinutes 长度
      const end = Math.min(s + W, effectiveMinutes.length)
      const isCur = nowIdx >= s && nowIdx < end
      result.push({
        startIdx: s,
        endIdx: end,
        startTs: effectiveMinutes[s].ts,
        endTs: effectiveMinutes[end - 1]?.ts ?? effectiveMinutes[s].ts,
        active: true,
        isCurrent: isCur,
        minutes: effectiveMinutes.slice(s, end),
      })
      s = end
    }
  }

  return result
}

/**
 * 合并相邻的非当前休息 block。
 *
 * 目的：让 UI 列表更紧凑，避免一段长休息被切分成多个 45 分钟小段后显示得支离破碎。
 * 规则：只有「已完成」且「active=false」的相邻 block 才会合并；
 *       活跃 block 和「进行中」block 保持独立，不合并。
 */
export function mergeRestBlocks(blocks: TimeBlock[]): TimeBlock[] {
  if (blocks.length === 0) return []

  const result: TimeBlock[] = []
  let cur: TimeBlock | null = null

  for (const b of blocks) {
    if (!cur) {
      cur = { ...b, minutes: [...b.minutes] }
    } else if (!b.isCurrent && !cur.isCurrent && cur.active === false && b.active === false) {
      // 相邻的非当前休息 block → 合并
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
