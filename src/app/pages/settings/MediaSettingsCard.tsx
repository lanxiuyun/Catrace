import { useEffect, useState } from 'react'
import { Button, Switch, TextArea } from '@heroui/react'
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
import { SettingsCard } from './SettingsCard'
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
    onError: () => showToast(t('settings.messages.setFailed'), 'error'),
  })

  const whitelist = useAutoSaveSetting<string>({
    initialValue: '',
    load: getMediaWhitelistText,
    save: setMediaWhitelistText,
    onError: () => showToast(t('mediaWhitelist.saveFailed'), 'error'),
  })

  const resetWhitelist = async () => {
    if (!window.confirm(t('mediaWhitelist.confirmReset'))) return
    setSaving(true)
    try {
      await setMediaWhitelistText('')
      whitelist.setValue('')
    } catch (error) {
      console.error(error)
      showToast(t('mediaWhitelist.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard label={t('settings.groups.media')}>
      <SettingRow title={t('settings.media.enabledTitle')} desc={t('settings.media.enabledDesc')}>
        <Switch
          isSelected={enabled.value}
          isDisabled={!enabled.ready}
          onChange={(value) => enabled.setValue(value)}
        >
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch.Content>
        </Switch>
      </SettingRow>

      {isWindows && enabled.value && (
        <>
          <div className="ct-whitelist-head ct-settings-block">
            <div>
              <div className="ct-whitelist-title">{t('mediaWhitelist.title')}</div>
              <div className="ct-whitelist-desc">{t('mediaWhitelist.desc')}</div>
            </div>
            <Button
              variant="tertiary"
              isDisabled={saving}
              onClick={() => void resetWhitelist()}
            >
              {t('mediaWhitelist.resetDefault')}
            </Button>
          </div>
          <TextArea
            rows={6}
            variant="secondary"
            className="ct-whitelist-textarea"
            placeholder={t('mediaWhitelist.placeholder')}
            value={whitelist.value}
            onChange={(event) => whitelist.setValue(event.target.value)}
          />
        </>
      )}

      {!isWindows && (
        <>
          <div className="ct-settings-hint">{t('media.unsupportedPlatformHint')}</div>
        </>
      )}
    </SettingsCard>
  )
}
