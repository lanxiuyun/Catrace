import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  getReminderData, getToastDebugMode, snoozeReminder, skipReminder, closeReminderWindow,
  dismissRestTimer, checkAppUpdate, installAppUpdate, triggerNotificationAction,
} from '../../../api/tauri'
import { loadExternalPlugins } from '../../../plugins/loadExternalPlugins'
import { usePluginRegistry } from '../../../stores/pluginRegistry'
import { clearPluginHostCardCache } from '../../../components/pluginHostCardCache'
import type { EventAction } from '../../../types/event'
import { resolveAutoHideMs, type AddNotificationPayload, type ToastItem, type ToastKind } from './toastCard'
import { createToastState, createFrameQueue, type ElementRef, type Translate } from './toastState'
import { createToastCloseTimer } from './closeTimer'
import { createToastStackScroll } from './stackScroll'
import { createToastWindowActivation, WINDOW_LABEL } from './windowActivation'
import { createToastWindowResize } from './windowResize'
import { createRestTimerCard } from './restTimer'
import { createToastBusEvents } from './busEvents'

const LEAVE_ANIMATION_MS = 250
const BODY_ACTION: EventAction = { id: 'launch', label: '' }

export function createToastController(rootRef: ElementRef, stackRef: ElementRef, t: Translate) {
  const { store, items } = createToastState()
  const frames = createFrameQueue()
  const removals = new Map<number, ReturnType<typeof setTimeout>>()
  const unlisteners = new Set<UnlistenFn>()
  let disposed = false
  let idCounter = 0
  let closingGeneration = 0
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  const nextId = () => ++idCounter
  const isAlive = (item: ToastItem) => !disposed && items.current.includes(item)
  const timers = createToastCloseTimer(items, (item) => {
    if (!isAlive(item)) return
    bus.markEventResolved(item.eventId)
    removeNotification(item.id, true)
  })
  const resize = createToastWindowResize({
    rootRef, stackRef, isAnimating: () => removals.size > 0, isEmpty: () => !items.current.length,
  })
  const scroll = createToastStackScroll(stackRef, () => items.current.length)
  const activation = createToastWindowActivation(rootRef)
  const bus = createToastBusEvents({
    items, updateRestTimer: (payload) => restTimer.updateRestTimer(payload),
    startTimer: timers.startTimer, stopTimer: timers.stopTimer,
    addNotification, removeNotification, scheduleWindowResize: resize.scheduleWindowResize,
  })
  const restTimer = createRestTimerCard({
    items, nextId, t, scheduleWindowResize: resize.scheduleWindowResize, removeNotification,
    markEventResolved: bus.markEventResolved, markEventSeen: bus.markEventSeen,
  })

  function addNotification(payload: AddNotificationPayload) {
    if (disposed) return
    ++closingGeneration
    const isSdkSticky = payload.kind === 'sdk' && !!payload.sticky
    const isPluginSticky = !!payload.pluginId && !!payload.sticky
    const special = payload.kind === 'special'
    const sticky = payload.kind === 'update' || isSdkSticky || isPluginSticky || special
    const autoHideMs = sticky ? 0 : (payload.autoHideMs ?? resolveAutoHideMs(payload.busEvent, false))
    const item: ToastItem = {
      id: nextId(), kind: payload.kind, title: payload.title || '', body: payload.body || '',
      boundary: payload.boundary ?? 0, visible: false, isHovered: false,
      remainingMs: autoHideMs, closeTimer: null, lastStartAt: 0, totalMs: autoHideMs,
      version: payload.version || '', updateBody: payload.updateBody || '', showUpdateBody: false,
      updateInstalling: false, downloadProgress: 0, downloadTotal: 0, downloadReceived: 0,
      sticky: isSdkSticky || isPluginSticky || special, eventId: payload.eventId,
      dedupeKey: payload.dedupeKey, toastStyle: payload.toastStyle, level: payload.level,
      sdkActions: payload.sdkActions, sdkProgress: payload.sdkProgress ?? null,
      busEvent: payload.busEvent, pluginId: payload.pluginId, uiUrl: payload.uiUrl,
      specialTag: payload.tag, specialIcon: payload.icon, specialCategory: payload.category,
      appName: payload.appName, iconUrl: payload.iconUrl,
      notificationActions: payload.notificationActions, bodyClickable: payload.bodyClickable,
    }
    items.current = [...items.current, item]
    frames.request(() => {
      if (isAlive(item) && !item.leaving) { item.visible = true; items.changed() }
      resize.scheduleWindowResize()
      scroll.scrollStackToBottom()
    })
    if (!sticky) timers.startTimer(item)
  }

  function doRemoveCard(id: number) {
    if (disposed) return
    removals.delete(id)
    resize.releaseCard(id)
    items.current = items.current.filter((item) => item.id !== id)
    resize.scheduleWindowResize()
    if (!items.current.length) {
      scroll.pinToBottom()
      void closeWindow()
    }
  }

  function removeNotification(id: number, animate: boolean) {
    const item = items.current.find((candidate) => candidate.id === id)
    if (disposed || !item || item.leaving) return
    timers.stopTimer(item)
    if (item.endTimer) { clearTimeout(item.endTimer); item.endTimer = null }
    if (item.kind === 'rest-timer') restTimer.stopRestPoll()
    if (!animate) { doRemoveCard(id); return }
    // Keep the original class-only exit. Fixed-position FLIP freezes transparent WebView2.
    item.leaving = true
    removals.set(id, setTimeout(() => doRemoveCard(id), LEAVE_ANIMATION_MS))
    items.changed()
  }

  async function closeWindow() {
    const generation = ++closingGeneration
    resize.resetSizeKey()
    activation.resetActivationState()
    await activation.deactivateWindow()
    if (disposed || generation !== closingGeneration || items.current.length) return
    try { await closeReminderWindow(WINDOW_LABEL) }
    catch {
      if (disposed || generation !== closingGeneration || items.current.length) return
      try { await getCurrentWebviewWindow().close() } catch { /* Native window already gone. */ }
    }
  }

  async function handleSnooze(item: ToastItem, minutes: number) {
    timers.stopTimer(item)
    try { await snoozeReminder(minutes) } catch { /* Still close the visible reminder. */ }
    if (!isAlive(item)) return
    bus.markEventResolved(item.eventId, 'snooze')
    removeNotification(item.id, true)
  }

  async function handleSkip(item: ToastItem) {
    timers.stopTimer(item)
    try { await skipReminder(item.boundary) } catch { /* Still close the visible reminder. */ }
    if (!isAlive(item)) return
    bus.markEventResolved(item.eventId, 'skip')
    removeNotification(item.id, true)
  }

  async function handleClose(item: ToastItem) {
    if (item.kind === 'rest-timer') {
      try { await dismissRestTimer() } catch { /* Bus resolve remains the UI dismissal path. */ }
    }
    if (!isAlive(item)) return
    bus.markEventResolved(item.eventId)
    removeNotification(item.id, true)
  }

  function toggleUpdateDetails(item: ToastItem) {
    item.showUpdateBody = !item.showUpdateBody
    items.changed()
    resize.scheduleWindowResize()
  }

  function handleSdkAction(item: ToastItem, actionId: string) {
    bus.markEventResolved(item.eventId, actionId)
    removeNotification(item.id, true)
  }

  function handlePluginAction(item: ToastItem, actionId: string) {
    console.info('[sidecar-action] toast action', {
      notificationId: item.id, eventId: item.eventId, pluginId: item.pluginId, actionId,
      sticky: !!item.sticky, leaving: !!item.leaving, dedupeKey: item.dedupeKey, t: Date.now(),
    })
    // Bus owns removal; sticky actions can roundtrip and upsert the same mounted card.
    bus.markEventResolved(item.eventId, actionId)
  }

  async function handleUpdateInstall(item: ToastItem, source?: string) {
    if (item.updateInstalling) return
    item.updateInstalling = true
    items.changed()
    try {
      const update = await checkAppUpdate({ timeout: 10000, source })
      if (!isAlive(item)) return
      if (!update) { item.body = t('settings.messages.noUpdateFound'); return }
      await installAppUpdate(update, source, (event) => {
        if (!isAlive(item)) return
        switch (event.event) {
          case 'Started':
            item.downloadTotal = event.data.contentLength || 0
            item.downloadReceived = 0
            item.downloadProgress = 0
            break
          case 'Progress':
            item.downloadReceived = (item.downloadReceived || 0) + event.data.chunkLength
            if ((item.downloadTotal || 0) > 0) {
              item.downloadProgress = Math.round(((item.downloadReceived || 0) / (item.downloadTotal || 1)) * 100)
            }
            break
          case 'Finished': item.downloadProgress = 100; break
        }
        items.changed()
      })
      await relaunch()
    } catch (error) {
      console.error(error)
      if (isAlive(item)) item.body = t('settings.messages.updateFailed')
    } finally {
      if (isAlive(item)) { item.updateInstalling = false; items.changed() }
    }
  }

  async function handleNotificationAction(item: ToastItem, action: EventAction) {
    if (!item.eventId) return
    try { await triggerNotificationAction(item.eventId, action.id) }
    catch (error) {
      console.warn('[notification-action] failed', { eventId: item.eventId, actionId: action.id, error })
      if (!disposed) {
        store.setState({ notice: t('settings.sysNotify.actionFailed') })
        if (noticeTimer) clearTimeout(noticeTimer)
        noticeTimer = setTimeout(() => {
          noticeTimer = null
          if (!disposed) store.setState({ notice: '' })
        }, 2600)
      }
    }
  }

  async function register(promise: Promise<UnlistenFn>) {
    const unlisten = await promise
    if (disposed) { unlisten(); return false }
    unlisteners.add(unlisten)
    return true
  }

  async function mount() {
    try {
      try { await loadExternalPlugins() }
      catch (error) { console.warn('[toast] loadExternalPlugins failed', error) }
      if (disposed) return
      try {
        const showDebug = await getToastDebugMode()
        if (!disposed) store.setState({ showDebug })
      } catch { /* Debug mode is optional. */ }
      if (disposed) return
      await register(listen<boolean>('catrace-toast-debug-changed', (event) => {
        if (!disposed) store.setState({ showDebug: event.payload })
      }))
      if (disposed) return
      await register(listen('catrace:reload-external-plugins', () => {
        void loadExternalPlugins({ force: true }).then(() => {
          if (disposed) return
          const registry = usePluginRegistry.getState()
          for (const item of items.current) {
            if (!item.pluginId || item.leaving) continue
            const handle = registry.getPlugin(item.pluginId) || registry.getPluginForKind(item.kind)
            if (handle?.uiUrl) item.uiUrl = handle.uiUrl
          }
          items.changed()
          clearPluginHostCardCache()
        }).catch((error) => console.warn('[toast] reload external plugins failed', error))
      }))
      if (disposed) return
      await register(bus.subscribe())
      if (disposed) return
      await bus.hydrateActiveEvents()
      if (disposed) return
      resize.attach()
      resize.scheduleWindowResize()
      document.addEventListener('pointerover', activation.handleToastPointerOver, true)
      document.addEventListener('pointerdown', activation.handleToastPointerDown, true)
      try {
        const data = await getReminderData(WINDOW_LABEL)
        if (!disposed && data) addNotification({
          kind: (data.kind as ToastKind) || 'rest', boundary: data.boundary,
          title: data.title, body: data.body,
        })
      } catch { /* Event Bus hydration is sufficient when no initial data exists. */ }
    } catch (error) { console.warn('[toast] initialization failed', error) }
  }

  function dispose() {
    disposed = true
    ++closingGeneration
    for (const unlisten of unlisteners) unlisten()
    unlisteners.clear()
    document.removeEventListener('pointerover', activation.handleToastPointerOver, true)
    document.removeEventListener('pointerdown', activation.handleToastPointerDown, true)
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    for (const timeout of removals.values()) clearTimeout(timeout)
    removals.clear()
    timers.stopAll()
    restTimer.dispose()
    bus.dispose()
    resize.detach()
    frames.dispose()
  }

  return {
    store, resize, scroll, timers, mount, dispose, addNotification, removeNotification,
    handleSnooze, handleSkip, handleClose, toggleUpdateDetails, handleSdkAction,
    handlePluginAction, handleUpdateInstall, handleNotificationAction,
    activateNotification: (item: ToastItem) => handleNotificationAction(item, BODY_ACTION),
  }
}

export type ToastController = ReturnType<typeof createToastController>
