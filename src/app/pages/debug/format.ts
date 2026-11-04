/**
 * 调试页的展示格式化：分钟、鼠标位移、鼠标槽。
 * 只做「把后端字段变成人能读的一行字」，不参与业务判断。
 */

/** Signal 分钟桶的 timestamp = 分钟结束时间（bucket_start + 60） */
export function formatMinute(ts: number): string {
  const date = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 鼠标总位移：>=1000px 折成 k，保留 1 位小数；NaN 显示占位符 */
export function formatDistance(px: number): string {
  if (!Number.isFinite(px)) return '—'
  if (px >= 1000) return `${(px / 1000).toFixed(1)}k`
  return String(Math.round(px))
}

/** 鼠标槽：mouse_seconds_json 里非 null 的秒数 / 60 */
export function mouseSlotsFilled(json: string | null): string {
  if (!json) return '—'
  try {
    const slots = JSON.parse(json) as Array<number | null>
    if (!Array.isArray(slots)) return '—'
    const filled = slots.filter((value) => value !== null && value !== undefined).length
    return `${filled}/60`
  } catch {
    return '—'
  }
}

/** snapshot 里是 Record<string, unknown>，取值前统一兜成有限数字 */
export function toNumber(value: unknown, fallback = 0): number {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}
