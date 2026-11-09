import { useEffect, useRef, type CSSProperties } from 'react'
import type { Component } from 'vue'
import { createVueIsland } from './vueRuntime'

type VueIslandProps = {
  /** 未迁移的 Vue 页面组件（从 src/views 直接 import）。 */
  component: Component
  componentProps?: Record<string, unknown>
  className?: string
  style?: CSSProperties
}

/**
 * 把 Vue 页面当成"岛"挂进 React 路由。
 * 迁移期专用：每迁完一个页面，就把对应路由换成本地 React 组件。
 */
export function VueIsland({ component, componentProps, className, style }: VueIslandProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const app = createVueIsland(component, componentProps)
    app.mount(host)
    return () => {
      app.unmount()
    }
  }, [component, componentProps])

  return <div ref={hostRef} className={className} style={style} />
}
