import { AUTO_HIDE_MS, type ToastItem } from './toastCard'
import type { ToastItems } from './toastState'

/** Timeout and CSS progress share totalMs; hover pauses without replaying the CSS animation. */
export function createToastCloseTimer(items: ToastItems, onExpire: (item: ToastItem) => void) {
  function startTimer(item: ToastItem) {
    if (item.leaving || (item.isHovered && !item.sticky)) return
    stopTimer(item)
    item.lastStartAt = Date.now()
    if (!(item.totalMs > 0)) item.totalMs = item.remainingMs
    item.closeTimer = setTimeout(() => onExpire(item), item.remainingMs)
  }

  function stopTimer(item: ToastItem) {
    if (item.closeTimer !== null) {
      item.remainingMs = Math.max(0, item.remainingMs - (Date.now() - item.lastStartAt))
      clearTimeout(item.closeTimer)
      item.closeTimer = null
    }
  }

  function handleMouseEnter(item: ToastItem) {
    if (item.leaving || item.kind === 'rest-timer' || item.kind === 'special' || item.sticky) return
    for (const other of items.current) {
      if (other !== item && other.isHovered) handleMouseLeave(other)
    }
    item.isHovered = true
    stopTimer(item)
    items.changed()
  }

  function handleMouseLeave(item: ToastItem) {
    if (item.leaving || item.kind === 'rest-timer' || item.kind === 'special' || item.sticky) return
    item.isHovered = false
    if (item.remainingMs > 0) startTimer(item)
    else if (item.kind !== 'update') {
      item.remainingMs = item.totalMs > 0 ? item.totalMs : AUTO_HIDE_MS
      item.totalMs = item.remainingMs
      startTimer(item)
    }
    items.changed()
  }

  function stopAll() {
    for (const item of items.current) {
      stopTimer(item)
      if (item.endTimer) clearTimeout(item.endTimer)
      item.endTimer = null
    }
  }

  return { startTimer, stopTimer, handleMouseEnter, handleMouseLeave, stopAll }
}
