import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from 'react'
import { Card, Separator } from '@heroui/react'

/** 条件渲染常用 <></> 包一组行；Children.toArray 不会展开 Fragment，先摊平再加分隔线。 */
function flattenRows(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap(child =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenRows(child.props.children)
      : [child],
  )
}

/**
 * 设置分组：分组标题在卡片外（字号/字重抄 agent-notify 设置页），卡片直接用 HeroUI Card 默认外观。
 * 行与行之间用 HeroUI Separator，卡片本身不覆写任何样式。
 * elementType="hr"：React Aria 的 Separator 默认元素是 <hr>，装饰态下 HeroUI 默认渲染 <div> 会在 dev 里
 * 每次渲染都警告 "Expected <hr>, got <div>"；显式给 hr 后既保留 aria-hidden，也不再刷控制台。
 */
export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  const rows = flattenRows(children)
  const content: ReactNode[] = []
  rows.forEach((row, index) => {
    if (index > 0) {
      content.push(<Separator key={`separator-${index}`} elementType="hr" isDecorative />)
    }
    // Children.toArray 给每层 Fragment 的子节点都会从 .0 重新编号；摊平后同层 key 会撞车，
    // 这里按最终顺序重新发 key（dev 下会报 "two children with the same key"）。
    content.push(isValidElement(row) ? cloneElement(row, { key: `row-${index}` }) : row)
  })

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[0.8125rem] font-bold tracking-[0.02rem]">{title}</h3>
      <Card>{content}</Card>
    </section>
  )
}

/** 设置行：标题在上、说明在标题下方，右侧控件；字号/行高抄 agent-notify 设置页 .event-title / .event-desc。
 *  行高取整到 18px（1.35 × 13px = 17.55px 会让行高带小数）：125% 缩放下 1px 分割线按设备像素取整，
 *  小数位不同的两条线会一条 1px、一条 2px，取整后落点同相就不会再粗细不一。 */
export function SettingsCardRow({
  title,
  description,
  control,
  stack = false,
  children,
}: {
  title: string
  description?: string
  control: ReactNode
  stack?: boolean
  children?: ReactNode
}) {
  return (
    <div className={stack ? 'flex flex-col gap-2' : 'flex flex-wrap items-center justify-between gap-3'}>
      <div className="flex min-w-0 flex-col gap-[0.1875rem]">
        <span className="text-[0.8125rem] leading-[18px] text-foreground">{title}</span>
        {description ? <span className="text-xs leading-[1.5] text-muted">{description}</span> : null}
      </div>
      <div className={stack ? 'flex w-full items-center gap-2' : 'flex shrink-0 items-center gap-2'}>
        {control}
      </div>
      {children ? <div className="w-full min-w-0">{children}</div> : null}
    </div>
  )
}
