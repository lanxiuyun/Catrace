/**
 * Toast 窗口激活：NOACTIVATE 小窗的「指针预激活 + 点击真激活」两段式。
 * 从 ReminderToast.vue 抽出。
 */
import type { Ref } from 'vue'
import { prepareWindowActivation, setWindowActiveMode } from '../../../api/tauri'

export const WINDOW_LABEL = 'reminder-toast'

export interface ToastWindowActivationDeps {
  rootRef: Ref<HTMLElement | null>
}

export function useToastWindowActivation({ rootRef }: ToastWindowActivationDeps) {
  let toastActivated = false
  /** pointerover 已做过预激活（清 NOACTIVATE）；真正抢焦点推迟到 pointerdown */
  let activationPrepared = false

  async function activateToastWindow() {
    if (toastActivated) return
    toastActivated = true
    try {
      await setWindowActiveMode(WINDOW_LABEL, true)
    } catch {
      toastActivated = false
    }
  }

  /** 指针进入内容区：只移除 NOACTIVATE，让随后的首次点击能原生激活；
   * 不能在这里抢前台焦点，否则 hover 就会打断用户正在输入的应用。 */
  async function prepareToastActivation() {
    if (activationPrepared) return
    activationPrepared = true
    try {
      await prepareWindowActivation(WINDOW_LABEL)
    } catch {
      activationPrepared = false
    }
  }

  function withinToastRoot(target: EventTarget | null): target is Element {
    return target instanceof Element && !!rootRef.value?.contains(target)
  }

  function handleToastPointerOver(event: PointerEvent) {
    if (!withinToastRoot(event.target)) return
    void prepareToastActivation()
  }

  function handleToastPointerDown(event: PointerEvent) {
    if (!withinToastRoot(event.target)) return
    void activateToastWindow()
  }

  /** 关窗路径复位激活状态，下次弹出重新走两段式激活 */
  function resetActivationState() {
    toastActivated = false
    activationPrepared = false
  }

  /** 关窗时撤掉可激活模式；失败不挡关窗（hide 路径会再套 NOACTIVATE） */
  async function deactivateWindow() {
    try {
      await setWindowActiveMode(WINDOW_LABEL, false)
    } catch {
      // hide 路径会再套 NOACTIVATE；失败不挡关窗
    }
  }

  return {
    handleToastPointerOver,
    handleToastPointerDown,
    resetActivationState,
    deactivateWindow,
  }
}
