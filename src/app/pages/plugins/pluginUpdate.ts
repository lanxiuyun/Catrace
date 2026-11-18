/**
 * 插件仓库版本比较。
 *
 * 插件版本是点分数字（`26.11.12`），由插件作者按发布递增。安装是固定 commit 的快照，
 * 所以「有没有更新」只能拿仓库 HEAD 目录里的版本号和本机清单版本比：仓库更高才提示，
 * 本机更高（本地改过 / 回退过）或相同都不提示。
 */

/** 逐段解析成数字；`v` 前缀与 `-rc1` / `+build` 之类后缀不参与比较。 */
const versionSegments = (version: string): number[] => version
  .trim()
  .replace(/^v/i, '')
  // 预发布 / 构建元数据不参与比较：截到第一个 - 或 +，只比点分数字主版本。
  .split(/[+-]/)[0]
  .split('.')
  .map((segment) => {
    const digits = /^\d+/.exec(segment)
    return digits ? Number(digits[0]) : 0
  })

/** `next` 比 `current` 新返回正数，相同返回 0，更旧返回负数；段数不同时缺省补 0。 */
export function comparePluginVersions(next: string, current: string): number {
  const nextSegments = versionSegments(next)
  const currentSegments = versionSegments(current)
  for (let index = 0; index < Math.max(nextSegments.length, currentSegments.length); index++) {
    const delta = (nextSegments[index] ?? 0) - (currentSegments[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/**
 * 仓库版本比本机安装版本新时返回该版本号，否则返回空串。列表卡和详情页都用它
 * 决定是否显示「可更新 vX」标签；版本缺失（旧安装 / 清单损坏）时保持安静。
 */
export function availablePluginUpdate(
  installedVersion?: string | null,
  repositoryVersion?: string | null,
): string {
  const installed = installedVersion?.trim()
  const repository = repositoryVersion?.trim()
  if (!installed || !repository) return ''
  return comparePluginVersions(repository, installed) > 0 ? repository : ''
}
