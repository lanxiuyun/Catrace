import type { ElementRef } from './toastState'

export function createToastStackScroll(stackRef: ElementRef, cardCount: () => number) {
  let pinnedToBottom = true
  const tolerance = 24

  function handleStackScroll() {
    const stack = stackRef.current
    if (!stack) return
    pinnedToBottom = stack.scrollHeight - stack.scrollTop - stack.clientHeight <= tolerance
  }

  function scrollStackToBottom() {
    const stack = stackRef.current
    if (!stack) return
    if (cardCount() <= 1) {
      stack.scrollTop = 0
      pinnedToBottom = true
    } else if (pinnedToBottom) stack.scrollTop = stack.scrollHeight
  }

  return {
    handleStackScroll,
    scrollStackToBottom,
    pinToBottom() { pinnedToBottom = true },
  }
}
