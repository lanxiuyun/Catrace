import { createStore } from 'zustand/vanilla'
import type { ToastItem } from './toastCard'

/** Stable item objects keep timeout/action identity; each edit publishes a fresh array to React. */
export interface ToastItems {
  current: ToastItem[]
  changed: () => void
}

export function createToastState() {
  const store = createStore<{ notifications: ToastItem[]; showDebug: boolean; notice: string }>(() => ({
    notifications: [],
    showDebug: false,
    notice: '',
  }))
  const items: ToastItems = {
    get current() { return store.getState().notifications },
    set current(notifications) { store.setState({ notifications }) },
    changed() { store.setState({ notifications: [...store.getState().notifications] }) },
  }
  return { store, items }
}

export interface ElementRef {
  current: HTMLElement | null
}

export type Translate = (key: string, params?: Record<string, string | number>) => string

/** React commits before the animation frame; measurements never run against pre-commit markup. */
export function createFrameQueue() {
  let disposed = false
  const frames = new Set<number>()
  return {
    request(callback: () => void) {
      if (disposed) return
      const frame = requestAnimationFrame(() => {
        frames.delete(frame)
        if (!disposed) callback()
      })
      frames.add(frame)
    },
    dispose() {
      disposed = true
      for (const frame of frames) cancelAnimationFrame(frame)
      frames.clear()
    },
  }
}
