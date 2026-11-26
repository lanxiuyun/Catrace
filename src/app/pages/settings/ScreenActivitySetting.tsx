import { useEffect, useRef, useState } from 'react'
import { Chip, Switch } from '@heroui/react'
import {
  getScreenActivityStatus,
  setScreenActiveEnabled,
  type ScreenActivityStatus,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { SettingRow } from './SettingRow'

export function ScreenActivitySetting() {
  const t = useT()
  const [status, setStatus] = useState<ScreenActivityStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const generation = useRef(0)
  const changing = useRef(false)

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      if (changing.current) return
      const token = generation.current
      try {
        const next = await getScreenActivityStatus()
        if (alive && token === generation.current) setStatus(next)
      } catch (error) {
        console.error('Failed to read screen activity status', error)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    const timer = status?.enabled ? setInterval(() => void refresh(), 2000) : null
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
      if (timer) clearInterval(timer)
    }
  }, [status?.enabled])

  const toggle = async (enabled: boolean) => {
    changing.current = true
    ++generation.current
    setSaving(true)
    try {
      setStatus(await setScreenActiveEnabled(enabled))
    } catch (error) {
      console.error('Failed to save screen activity mode', error)
      showToast(t('settings.messages.setFailed'), 'error')
    } finally {
      changing.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <SettingRow title={t('settings.media.screenTitle')} desc={t('settings.media.screenDesc')}>
        <div className="ct-settings-side">
          {status?.supported === false && (
            <Chip size="sm" variant="soft" color="default">
              {t('settings.sysNotify.accessUnavailable')}
            </Chip>
          )}
          <Switch
            isSelected={status?.enabled ?? false}
            isDisabled={!status?.supported || saving}
            aria-label={t('settings.media.screenTitle')}
            onChange={(value) => void toggle(value)}
          >
            <Switch.Content>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </SettingRow>
      {status?.supported && status.enabled && status.active === null && (
        <div className="ct-settings-hint">
          {t('settings.media.screenFallback')}
        </div>
      )}
    </>
  )
}
