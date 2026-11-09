import type { ReactNode } from 'react'

export function SettingRow({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: ReactNode
}) {
  return (
    <div className="ct-setting-row">
      <div className="ct-setting-copy">
        <div className="ct-setting-title">{title}</div>
        {desc && <div className="ct-setting-desc">{desc}</div>}
      </div>
      <div className="ct-setting-control">{children}</div>
    </div>
  )
}
