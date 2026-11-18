import type { ReactNode } from 'react'
import { Card } from '@heroui/react'
import './SettingsCard.css'

/** 设置分组：标题、说明在卡片外，容器直接使用 HeroUI Card 默认 padding。 */
export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="ct-config-section">
      <div className="ct-config-section-head">
        <h3 className="ct-config-section-title">{title}</h3>
        {description ? <p className="ct-config-section-desc">{description}</p> : null}
      </div>
      <Card className="ct-config-card">{children}</Card>
    </section>
  )
}

/** 每行自行提供上下留白，首行和后续行使用完全相同的规则。 */
export function SettingsCardRow({
  title,
  description,
  control,
  controlClassName,
  stack = false,
  children,
}: {
  title: string
  description?: string
  control: ReactNode
  controlClassName?: string
  stack?: boolean
  children?: ReactNode
}) {
  return (
    <div className={stack ? 'ct-config-card-row is-stack' : 'ct-config-card-row'}>
      <div className="ct-config-card-copy">
        <span className="ct-config-card-title">{title}</span>
        {description ? <span className="ct-config-card-desc">{description}</span> : null}
      </div>
      <div className={controlClassName ? `ct-config-card-control ${controlClassName}` : 'ct-config-card-control'}>
        {control}
      </div>
      {children ? <div className="ct-config-card-row-body">{children}</div> : null}
    </div>
  )
}
