import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * 设置卡外壳：图标块 + 组名（组名就是这张卡的标题），内容由调用方给。
 * 卡片外观在 settings.css 的 `.ct-settings-card` 里，这里只统一头部结构，
 * 免得五张卡各写一遍 label。
 */
export function SettingsCard({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className="ct-settings-card">
      <div className="ct-settings-card-head">
        <span className="ct-settings-card-icon" aria-hidden="true">
          <Icon size={13} strokeWidth={2.1} />
        </span>
        <h2 className="ct-settings-card-label">{label}</h2>
      </div>
      {children}
    </div>
  )
}
