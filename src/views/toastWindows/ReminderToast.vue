<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen } from '@tauri-apps/api/event'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  getReminderData,
  getToastDebugMode,
  snoozeReminder,
  skipReminder,
  closeReminderWindow,
  dismissRestTimer,
  checkAppUpdate,
  installAppUpdate,
  triggerNotificationAction,
} from '../../api/tauri'
import { useMessage } from 'naive-ui'
import type { EventAction } from '../../types/event'
import RestToastCard from '../../components/RestToastCard.vue'
import UpdateToastCard from '../../components/UpdateToastCard.vue'
import RestTimerToastCard from '../../components/RestTimerToastCard.vue'
import SdkToastCard from '../../components/SdkToastCard.vue'
import NotificationToastCard from '../../components/NotificationToastCard.vue'
import SpecialDayToastCard from '../../components/SpecialDayToastCard.vue'
import PluginHostCard from '../../components/PluginHostCard.vue'
import { clearPluginHostCardCache } from '../../components/pluginHostCardCache'
import type { ToastItem, ToastKind, AddNotificationPayload } from './reminder/toastCard'
import { isBuiltinKind, resolveAutoHideMs, toastCardStyle } from './reminder/toastCard'
import { useToastCloseTimer } from './reminder/useToastCloseTimer'
import { useToastWindowResize } from './reminder/useToastWindowResize'
import { useToastStackScroll } from './reminder/useToastStackScroll'
import { useToastWindowActivation, WINDOW_LABEL } from './reminder/useToastWindowActivation'
import { useRestTimerCard } from './reminder/useRestTimerCard'
import { useToastBusEvents } from './reminder/useToastBusEvents'
import { loadExternalPlugins } from '../../plugins/loadExternalPlugins'
import { usePluginRegistry } from '../../stores/pluginRegistry'

const { t } = useI18n()
const message = useMessage()

const notifications = ref<ToastItem[]>([])
const showDebug = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const stackRef = ref<HTMLElement | null>(null)
const isAnimating = ref(false)

let idCounter = 0
const nextId = () => ++idCounter

let unlistenDebug: (() => void) | null = null
let unlistenBusEvent: (() => void) | null = null
let unlistenReloadPlugins: (() => void) | null = null

/** 卡片离场后移除时机：等 opacity 淡完（0.25s）即视为不可见，立即移除让剩余卡片掉落；
 *  transform 0.35s 滑出屏幕后的尾部已不可见，无需等待，避免「隐形卡占位」造成的掉卡延迟。 */
const LEAVE_ANIMATION_MS = 250

// ---------- 职责模块：计时 / 尺寸上报 / 贴底滚动 / 窗口激活 / bus 事件 / rest-timer ----------

const {
  startTimer,
  stopTimer,
  handleMouseEnter,
  handleMouseLeave,
  stopAll: stopAllTimers,
} = useToastCloseTimer({
  notifications,
  onExpire: expireToast,
})

const {
  setCardRef,
  scheduleWindowResize,
  releaseCard,
  attach: attachResizeObserver,
  detach: detachResizeObserver,
  resetSizeKey,
} = useToastWindowResize({
  rootRef,
  stackRef,
  isAnimating,
  isEmpty: () => notifications.value.length === 0,
})

const { handleStackScroll, scrollStackToBottom, pinToBottom } = useToastStackScroll({
  stackRef,
  cardCount: () => notifications.value.length,
})

const {
  handleToastPointerOver,
  handleToastPointerDown,
  resetActivationState,
  deactivateWindow,
} = useToastWindowActivation({ rootRef })

const bus = useToastBusEvents({
  notifications,
  updateRestTimer: (payload) => restTimer.updateRestTimer(payload),
  startTimer,
  stopTimer,
  addNotification,
  removeNotification,
  scheduleWindowResize,
})
const {
  subscribe: subscribeBusEvents,
  hydrateActiveEvents,
  markEventResolved,
  markEventSeen,
} = bus

const restTimer = useRestTimerCard({
  notifications,
  nextId,
  t,
  scheduleWindowResize,
  removeNotification,
  markEventResolved,
  markEventSeen,
})
const { stopRestPoll } = restTimer

onMounted(async () => {
  // Card map must be ready before bus events (incl. plugin test from main window).
  try {
    await loadExternalPlugins()
  } catch (e) {
    console.warn('[toast] loadExternalPlugins failed', e)
  }

  // 读取初始调试模式状态
  try {
    showDebug.value = await getToastDebugMode()
  } catch {
    // ignore
  }

  // 监听 Tauri 事件，实时同步调试模式状态
  unlistenDebug = await listen<boolean>('catrace-toast-debug-changed', (event) => {
    showDebug.value = event.payload
  })

  // Plugins page refresh → reload external card UI without app restart.
  unlistenReloadPlugins = await listen('catrace:reload-external-plugins', () => {
    void loadExternalPlugins({ force: true })
      .then(() => {
        // Registry first, then bust cache so remount resolves the new Card once.
        const reg = usePluginRegistry()
        for (const n of notifications.value) {
          if (!n.pluginId || n.leaving) continue
          const handle = reg.getPlugin(n.pluginId) || reg.getPluginForKind(n.kind)
          if (handle?.uiUrl) n.uiUrl = handle.uiUrl
        }
        clearPluginHostCardCache()
      })
      .catch((e) => {
        console.warn('[toast] reload external plugins failed', e)
      })
  })

  // Event Bus → Toast 统一渲染线（rest / timer / plugin 等 display_mode=toast 的 active 事件）
  unlistenBusEvent = await subscribeBusEvents()
  // 晚到的 Toast 窗：拉一次 active events 补水合
  await hydrateActiveEvents()

  // 监听布局变化，按内容高度 resize 原生小窗
  await nextTick()
  attachResizeObserver()
  scheduleWindowResize()
  document.addEventListener('pointerover', handleToastPointerOver, true)
  document.addEventListener('pointerdown', handleToastPointerDown, true)

  // 读取初始通知
  try {
    const data = await getReminderData('reminder-toast')
    if (data) {
      addNotification({
        kind: (data.kind as ToastKind) || 'rest',
        boundary: data.boundary,
        title: data.title,
        body: data.body,
      })
    }
  } catch {
    // ignore
  }
})

onUnmounted(() => {
  unlistenDebug?.()
  unlistenDebug = null
  unlistenBusEvent?.()
  unlistenBusEvent = null
  unlistenReloadPlugins?.()
  unlistenReloadPlugins = null
  document.removeEventListener('pointerover', handleToastPointerOver, true)
  document.removeEventListener('pointerdown', handleToastPointerDown, true)
  stopRestPoll()
  stopAllTimers()
  detachResizeObserver()
})

/** closeTimer 到点：把后端事件 resolve（否则刷新/水合时旧 toast 会复活），再移除卡片 */
function expireToast(item: ToastItem) {
  markEventResolved(item.eventId)
  removeNotification(item.id, true)
}

async function addNotification(payload: AddNotificationPayload) {
  // 不加数量上限：卡片超出窗口高度时由滚动容器（n-scrollbar）接管
  const id = nextId()
  const isUpdate = payload.kind === 'update'
  const isSdkSticky = payload.kind === 'sdk' && !!payload.sticky
  const isPluginSticky = !!payload.pluginId && !!payload.sticky
  const isSpecial = payload.kind === 'special'
  const isSticky = isUpdate || isSdkSticky || isPluginSticky || isSpecial
  const autoHideMs = isSticky
    ? 0
    : (payload.autoHideMs ?? resolveAutoHideMs(payload.busEvent, false))
  const item: ToastItem = {
    id,
    kind: payload.kind,
    title: payload.title || '',
    body: payload.body || '',
    boundary: payload.boundary ?? 0,
    visible: false,
    isHovered: false,
    remainingMs: isSticky ? 0 : autoHideMs,
    closeTimer: null,
    lastStartAt: 0,
    version: payload.version || '',
    updateBody: payload.updateBody || '',
    showUpdateBody: false,
    updateInstalling: false,
    downloadProgress: 0,
    downloadTotal: 0,
    downloadReceived: 0,
    sticky: isSdkSticky || isPluginSticky || isSpecial,
    totalMs: isSticky ? 0 : autoHideMs,
    eventId: payload.eventId,
    dedupeKey: payload.dedupeKey,
    toastStyle: payload.toastStyle,
    level: payload.level,
    sdkActions: payload.sdkActions,
    sdkProgress: payload.sdkProgress ?? null,
    busEvent: payload.busEvent,
    pluginId: payload.pluginId,
    uiUrl: payload.uiUrl,
    specialTag: payload.tag,
    specialIcon: payload.icon,
    specialCategory: payload.category,
    appName: payload.appName,
    iconUrl: payload.iconUrl,
    notificationActions: payload.notificationActions,
    bodyClickable: payload.bodyClickable,
  }

  // 新通知加到底部（数组末尾）
  notifications.value.push(item)

  // 触发动画
  requestAnimationFrame(() => {
    const found = notifications.value.find((n) => n.id === id)
    if (found) {
      found.visible = true
    }
  })

  if (!isSticky) {
    startTimer(item)
  }
  await nextTick()
  scheduleWindowResize()
  scrollStackToBottom()
}

function removeNotification(id: number, animate: boolean) {
  const index = notifications.value.findIndex((n) => n.id === id)
  if (index === -1) return

  const item = notifications.value[index]
  // 已经在关闭动画中，避免重复触发
  if (item.leaving) return

  stopTimer(item)
  if (item.endTimer) {
    clearTimeout(item.endTimer)
    item.endTimer = null
  }
  if (item.kind === 'rest-timer') {
    stopRestPoll()
  }

  if (!animate) {
    // 不带动画：直接移除并刷新窗口
    doRemoveCard(id)
    return
  }

  // 带动画：只切 `.leaving` class 让卡片在原位淡出滑出。
  // 不做 fixed 定位 + transform 的 FLIP —— 透明全屏 WebView2 上改 DOM 定位
  // 并强制重排会把 GPU 合成器卡死（toast 窗口冻结）；剩余卡片在移除后自然补位。
  item.leaving = true
  isAnimating.value = true
  setTimeout(() => {
    doRemoveCard(id)
    isAnimating.value = false
    scheduleWindowResize()
  }, LEAVE_ANIMATION_MS)
}

/** 真正从数据里移除一张卡，刷新窗口高度，空栈时关窗。 */
function doRemoveCard(id: number) {
  releaseCard(id)
  notifications.value = notifications.value.filter((n) => n.id !== id)
  scheduleWindowResize()
  if (notifications.value.length === 0) {
    // 空栈关窗：下一次弹出从「贴底」重新开始
    pinToBottom()
    closeWindow()
  }
}

async function closeWindow() {
  resetSizeKey()
  resetActivationState()
  await deactivateWindow()
  try {
    await closeReminderWindow(WINDOW_LABEL)
  } catch {
    try {
      await getCurrentWebviewWindow().close()
    } catch {
      // ignore
    }
  }
}

async function handleSnooze(item: ToastItem, minutes: number) {
  stopTimer(item)
  try {
    await snoozeReminder(minutes)
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'snooze')
  removeNotification(item.id, true)
}

async function handleSkip(item: ToastItem) {
  stopTimer(item)
  try {
    await skipReminder(item.boundary)
  } catch {
    // ignore
  }
  markEventResolved(item.eventId, 'skip')
  removeNotification(item.id, true)
}

function toggleUpdateDetails(item: ToastItem) {
  item.showUpdateBody = !item.showUpdateBody
  nextTick(() => scheduleWindowResize())
}

function handleSdkAction(item: ToastItem, actionId: string) {
  markEventResolved(item.eventId, actionId)
  removeNotification(item.id, true)
}

function handlePluginAction(item: ToastItem, actionId: string) {
  console.info('[sidecar-action] toast action', {
    notificationId: item.id,
    eventId: item.eventId,
    pluginId: item.pluginId,
    actionId,
    sticky: !!item.sticky,
    leaving: !!item.leaving,
    dedupeKey: item.dedupeKey,
    t: Date.now(),
  })
  // Sticky plugin action cards stay mounted (resolved action keeps card).
  // Bus owns non-action removal; never double-remove here.
  markEventResolved(item.eventId, actionId)
}

async function handleClose(item: ToastItem) {
  // 休息计时卡片关闭时同步通知后端清理 break_timer_active，避免卡片反复出现
  if (item.kind === 'rest-timer') {
    try {
      await dismissRestTimer()
    } catch {
      // ignore
    }
  }
  markEventResolved(item.eventId)
  removeNotification(item.id, true)
}

async function handleUpdateInstall(item: ToastItem, source?: string) {
  if (item.updateInstalling) return
  item.updateInstalling = true
  try {
    const update = await checkAppUpdate({ timeout: 10000, source })
    if (!update) {
      item.body = t('settings.messages.noUpdateFound')
      return
    }
    await installAppUpdate(update, source, (event) => {
      switch (event.event) {
        case 'Started':
          item.downloadTotal = event.data.contentLength || 0
          item.downloadReceived = 0
          item.downloadProgress = 0
          break
        case 'Progress':
          item.downloadReceived = (item.downloadReceived || 0) + event.data.chunkLength
          if ((item.downloadTotal || 0) > 0) {
            item.downloadProgress = Math.round(
              ((item.downloadReceived || 0) / (item.downloadTotal || 1)) * 100
            )
          }
          break
        case 'Finished':
          item.downloadProgress = 100
          break
      }
    })
    await relaunch()
  } catch (e) {
    console.error(e)
    item.body = t('settings.messages.updateFailed')
  } finally {
    item.updateInstalling = false
  }
}

// 点卡片本体触发的主操作：'launch' 是后端 trigger_notification_action 的保留 action id
const NOTIF_BODY_ACTION: EventAction = { id: 'launch', label: '' }

// 转发通知卡片的按钮点击：成功由后端 resolve 事件、总线的 resolved 事件自动收卡，
// 操作中心源通知由 worker 移除；失败时卡片保留，用户可重试
async function handleNotificationAction(item: ToastItem, action: EventAction) {
  if (!item.eventId) return
  try {
    await triggerNotificationAction(item.eventId, action.id)
  } catch (e) {
    console.warn('[notification-action] failed', { eventId: item.eventId, actionId: action.id, e })
    message.error(t('settings.sysNotify.actionFailed'))
  }
}
</script>

<template>
  <div ref="rootRef" class="toast-root" :class="{ 'debug-bg': showDebug }">
    <div ref="stackRef" class="toast-stack" @scroll.passive="handleStackScroll">
      <div
        v-for="item in notifications"
        :key="item.id"
        :ref="(el) => setCardRef(el, item.id)"
        class="toast-card"
        :class="{
          visible: item.visible,
          leaving: item.leaving,
          'toast-card-update': item.kind === 'update',
          'toast-card-rest-timer': item.kind === 'rest-timer',
          'toast-card-sdk': item.kind === 'sdk',
          'toast-card-special': item.kind === 'special',
          'toast-card-plugin': !!item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'),
          'toast-card-standalone': item.toastStyle === 'standalone',
        }"
        :style="toastCardStyle(item)"
        @mouseenter="handleMouseEnter(item)"
        @mouseleave="handleMouseLeave(item)"
      >
        <RestToastCard
          v-if="item.kind === 'rest'"
          :title="item.title"
          :body="item.body"
          :is-hovered="item.isHovered"
          @close="handleClose(item)"
          @snooze="(m) => handleSnooze(item, m)"
          @skip="handleSkip(item)"
        />

        <UpdateToastCard
          v-else-if="item.kind === 'update'"
          :version="item.version"
          :update-body="item.updateBody"
          :show-update-body="item.showUpdateBody"
          :update-installing="item.updateInstalling"
          :download-progress="item.downloadProgress"
          @close="handleClose(item)"
          @toggle-details="toggleUpdateDetails(item)"
          @install="(source) => handleUpdateInstall(item, source)"
        />

        <RestTimerToastCard
          v-else-if="item.kind === 'rest-timer'"
          :title="item.title"
          :body="item.body"
          :rest-streak="item.restStreak"
          :break-minutes="item.breakMinutes"
          @close="handleClose(item)"
        />

        <SpecialDayToastCard
          v-else-if="item.kind === 'special'"
          :title="item.title"
          :body="item.body"
          :tag="item.specialTag || ''"
          :icon="item.specialIcon || ''"
          :category="item.specialCategory || 'life'"
          @close="handleClose(item)"
        />

        <NotificationToastCard
          v-else-if="item.kind === 'notification'"
          :app-name="item.appName"
          :icon="item.iconUrl"
          :title="item.title"
          :body="item.body"
          :is-hovered="item.isHovered"
          :actions="item.notificationActions"
          :body-action="item.bodyClickable"
          @close="handleClose(item)"
          @action="(a) => handleNotificationAction(item, a)"
          @activate="handleNotificationAction(item, NOTIF_BODY_ACTION)"
        />

        <PluginHostCard
          v-else-if="item.busEvent && (item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'))"
          :event="item.busEvent"
          :is-hovered="item.isHovered"
          :remaining-ms="item.remainingMs"
          :total-ms="item.totalMs"
          :ui-url="item.uiUrl"
          :plugin-id="item.pluginId"
          @close="handleClose(item)"
          @action="(aid) => handlePluginAction(item, aid)"
        />

        <SdkToastCard
          v-else-if="item.kind === 'sdk'"
          :title="item.title"
          :body="item.body"
          :level="item.level"
          :is-hovered="item.isHovered"
          :sticky="!!item.sticky"
          :progress="item.sdkProgress"
          :actions="item.sdkActions"
          @close="handleClose(item)"
          @action="(aid) => handleSdkAction(item, aid)"
        />

        <!-- Plugin event without custom UI: fall back to SdkToastCard -->
        <SdkToastCard
          v-else-if="!isBuiltinKind(item.kind)"
          :title="item.title"
          :body="item.body"
          :level="item.level"
          :is-hovered="item.isHovered"
          :sticky="!!item.sticky"
          :progress="item.sdkProgress"
          :actions="item.sdkActions"
          @close="handleClose(item)"
          @action="(aid) => handleSdkAction(item, aid)"
        />
      </div>
    </div>

  </div>
</template>

<style scoped>
.toast-root {
  --toast-auto-hide-ms: 8000ms;
  width: 24.5rem; /* 22.5rem card + 1rem shadow bleed each side */
  /* 兜底铺满整窗：祖先链没有定高，`height: 100%` 不生效，根元素会退化成内容高，
     窗口一旦比内容高就会露出没人绘制的透明带。用 vh 直接对齐视口。
     必须是定高而不是 min-height：`.toast-stack` 的 `max-height: 100%` 要拿父元素高度当基准，
     父元素 auto 高时百分比落到 none → 栈永远撑到内容高，overflow-y 没有可滚动的溢出，
     卡片堆超过窗口（Rust 把窗高 clamp 到 work_area）后就滚不动、也不出滚动条。 */
  height: 100vh;
  display: flex;
  flex-direction: column;
  /* 贴窗顶：HWND 底边锚在 work_area。增高若先长高后上移，多出的是透明底，卡片不进任务栏。 */
  justify-content: flex-start;
  align-items: stretch;
  box-sizing: border-box;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
  overflow: hidden;
}

.toast-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
  width: 100%;
  flex: 0 1 auto;
  /* 父元素定高后百分比才生效：内容超出窗高时栈停在这一高度，多出来的卡片靠滚动看。 */
  max-height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
  /* 窗口本身就是阴影出血区：左右各 16px，不再负 margin 拉出 root */
  padding: 1rem;
  /* 始终预留右侧滚动条 gutter：滚动条出现/消失都不引起卡片右缘位移。
     右侧视觉留白恒为 16px = padding-right 6px + scrollbar gutter 10px */
  padding-right: 0.375rem;
  scrollbar-gutter: stable;
}

/* 卡片超出窗口高度时的可见滚动条。
   注意 gutter 那一列是窗口透明区（背后是桌面/壁纸），不是卡片底色，
   所以滑块用中性灰而不是黑：纯黑在深色壁纸上几乎看不见。
   Chromium 下标准属性 scrollbar-color/width 会盖掉 ::-webkit-scrollbar，两处都写同一颜色。 */
.toast-stack {
  scrollbar-width: thin;
  scrollbar-color: rgba(146, 146, 158, 0.7) transparent;
}
.toast-stack::-webkit-scrollbar {
  width: 10px;
}
.toast-stack::-webkit-scrollbar-track {
  background: transparent;
}
.toast-stack::-webkit-scrollbar-thumb {
  background: rgba(146, 146, 158, 0.7);
  border-radius: 5px;
}
.toast-stack::-webkit-scrollbar-thumb:hover {
  background: rgba(146, 146, 158, 0.95);
}

.toast-root.debug-bg {
  background: rgba(255, 220, 0, 0.45);
}

.toast-card {
  width: 22.5rem;
  max-height: 37.5rem;
  background: var(--ct-surface);
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
  transform: translateX(120%) scale(0.96);
  opacity: 0;
  transition:
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.3s ease;
  flex-shrink: 0;
  will-change: transform, opacity;
}

.toast-card.visible {
  transform: translateX(0) scale(1);
  opacity: 1;
}

/* 离场动画：只切 class，依赖 .toast-card 自带的 transition 淡出滑出。
   不做 fixed 定位 / transform FLIP，避免透明全屏 WebView2 合成器冻结。 */
.toast-card.leaving {
  transform: translateX(120%);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.25s ease;
}

/* Agent / permission / sdk / update：内容自撑高度，不要被通用 min-height 卡住或裁切 */
.toast-card-agent,
.toast-card-permission,
.toast-card-sdk {
  min-height: auto;
}

/* Plugin chat cards may be user-resized taller than the generic toast cap. */
.toast-card-plugin {
  min-height: auto;
  max-height: none;
}

.toast-card-special {
  min-height: auto;
  background: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

/* External cards may opt out of the host surface and own the full shell. */
.toast-card-standalone {
  min-height: auto;
  background: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

/* Agent notification theming — dynamic per event */
.toast-card-agent .pulse-dot {
  background: var(--accent);
}

.toast-card-agent .progress-bar {
  background: linear-gradient(90deg, var(--accent), var(--light-bg));
}

.toast-card-agent .title {
  color: var(--title);
}

.toast-card-agent .close-btn:hover {
  background: var(--light-bg);
  color: var(--accent);
}

.toast-card-agent .body-text {
  color: var(--body);
}

/* Permission approval card (P6) — amber, always visible until decision */
.toast-card-permission {
  border: 0.0625rem solid var(--ct-warning-soft);
  box-shadow:
    0 0.5rem 1.5rem rgba(245, 158, 11, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
}
</style>
