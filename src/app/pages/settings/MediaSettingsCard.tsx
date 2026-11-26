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
import { ScreenActivitySetting } from './ScreenActivitySetting'
import { useAutoSaveSetting } from './useAutoSaveSetting'

/** Activity detection: media playback, Windows exclusions, and screen mode. */
export function MediaSettingsCard() {
  const t = useT()
  const [platform, setPlatform] = useState('')
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
          aria-label={t('settings.media.enabledTitle')}
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
            className="ct-whitelist-textarea"
            aria-label={t('mediaWhitelist.title')}
            placeholder={t('mediaWhitelist.placeholder')}
            value={whitelist.value}
            onChange={(event) => whitelist.setValue(event.target.value)}
          />
        </>
      )}

      {platform && !isWindows && (
        <>
          <div className="ct-settings-hint">{t('settings.media.unsupportedPlatformHint')}</div>
        </>
      )}
      <div className="ct-settings-block">
        <ScreenActivitySetting />
      </div>
    </SettingsCard>
  )
}
