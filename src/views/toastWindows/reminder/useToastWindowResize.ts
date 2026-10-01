/**
 * Toast 小窗尺寸上报：按卡片栈内容实测高度钉原生小窗。
 * 从 ReminderToast.vue 抽出：ResizeObserver 接线（stack + 每张卡片）、
 * reportWindowSize / scheduleWindowResize / forceRecomposite。
 */
import { nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { setToastContentSize } from '../../../api/tauri'

export interface ToastWindowResizeDeps {
  rootRef: Ref<HTMLElement | null>
  stackRef: Ref<HTMLElement | null>
  /** 卡片离场/进入动画期间禁止收缩窗口，避免截断 */
  isAnimating: Ref<boolean>
  /** 卡片栈是否为空：空栈不上报（窗口即将关闭） */
  isEmpty: () => boolean
}

export function useToastWindowResize({
  rootRef,
  stackRef,
  isAnimating,
  isEmpty,
}: ToastWindowResizeDeps) {
  const cardRefs = ref<Map<number, HTMLElement>>(new Map())
  let resizeObserver: ResizeObserver | null = null
  let resizeScheduled = false
  let lastSizeKey = ''
  let recompositeQueued = false

  /** HWND 变几何后 WebView2 不保证立刻出新帧：页面静止时合成器空闲，旧帧仍按
   *  旧窗口矩形摆放，resize 后可能残留一帧错位。翻转一次 opacity 强制重新合成。 */
  function forceRecomposite(root: HTMLElement) {
    if (recompositeQueued) return
    recompositeQueued = true
    requestAnimationFrame(() => {
      recompositeQueued = false
      root.style.opacity = '0.999'
      requestAnimationFrame(() => {
        root.style.opacity = ''
      })
    })
  }

  /** 按内容实测高度钉原生小窗。stack 四边 16px 出血已计入 scrollHeight。
   *  高度必须等于内容：写死下限会让窗口比内容高，卡片（贴窗顶）与任务栏之间
   *  留出一条没人绘制的透明带——旧版是 body 深色底（看起来像黑边框）。 */
  async function reportWindowSize() {
    const root = rootRef.value
    const stack = stackRef.value
    if (!root || !stack) return
    // 空栈：窗口即将关闭。此时 stack 只剩 1rem padding，上报会把窗口缩成一条细窗，
    // 还会和 Rust 隐藏时的 reset_toast_content_size() 抢时序，下次弹出先闪一条细窗。
    if (isEmpty()) return
    const width = Math.max(1, Math.ceil(root.scrollWidth))
    const height = Math.max(1, Math.ceil(stack.scrollHeight))
    const key = `${width}x${height}`

    // 卡片离场/进入动画期间禁止收缩窗口，避免 DOM 里卡片还没移除但窗口先变小导致截断
    if (isAnimating.value) {
      const prevH = Number.parseFloat(lastSizeKey.split('x')[1] || '0')
      if (height <= prevH) return
    }

    if (key === lastSizeKey) return
    lastSizeKey = key
    try {
      await setToastContentSize(width, height)
      forceRecomposite(root)
    } catch {
      // ignore
    }
  }

  function scheduleWindowResize() {
    if (resizeScheduled) return
    resizeScheduled = true
    nextTick(() => {
      requestAnimationFrame(() => {
        resizeScheduled = false
        void reportWindowSize()
      })
    })
  }

  function setCardRef(el: unknown, id: number) {
    const prev = cardRefs.value.get(id)
    if (prev && prev !== el) {
      resizeObserver?.unobserve(prev)
    }
    if (el instanceof HTMLElement) {
      cardRefs.value.set(id, el)
      resizeObserver?.observe(el)
    } else {
      cardRefs.value.delete(id)
    }
  }

  /** 卡片数据移除后解除观察（主视图 doRemoveCard 调用） */
  function releaseCard(id: number) {
    const el = cardRefs.value.get(id)
    if (el) resizeObserver?.unobserve(el)
    cardRefs.value.delete(id)
  }

  /** 建观察器并接上 stack 与已有卡片（onMounted 在 nextTick 后调用） */
  function attach() {
    const stack = stackRef.value
    if (!stack) return
    resizeObserver = new ResizeObserver(() => {
      if (!isAnimating.value) {
        scheduleWindowResize()
      }
    })
    resizeObserver.observe(stack)
    for (const el of cardRefs.value.values()) {
      resizeObserver.observe(el)
    }
  }

  function detach() {
    resizeObserver?.disconnect()
    resizeObserver = null
  }

  /** 关窗路径重置尺寸缓存，下次弹出重新上报 */
  function resetSizeKey() {
    lastSizeKey = ''
  }

  return { setCardRef, releaseCard, scheduleWindowResize, attach, detach, resetSizeKey }
}
