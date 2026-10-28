import { useEffect, useState } from 'react'
import { Button, Select, Switch } from '@radix-ui/themes'
import {
  getSignalRuntimeConfig,
  purgeKeySequences,
  setSignalKeySequenceEnabled,
  setSignalKeySequenceRetentionHours,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { getSettingsStore } from '../../lib/settingsStore'
import { showToast } from '../../ui/toast'
import { SettingRow } from './SettingRow'

const RETENTION_OPTIONS = [
  { label: '1h', value: '1' },
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
]

/** 行为采集：按键序列记录开关、保留时长、清除已存序列。 */
export function SignalSettingsCard() {
  const t = useT()
  const [enabled, setEnabled] = useState(false)
  const [retentionHours, setRetentionHours] = useState(24)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const store = await getSettingsStore()
        const nextEnabled = (await store.get<boolean>('signal_key_sequence_enabled')) ?? false
        const nextRetention =
          (await store.get<number>('signal_key_sequence_retention_hours')) ?? 24
        if (!alive) return
        setEnabled(nextEnabled)
        setRetentionHours(nextRetention)
        await setSignalKeySequenceEnabled(nextEnabled)
        await setSignalKeySequenceRetentionHours(nextRetention)
        await getSignalRuntimeConfig().catch(() => null)
      } catch (error) {
        console.error('Failed to load signal settings', error)
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const applyEnabled = async (next: boolean) => {
    setLoading(true)
    try {
      const store = await getSettingsStore()
      await store.set('signal_key_sequence_enabled', next)
      await setSignalKeySequenceEnabled(next)
      setEnabled(next)
      showToast(t('settings.messages.saved'))
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const onToggle = (next: boolean) => {
    if (!next) {
      void applyEnabled(false)
      return
    }
    const confirmed = window.confirm(
      `${t('settings.signal.enableConfirmTitle')}\n\n${t('settings.signal.enableConfirmBody')}`,
    )
    if (confirmed) void applyEnabled(true)
  }

  const applyRetention = async (value: string) => {
    const next = Number(value) || 24
    setLoading(true)
    try {
      const store = await getSettingsStore()
      await store.set('signal_key_sequence_retention_hours', next)
      await setSignalKeySequenceRetentionHours(next)
      setRetentionHours(next)
      showToast(t('settings.messages.saved'))
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const onPurge = () => {
    const confirmed = window.confirm(
      `${t('settings.signal.purgeTitle')}\n\n${t('settings.signal.purgeBody')}`,
    )
    if (!confirmed) return
    void (async () => {
      try {
        const count = await purgeKeySequences()
        showToast(t('settings.signal.purgeDone', { n: count }))
      } catch {
        showToast(t('settings.messages.saveFailed'), 'error')
      }
    })()
  }

  return (
    <div className="ct-settings-card">
      <div className="ct-settings-card-label">{t('settings.groups.signal')}</div>

      <SettingRow title={t('settings.signal.keySeqTitle')} desc={t('settings.signal.keySeqDesc')}>
        <Switch
          checked={enabled}
          disabled={loading || !ready}
          onCheckedChange={onToggle}
          color="orange"
        />
      </SettingRow>

      <div className="ct-settings-divider" />

      <SettingRow
        title={t('settings.signal.retentionTitle')}
        desc={t('settings.signal.retentionDesc')}
      >
        <Select.Root value={String(retentionHours)} onValueChange={(value) => void applyRetention(value)}>
          <Select.Trigger style={{ width: '7rem' }} />
          <Select.Content>
            {RETENTION_OPTIONS.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingRow>

      <div className="ct-settings-divider" />

      <SettingRow title={t('settings.signal.purgeTitle')} desc={t('settings.signal.purgeDesc')}>
        <Button variant="soft" color="orange" onClick={onPurge}>
          {t('settings.signal.purgeBtn')}
        </Button>
      </SettingRow>
    </div>
  )
}
