import type { ReactNode } from 'react'

/**
 * 插件设置行：左文案 + 右控件，和系统设置页的行是同一套语言。
 * stack = 标签在上、控件在下占满一行（输入框、文本域、背景图）。
 */
export function PluginSettingRow({
  title,
  description,
  control,
  controlClassName,
  stack = false,
}: {
  title: string
  description?: string
  control: ReactNode
  controlClassName?: string
  stack?: boolean
}) {
  return (
    <div className={stack ? 'ct-plugin-row is-stack' : 'ct-plugin-row'}>
      <div className="ct-plugin-row-copy">
        <span className="ct-plugin-row-title">{title}</span>
        {description ? <span className="ct-plugin-row-desc">{description}</span> : null}
      </div>
      <div
        className={
          controlClassName ? `ct-plugin-row-control ${controlClassName}` : 'ct-plugin-row-control'
        }
      >
        {control}
      </div>
    </div>
  )
}
