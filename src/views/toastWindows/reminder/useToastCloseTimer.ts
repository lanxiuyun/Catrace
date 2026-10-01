/**
 * Toast 卡片自动关闭计时：setTimeout + remainingMs 折算 + hover 暂停。
 * 从 ReminderToast.vue 抽出。进度条 CSS 动画靠 --toast-auto-hide-ms（取 totalMs）
 * 与 JS 计时解耦：hover 只停 JS 计时并折算剩余时间，划出后按剩余时长续跑，
 * 不重放 CSS 动画，两者始终同步。
 */
import type { Ref } from 'vue'
import { AUTO_HIDE_MS, type ToastItem } from './toastCard'

export interface ToastCloseTimerDeps {
  notifications: Ref<ToastItem[]>
  /** 计时到点回调（主视图：先 resolve 后端事件，再移除卡片） */
  onExpire: (item: ToastItem) => void
}

export function useToastCloseTimer({ notifications, onExpire }: ToastCloseTimerDeps) {
  function startTimer(item: ToastItem) {
    if (item.isHovered && !item.sticky) return
    stopTimer(item)
    item.lastStartAt = Date.now()
    // Keep original totalMs for progress UI. Only remainingMs shrinks across hover pauses.
    if (!(item.totalMs > 0)) item.totalMs = item.remainingMs
    item.closeTimer = setTimeout(() => {
      // 到点交给 onExpire：主视图必须把后端事件 resolve（否则刷新/水合时旧 toast 会复活）再移除卡片
      onExpire(item)
    }, item.remainingMs)
  }

  function stopTimer(item: ToastItem) {
    if (item.closeTimer) {
      const elapsed = Date.now() - item.lastStartAt
      item.remainingMs = Math.max(0, item.remainingMs - elapsed)
      clearTimeout(item.closeTimer)
      item.closeTimer = null
    }
  }

  function handleMouseEnter(item: ToastItem) {
    // 休息计时 / sticky / permission / 特殊日 卡片不依赖 hover 控制生命周期
    if (item.kind === 'rest-timer' || item.kind === 'special' || item.sticky) return
    // 只允许一张卡处于 hover 态：WebView 偶发漏 mouseleave 时，
    // 避免多张卡同时 isHovered，一次 leave 会清掉一整堆。
    for (const n of notifications.value) {
      if (n !== item && n.isHovered) {
        handleMouseLeave(n)
      }
    }
    item.isHovered = true
    stopTimer(item)
  }

  function handleMouseLeave(item: ToastItem) {
    if (item.kind === 'rest-timer' || item.kind === 'special' || item.sticky) return
    item.isHovered = false
    if (item.remainingMs > 0) {
      startTimer(item)
    } else if (item.kind !== 'update') {
      // hover 暂停把剩余时间拖到 0 的卡片，离开时不再立即删除：
      // 否则光标一碰（真实 mouseleave 或 Rust hover-exit 事件）整堆卡片连锁消失。
      // 改为重置完整自动隐藏时长，卡片仍在最后一次交互后按时自动消失。
      item.remainingMs = item.totalMs > 0 ? item.totalMs : AUTO_HIDE_MS
      item.totalMs = item.remainingMs
      startTimer(item)
    }
  }

  /** 卸载时停掉所有卡片的计时器 */
  function stopAll() {
    notifications.value.forEach(stopTimer)
  }

  return { startTimer, stopTimer, handleMouseEnter, handleMouseLeave, stopAll }
}
