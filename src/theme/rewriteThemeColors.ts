/**
 * 把插件源码里的裸 hex 改写成宿主语义 token。
 * 亮色 token 值沿用原色，所以亮色外观不变；暗色下自动跟主题。
 * 品牌固定色（国旗红/黄）不改写。
 */

const TOKEN_BY_HEX: Record<string, string> = {
  // 强调（紫）
  '#7c3aed': '--ct-accent',
  '#8b5cf6': '--ct-accent',
  '#6366f1': '--ct-accent',
  '#6d28d9': '--ct-accent-hover',
  '#5b21b6': '--ct-accent-hover',
  '#4c1d95': '--ct-accent-strong',
  '#4338ca': '--ct-accent-strong',
  '#3730a3': '--ct-accent-strong',
  '#312e81': '--ct-accent-strong',
  '#1e1b4b': '--ct-accent-strong',
  '#ede9fe': '--ct-accent-soft',
  '#ddd6fe': '--ct-accent-soft',
  '#e9d5ff': '--ct-accent-soft',
  '#e8e4f0': '--ct-accent-soft',
  '#ebe6f2': '--ct-accent-soft',
  '#f3e8ff': '--ct-accent-soft',
  '#f5f3ff': '--ct-accent-softer',
  '#faf8ff': '--ct-accent-softer',
  '#fafaff': '--ct-accent-softer',
  '#eef2ff': '--ct-accent-softer',
  '#c4b5fd': '--ct-accent-border',
  '#a78bfa': '--ct-accent-border',
  // 表面 / 背景 / 边框
  '#f7f5fa': '--ct-bg',
  '#f8fafc': '--ct-bg',
  '#fafafc': '--ct-bg',
  '#f7f7f8': '--ct-bg',
  '#f2f3f5': '--ct-bg',
  '#fafcff': '--ct-surface-2',
  '#f8f7fb': '--ct-surface-2',
  '#f1f5f9': '--ct-surface-2',
  '#f3f4f6': '--ct-surface-2',
  '#f4f4f5': '--ct-surface-2',
  '#e2e8f0': '--ct-border',
  '#e4e4e7': '--ct-border',
  '#e5e7eb': '--ct-border',
  '#d1d5db': '--ct-border',
  '#cbd5e1': '--ct-border',
  '#d4d4d8': '--ct-border',
  '#ececed': '--ct-border',
  '#e8eef7': '--ct-border',
  '#e8eef5': '--ct-border',
  '#d5f3f8': '--ct-cyan-soft',
  // 文本
  '#2e1065': '--ct-text',
  '#0f172a': '--ct-text',
  '#1e293b': '--ct-text',
  '#18181b': '--ct-text',
  '#24292f': '--ct-text',
  '#2a2b2e': '--ct-text',
  '#8b7aab': '--ct-text-muted',
  '#334155': '--ct-text-muted',
  '#475569': '--ct-text-muted',
  '#4b4d52': '--ct-text-muted',
  '#4b5563': '--ct-text-muted',
  '#6b5b8a': '--ct-text-muted',
  '#7c7caa': '--ct-text-muted',
  '#9c8db5': '--ct-text-subtle',
  '#94a3b8': '--ct-text-subtle',
  '#64748b': '--ct-text-subtle',
  '#6b7280': '--ct-text-subtle',
  '#9ca3af': '--ct-text-subtle',
  '#a1a1aa': '--ct-text-subtle',
  '#71717a': '--ct-text-subtle',
  // 状态
  '#059669': '--ct-success',
  '#10b981': '--ct-success',
  '#22c55e': '--ct-success',
  '#065f46': '--ct-success',
  '#047857': '--ct-success-strong',
  '#064e3b': '--ct-success-strong',
  '#6ee7b7': '--ct-success',
  '#d1fae5': '--ct-success-soft',
  '#dcfce7': '--ct-success-soft',
  '#ecfdf5': '--ct-success-soft',
  '#f0fdf4': '--ct-success-soft',
  '#a7f3d0': '--ct-success-soft',
  '#f59e0b': '--ct-warning',
  '#d97706': '--ct-warning',
  '#92400e': '--ct-warning',
  '#b45309': '--ct-warning-strong',
  '#78350f': '--ct-warning-strong',
  '#c2410c': '--ct-warning-strong',
  '#fffbeb': '--ct-warning-soft',
  '#fef3c7': '--ct-warning-soft',
  '#fde68a': '--ct-warning-soft',
  '#fff7ed': '--ct-warning-soft',
  '#fed7aa': '--ct-warning-soft',
  '#fcd34d': '--ct-warning-soft',
  '#fff7f0': '--ct-warning-soft',
  '#fbbf24': '--ct-warning',
  '#ef4444': '--ct-error',
  '#dc2626': '--ct-error',
  '#b91c1c': '--ct-error-strong',
  '#991b1b': '--ct-error-strong',
  '#7f1d1d': '--ct-error-strong',
  '#fee2e2': '--ct-error-soft',
  '#fef2f2': '--ct-error-soft',
  '#fecaca': '--ct-error-soft',
  '#fff5f5': '--ct-error-soft',
  // 蓝 / 青
  '#3b82f6': '--ct-info',
  '#2563eb': '--ct-info',
  '#0052d9': '--ct-info',
  '#0043b8': '--ct-info',
  '#003ca8': '--ct-info',
  '#4b70a6': '--ct-info',
  '#60a5fa': '--ct-info',
  '#dbeafe': '--ct-info-soft',
  '#eff6ff': '--ct-info-soft',
  '#e8f2ff': '--ct-info-soft',
  '#e0ecff': '--ct-info-soft',
  '#f0f7ff': '--ct-info-soft',
  '#06b6d4': '--ct-cyan',
  '#22d3ee': '--ct-cyan',
  '#14b8a6': '--ct-cyan',
  '#34d399': '--ct-cyan',
  '#0e7490': '--ct-cyan',
  '#cffafe': '--ct-cyan-soft',
  '#ecfeff': '--ct-cyan-soft',
  '#a5f3fc': '--ct-cyan-soft',
}

const BRAND_SKIP = new Set(['#de2910', '#ffde00'])
const HEX6 = /#[0-9a-fA-F]{6}(?![0-9a-fA-F])/g
const WHITE = /#(?:fff|ffffff)\b/gi

function tokenForHex(hex: string): string | null {
  const key = hex.toLowerCase()
  if (BRAND_SKIP.has(key)) return null
  return TOKEN_BY_HEX[key] ?? null
}

/**
 * 改写插件源码中的裸色。#fff/#ffffff：
 * - `color:`（文字）→ --ct-on-accent（两套主题都是白）
 * - 其余（背景/边框/naive --n-color）→ --ct-surface
 */
export function rewriteThemeColors(source: string): string {
  let out = source.replace(HEX6, (m) => {
    const key = m.toLowerCase()
    if (key === '#ffffff') return m
    const token = tokenForHex(m)
    return token ? `var(${token})` : m
  })

  out = out.replace(/([a-z-]+)\s*:\s*#(?:fff|ffffff)\b/gi, (_full, prop: string) => {
    const p = prop.toLowerCase()
    if (p === 'color') return `${prop}: var(--ct-on-accent)`
    return `${prop}: var(--ct-surface)`
  })

  // 简写里残留的白，如 `border: 1px solid #fff`
  out = out.replace(WHITE, 'var(--ct-surface)')
  return out
}
