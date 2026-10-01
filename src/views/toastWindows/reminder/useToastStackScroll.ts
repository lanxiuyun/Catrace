/**
 * 卡片栈滚动贴底跟随：新卡到达只在「本来就贴底」时把视图拽到底部，
 * 用户向上翻旧卡后不再打扰。从 ReminderToast.vue 抽出。
 */
import type { Ref } from 'vue'

export interface ToastStackScrollDeps {
  stackRef: Ref<HTMLElement | null>
  /** 当前卡片数（0 或 1 张时保持 shadow padding 可见，不滚） */
  cardCount: () => number
}

export function useToastStackScroll({ stackRef, cardCount }: ToastStackScrollDeps) {
  /** 卡片栈是否贴底。用户向上翻旧卡后置 false，新卡到达不再把视图拽回底部。 */
  let stackPinnedToBottom = true

  /** 判定「算贴底」的容差（CSS px）：留出亚像素与滚轮惯性的余量。 */
  const STACK_BOTTOM_TOLERANCE_PX = 24

  /** 用户滚动卡片栈时记录是否贴底；窗口 resize 引起的 clamp 也会走到这里，结论一致。 */
  function handleStackScroll() {
    const stack = stackRef.value
    if (!stack) return
    const distanceToBottom = stack.scrollHeight - stack.scrollTop - stack.clientHeight
    stackPinnedToBottom = distanceToBottom <= STACK_BOTTOM_TOLERANCE_PX
  }

  function scrollStackToBottom() {
    const stack = stackRef.value
    if (!stack) return

    // Keep the shadow padding visible when only one card is present.
    if (cardCount() <= 1) {
      stack.scrollTop = 0
      stackPinnedToBottom = true
      return
    }
    // 卡片堆超过窗高时新卡落在可视区外：只有本来就贴底才跟着滚，
    // 否则会把正在翻旧卡的人拽走。
    if (!stackPinnedToBottom) return
    stack.scrollTop = stack.scrollHeight
  }

  /** 空栈关窗后复位：下一次弹出从「贴底」重新开始 */
  function pinToBottom() {
    stackPinnedToBottom = true
  }

  return { handleStackScroll, scrollStackToBottom, pinToBottom }
}
