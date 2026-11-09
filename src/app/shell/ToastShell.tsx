import type { ReactNode } from 'react'
import './shell.css'

/**
 * 提醒 / Toast 窗口的外壳：没有导航栏，只负责把页面铺满视口。
 * 具体定位（右下角 Toast、居中弹窗、全屏提醒）由页面自身 CSS 决定。
 */
export function ToastShell({ children }: { children: ReactNode }) {
  return <div className="toast-window-shell">{children}</div>
}
