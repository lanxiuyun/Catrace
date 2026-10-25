/** 一分钟的行为状态；null = 该分钟没有记录。 */
export interface MinuteData {
  /** Unix 秒，表示该分钟的起点 */
  ts: number
  active: boolean | null
}
