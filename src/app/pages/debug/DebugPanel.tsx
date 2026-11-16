import { useId, type ReactNode } from 'react'

/**
 * 调试页面板外壳：标题 + 右侧一行元信息 + 内容。
 *
 * 面板是「平铺表面」：细边 + 圆角，不投阴影——阴影表达高度，只留给真正浮起的表面。
 * 宽面板一旦加上卡片投影，软影会填满 1rem 的卡间距，看上去像底下又垫了一层。
 */
export function DebugPanel({
  title,
  meta,
  children,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section className="ct-debug-panel" aria-labelledby={titleId}>
      <header className="ct-debug-panel-head">
        <h2 className="ct-debug-panel-title" id={titleId}>
          {title}
        </h2>
        {meta ? <div className="ct-debug-panel-meta">{meta}</div> : null}
      </header>
      {children}
    </section>
  )
}

/** 面板标题右侧的小事实：标签 + 值（如「保留 24h」） */
export function DebugMetaItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="ct-debug-meta-item">
      <span className="ct-debug-meta-label">{label}</span>
      <span className="ct-debug-meta-value">{value}</span>
    </span>
  )
}
