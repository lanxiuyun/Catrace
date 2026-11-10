import { useEffect, useState } from 'react'
import { Button, Chip, Switch } from '@heroui/react'
import {
  getNotificationForwardStatus,
  openNotificationPermissionSettings,
  setNotificationForwardEnabled,
  setNotificationTakeoverEnabled,
  type NotificationForwardStatus,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { SettingRow } from './SettingRow'
import { SettingsCard } from './SettingsCard'

/** 系统通知：转发开关、接管开关、权限状态与授权提示。 */
export function SysNotifySettingsCard() {
  const t = useT()
  const [status, setStatus] = useState<NotificationForwardStatus | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const enabled = status?.enabled ?? false
  const takeover = status?.takeover ?? false
  const access = status?.access ?? 'unknown'
  const supported = access !== 'unavailable'
  const accessBlocked = supported && (access === 'denied' || access === 'unspecified')
  const showAccessHint = accessBlocked && (enabled || attempted)

  const refresh = async () => {
    try {
      setStatus(await getNotificationForwardStatus())
    } catch (error) {
      console.error('Failed to refresh notification status', error)
    }
  }

  useEffect(() => {
    let alive = true
    void refresh().finally(() => {
      if (alive) setReady(true)
    })
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onToggle = async (next: boolean) => {
    if (next) setAttempted(true)
    setLoading(true)
    try {
      const nextStatus = await setNotificationForwardEnabled(next)
      setStatus(nextStatus)
      if (nextStatus.enabled) {
        setAttempted(false)
      } else {
        showToast(t('settings.sysNotify.startFailed'), 'warning')
      }
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
      void refresh()
    } finally {
      setLoading(false)
    }
  }

  const applyTakeover = async (value: boolean) => {
    try {
      await setNotificationTakeoverEnabled(value)
      setStatus((previous) => (previous ? { ...previous, takeover: value } : previous))
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
      void refresh()
    }
  }

  const onTakeoverToggle = (value: boolean) => {
    if (!value) {
      void applyTakeover(false)
      return
    }
    const confirmed = window.confirm(
      `${t('settings.sysNotify.takeoverConfirmTitle')}\n\n${t('settings.sysNotify.takeoverConfirmBody')}`,
    )
    if (confirmed) void applyTakeover(true)
  }

  const accessView = (() => {
    switch (access) {
      case 'granted':
        return { color: 'success' as const, label: t('settings.sysNotify.accessGranted') }
      case 'denied':
        return { color: 'warning' as const, label: t('settings.sysNotify.accessDenied') }
      case 'unavailable':
        return { color: 'default' as const, label: t('settings.sysNotify.accessUnavailable') }
      default:
        return { color: 'default' as const, label: t('settings.sysNotify.accessUnspecified') }
    }
  })()

  return (
    <SettingsCard label={t('settings.groups.sysNotify')}>
      <SettingRow title={t('settings.sysNotify.forwardTitle')} desc={t('settings.sysNotify.forwardDesc')}>
        <div className="ct-settings-side">
          <Chip color={accessView.color} size="sm" variant="soft">
            {accessView.label}
          </Chip>
          <Switch
            isSelected={enabled}
            isDisabled={!supported || loading || !ready}
            onChange={(value) => void onToggle(value)}
          >
            <Switch.Content>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </SettingRow>

      {enabled && (
        <>
          <SettingRow
            title={t('settings.sysNotify.takeoverTitle')}
            desc={t('settings.sysNotify.takeoverDesc')}
          >
            <Switch isSelected={takeover} onChange={onTakeoverToggle}>
              <Switch.Content>
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch.Content>
            </Switch>
          </SettingRow>
        </>
      )}

      {showAccessHint && (
        <>
          <div className="ct-settings-denied">
            <span>{t('settings.sysNotify.deniedHint')}</span>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                void openNotificationPermissionSettings().catch(() => {})
              }}
            >
              {t('settings.sysNotify.openSystemSettings')}
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  )
}
