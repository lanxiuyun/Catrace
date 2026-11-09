import { prepareWindowActivation, setWindowActiveMode } from '../../../api/tauri'
import type { ElementRef } from './toastState'

export const WINDOW_LABEL = 'reminder-toast'

export function createToastWindowActivation(rootRef: ElementRef) {
  let activated = false
  let prepared = false
  let generation = 0

  async function activate() {
    if (activated) return
    activated = true
    const token = generation
    try { await setWindowActiveMode(WINDOW_LABEL, true) }
    catch { if (token === generation) activated = false }
  }

  async function prepare() {
    if (prepared) return
    prepared = true
    const token = generation
    try { await prepareWindowActivation(WINDOW_LABEL) }
    catch { if (token === generation) prepared = false }
  }

  function withinRoot(target: EventTarget | null) {
    return target instanceof Element && !!rootRef.current?.contains(target)
  }

  return {
    handleToastPointerOver(event: PointerEvent) {
      // Hover only clears NOACTIVATE; it must never steal foreground focus.
      if (withinRoot(event.target)) void prepare()
    },
    handleToastPointerDown(event: PointerEvent) {
      if (withinRoot(event.target)) void activate()
    },
    resetActivationState() {
      ++generation
      activated = false
      prepared = false
    },
    async deactivateWindow() {
      try { await setWindowActiveMode(WINDOW_LABEL, false) }
      catch { /* The native hide path also restores NOACTIVATE. */ }
    },
  }
}
