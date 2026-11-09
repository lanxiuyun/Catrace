import { useEffect, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

let listeners: Array<(item: ToastItem) => void> = []

/** 轻量消息提示（替代 naive-ui 的 message），由 <Toaster /> 统一渲染。 */
export function showToast(text: string, kind: ToastKind = 'success'): void {
  const item: ToastItem = { id: Date.now() + Math.random(), text, kind }
  for (const listener of listeners) listener(item)
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const add = (item: ToastItem) => {
      setItems((previous) => [...previous, item])
      setTimeout(() => {
        setItems((previous) => previous.filter((entry) => entry.id !== item.id))
      }, 2600)
    }
    listeners.push(add)
    return () => {
      listeners = listeners.filter((listener) => listener !== add)
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div className="ct-toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`ct-toast is-${item.kind}`}>
          {item.text}
        </div>
      ))}
    </div>
  )
}
