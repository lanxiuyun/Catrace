import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from 'zustand'
import { useT } from '../i18n'
import RestToastCard from '../../components/RestToastCard'
import UpdateToastCard from '../../components/UpdateToastCard'
import RestTimerToastCard from '../../components/RestTimerToastCard'
import SdkToastCard from '../../components/SdkToastCard'
import NotificationToastCard from '../../components/NotificationToastCard'
import SpecialDayToastCard from '../../components/SpecialDayToastCard'
import PluginHostCard from '../../components/PluginHostCard'
import { isBuiltinKind, toastCardStyle, type ToastItem } from './toast/toastCard'
import { createToastController, type ToastController } from './toast/controller'
import './toast/toast.css'

function CardContent({ item, controller }: { item: ToastItem; controller: ToastController }) {
  const onClose = () => { void controller.handleClose(item) }
  if (item.kind === 'rest') return <RestToastCard
    title={item.title} body={item.body} isHovered={item.isHovered} onClose={onClose}
    onSnooze={(minutes) => { void controller.handleSnooze(item, minutes) }}
    onSkip={() => { void controller.handleSkip(item) }}
  />
  if (item.kind === 'update') return <UpdateToastCard
    version={item.version} updateBody={item.updateBody} showUpdateBody={item.showUpdateBody}
    updateInstalling={item.updateInstalling} downloadProgress={item.downloadProgress}
    onClose={onClose} onToggleDetails={() => controller.toggleUpdateDetails(item)}
    onResize={controller.resize.scheduleWindowResize}
    onInstall={(source) => { void controller.handleUpdateInstall(item, source) }}
  />
  if (item.kind === 'rest-timer') return <RestTimerToastCard
    title={item.title} body={item.body} restStreak={item.restStreak}
    breakMinutes={item.breakMinutes} onClose={onClose}
  />
  if (item.kind === 'special') return <SpecialDayToastCard
    title={item.title} body={item.body} tag={item.specialTag || ''} icon={item.specialIcon || ''}
    category={item.specialCategory || 'life'} onClose={onClose}
  />
  if (item.kind === 'notification') return <NotificationToastCard
    appName={item.appName} icon={item.iconUrl} title={item.title} body={item.body}
    isHovered={item.isHovered} actions={item.notificationActions} bodyAction={item.bodyClickable}
    onClose={onClose} onAction={(action) => { void controller.handleNotificationAction(item, action) }}
    onActivate={() => { void controller.activateNotification(item) }}
  />
  if (item.busEvent && (item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk'))) {
    return <PluginHostCard event={item.busEvent} isHovered={item.isHovered}
      remainingMs={item.remainingMs} totalMs={item.totalMs} uiUrl={item.uiUrl} pluginId={item.pluginId}
      onClose={onClose} onAction={(actionId) => controller.handlePluginAction(item, actionId)}
    />
  }
  if (item.kind === 'sdk' || !isBuiltinKind(item.kind)) return <SdkToastCard
    title={item.title} body={item.body} level={item.level} isHovered={item.isHovered}
    sticky={!!item.sticky} progress={item.sdkProgress} actions={item.sdkActions}
    onClose={onClose} onAction={(actionId) => controller.handleSdkAction(item, actionId)}
  />
  return null
}

export default function ReminderToast() {
  const t = useT()
  const translate = useRef(t)
  translate.current = t
  const rootRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const [controller] = useState(() => createToastController(rootRef, stackRef,
    (key, params) => translate.current(key, params)))
  const notifications = useStore(controller.store, (state) => state.notifications)
  const showDebug = useStore(controller.store, (state) => state.showDebug)
  const notice = useStore(controller.store, (state) => state.notice)

  useEffect(() => {
    document.documentElement.classList.add('reminder-transparent')
    void controller.mount()
    return () => {
      controller.dispose()
      document.documentElement.classList.remove('reminder-transparent')
    }
  }, [controller])

  useEffect(() => {
    controller.resize.scheduleWindowResize()
  }, [controller, notifications])

  return <div ref={rootRef} className={`toast-root${showDebug ? ' debug-bg' : ''}`}>
    <div ref={stackRef} className="toast-stack" onScroll={controller.scroll.handleStackScroll}>
      {notifications.map((item) => {
        const classes = ['toast-card']
        if (item.visible) classes.push('visible')
        if (item.leaving) classes.push('leaving')
        if (item.kind === 'update') classes.push('toast-card-update')
        if (item.kind === 'rest-timer') classes.push('toast-card-rest-timer')
        if (item.kind === 'sdk') classes.push('toast-card-sdk')
        if (item.kind === 'special') classes.push('toast-card-special')
        if (item.pluginId || (!isBuiltinKind(item.kind) && item.kind !== 'sdk')) classes.push('toast-card-plugin')
        if (item.toastStyle === 'standalone') classes.push('toast-card-standalone')
        return <div key={item.id} ref={(element) => controller.resize.setCardRef(element, item.id)}
          className={classes.join(' ')} style={toastCardStyle(item) as CSSProperties}
          onMouseEnter={() => controller.timers.handleMouseEnter(item)}
          onMouseLeave={() => controller.timers.handleMouseLeave(item)}>
          <CardContent item={item} controller={controller} />
        </div>
      })}
    </div>
    {notice && <div className="toast-feedback" role="alert">{notice}</div>}
  </div>
}
