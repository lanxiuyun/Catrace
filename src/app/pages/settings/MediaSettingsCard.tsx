import { useEffect, useState } from 'react'
import { Button, Switch, TextArea } from '@radix-ui/themes'
import {
  getMediaActiveEnabled,
  getMediaWhitelistText,
  getPlatform,
  setMediaActiveEnabled,
  setMediaWhitelistText,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { SettingRow } from './SettingRow'
import { useAutoSaveSetting } from './useAutoSaveSetting'

/** Media playback counts as active + Windows process whitelist. */
export function MediaSettingsCard() {
  const t = useT()
  const [platform, setPlatform] = useState('windows')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getPlatform()
      .then(setPlatform)
      .catch((error) => console.error(error))
  }, [])

  const isWindows = platform === 'windows'

  const enabled = useAutoSaveSetting<boolean>({
    initialValue: true,
    load: getMediaActiveEnabled,
    save: setMediaActiveEnabled,
    debounce: 0,
    onSuccess: (value) =>
      showToast(
        value ? t('settings.messages.mediaActiveOn') : t('settings.messages.mediaActiveOff'),
      ),
    onError: () => showToast(t('settings.messages.setFailed'), 'error'),
  })

  const whitelist = useAutoSaveSetting<string>({
    initialValue: '',
    load: getMediaWhitelistText,
    save: setMediaWhitelistText,
    onSuccess: () => showToast(t('mediaWhitelist.saveSuccess')),
    onError: () => showToast(t('mediaWhitelist.saveFailed'), 'error'),
  })

  const resetWhitelist = async () => {
    if (!window.confirm(t('mediaWhitelist.confirmReset'))) return
    setSaving(true)
    try {
      await setMediaWhitelistText('')
      whitelist.setValue('')
      showToast(t('mediaWhitelist.saveSuccess'))
    } catch (error) {
      console.error(error)
      showToast(t('mediaWhitelist.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ct-settings-card">
      <div className="ct-settings-card-label">{t('settings.groups.media')}</div>

      <SettingRow title={t('settings.media.enabledTitle')} desc={t('settings.media.enabledDesc')}>
        <Switch
          checked={enabled.value}
          onCheckedChange={(value) => enabled.setValue(value)}
          disabled={!enabled.ready}
        />
      </SettingRow>

      {isWindows && enabled.value && (
        <>
          <div className="ct-settings-divider" />
          <div className="ct-whitelist-head">
            <div>
              <div className="ct-whitelist-title">{t('mediaWhitelist.title')}</div>
              <div className="ct-whitelist-desc">{t('mediaWhitelist.desc')}</div>
            </div>
            <Button
              variant="soft"
              color="gray"
              disabled={saving}
              onClick={() => void resetWhitelist()}
            >
              {t('mediaWhitelist.resetDefault')}
            </Button>
          </div>
          <TextArea
            rows={6}
            placeholder={t('mediaWhitelist.placeholder')}
            value={whitelist.value}
            onChange={(event) => whitelist.setValue(event.target.value)}
            resize="vertical"
          />
        </>
      )}

      {!isWindows && (
        <>
          <div className="ct-settings-divider" />
          <div className="ct-settings-hint">{t('media.unsupportedPlatformHint')}</div>
        </>
      )}
    </div>
  )
}
