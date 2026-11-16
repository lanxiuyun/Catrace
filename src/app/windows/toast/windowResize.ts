import { setToastContentSize } from '../../../api/tauri'
import { createFrameQueue, type ElementRef } from './toastState'

export function createToastWindowResize({ rootRef, stackRef, isAnimating, isEmpty }: {
  rootRef: ElementRef
  stackRef: ElementRef
  isAnimating: () => boolean
  isEmpty: () => boolean
}) {
  const cards = new Map<number, HTMLElement>()
  const frames = createFrameQueue()
  let observer: ResizeObserver | null = null
  let scheduled = false
  let running = false
  let requested = false
  let disposed = false
  let lastSizeKey = ''
  let recompositeQueued = false
  let generation = 0

  function forceRecomposite(root: HTMLElement) {
    if (recompositeQueued) return
    recompositeQueued = true
    frames.request(() => {
      recompositeQueued = false
      root.style.opacity = '0.999'
      frames.request(() => { root.style.opacity = '' })
    })
  }

  async function report() {
    if (disposed) return
    if (running) { requested = true; return }
    running = true
    try {
      do {
        requested = false
        const root = rootRef.current
        const stack = stackRef.current
        // Empty padding must not shrink the HWND into a thin strip while it is hiding.
        if (!root || !stack || isEmpty()) continue
        const width = Math.max(1, Math.ceil(root.scrollWidth))
        const height = Math.max(1, Math.ceil(stack.scrollHeight))
        const key = `${width}x${height}`
        if (isAnimating() && height <= Number(lastSizeKey.split('x')[1] || 0)) continue
        if (key === lastSizeKey) continue
        const token = generation
        try {
          await setToastContentSize(width, height)
          if (!disposed && token === generation) {
            lastSizeKey = key
            forceRecomposite(root)
          }
        } catch { /* A later measurement retries the size. */ }
      } while (requested && !disposed)
    } finally { running = false }
  }

  function scheduleWindowResize() {
    if (scheduled || disposed) return
    scheduled = true
    frames.request(() => {
      scheduled = false
      void report()
    })
  }

  function releaseCard(id: number) {
    const element = cards.get(id)
    if (element) observer?.unobserve(element)
    cards.delete(id)
  }

  return {
    setCardRef(element: HTMLElement | null, id: number) {
      const previous = cards.get(id)
      if (previous && previous !== element) observer?.unobserve(previous)
      if (element) { cards.set(id, element); observer?.observe(element) }
      else cards.delete(id)
    },
    releaseCard,
    scheduleWindowResize,
    attach() {
      if (disposed || observer || !stackRef.current) return
      observer = new ResizeObserver(() => { if (!isAnimating()) scheduleWindowResize() })
      observer.observe(stackRef.current)
      for (const card of cards.values()) observer.observe(card)
    },
    detach() {
      disposed = true
      ++generation
      observer?.disconnect()
      observer = null
      cards.clear()
      frames.dispose()
      if (rootRef.current) rootRef.current.style.opacity = ''
    },
    resetSizeKey() { ++generation; lastSizeKey = '' },
  }
}
