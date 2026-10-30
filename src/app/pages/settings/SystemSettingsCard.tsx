import { useEffect, useState } from 'react'
import { Button, Progress, Select, Switch } from '@radix-ui/themes'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  checkAppUpdate,
  getLightweightMode,
  getLocale,
  getSilentStart,
  getUpdateSource,
  installAppUpdate,
  setLightweightMode,
  setLocale,
  setSilentStart,
  setUpdateSource,
  type UpdateSourceId,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { useShellStore } from '../../store'
import { showToast } from '../../ui/toast'
import { useTheme } from '../../../composables/useTheme'
import i18n from '../../../i18n'
import { detectDefaultLocale, type SupportedLocale } from '../../../utils/locale'
import { SettingRow } from './SettingRow'

const UPDATE_SOURCE_IDS: UpdateSourceId[] = ['auto', 'ghfast', 'ghddlc', 'ghproxy', 'github']

interface UpdateInfo {
  available: boolean
  version?: string
  body?: string
}

/**
 * 「系统」设置卡（React 版，替代 components/settings/SystemSettingsCard.vue）：
 * 语言 / 外观主题 / 开机自启 / 静默启动 / 轻量模式 / 软件更新。
 */
export function SystemSettingsCard() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)
  const themeMode = useShellStore((state) => state.themeMode)
  const { setMode: setThemeMode } = useTheme()

  const [autostart, setAutostart] = useState(false)
  const [silentStart, setSilentStartEnabled] = useState(false)
  const [lightweightMode, setLightweightModeEnabled] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateSource, setUpdateSourceState] = useState<UpdateSourceId>('auto')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  const [autostartLoading, setAutostartLoading] = useState(false)
  const [silentLoading, setSilentLoading] = useState(false)
  const [lightweightLoading, setLightweightLoading] = useState(false)
  const [localeLoading, setLocaleLoading] = useState(false)
  const [updateSourceLoading, setUpdateSourceLoading] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [nextAutostart, nextSilent, version, storedLocale, source, lightweight] =
          await Promise.all([
            isEnabled(),
            getSilentStart(),
            getVersion(),
            getLocale(),
            getUpdateSource(),
            getLightweightMode(),
          ])
        if (!alive) return
        setAutostart(nextAutostart)
        setSilentStartEnabled(nextSilent)
        setLightweightModeEnabled(lightweight)
        setAppVersion(version)
        setUpdateSourceState(source)

        if (!storedLocale) {
          // 首次启动：按系统语言自动检测并静默保存，不弹「已保存」提示。
          const detected = detectDefaultLocale()
          await setLocale(detected)
          i18n.global.locale.value = detected
        } else {
          i18n.global.locale.value = storedLocale as SupportedLocale
        }
      } catch (error) {
        console.error('Failed to load system settings', error)
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const changeLocale = async (value: string) => {
    if (!ready || value === locale) return
    setLocaleLoading(true)
    try {
      await setLocale(value)
      i18n.global.locale.value = value as SupportedLocale
      showToast(t('settings.messages.saved'))
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
    } finally {
      setLocaleLoading(false)
    }
  }

  const changeTheme = (value: string) => {
    void setThemeMode(value === 'light' || value === 'dark' ? value : 'system')
  }

  const toggleAutostart = async (value: boolean) => {
    setAutostartLoading(true)
    try {
      if (value) await enable()
      else await disable()
      setAutostart(value)
      showToast(
        value ? t('settings.messages.autostartOn') : t('settings.messages.autostartOff'),
      )
    } catch {
      showToast(t('settings.messages.setFailed'), 'error')
    } finally {
      setAutostartLoading(false)
    }
  }

  const toggleSilentStart = async (value: boolean) => {
    setSilentLoading(true)
    try {
      await setSilentStart(value)
      setSilentStartEnabled(value)
      showToast(value ? t('settings.messages.silentOn') : t('settings.messages.silentOff'))
    } catch {
      showToast(t('settings.messages.setFailed'), 'error')
    } finally {
      setSilentLoading(false)
    }
  }

  const toggleLightweight = async (value: boolean) => {
    setLightweightLoading(true)
    try {
      await setLightweightMode(value)
      setLightweightModeEnabled(value)
      showToast(t('settings.messages.saved'))
    } catch {
      showToast(t('settings.messages.setFailed'), 'error')
    } finally {
      setLightweightLoading(false)
    }
  }

  const changeUpdateSource = async (value: string) => {
    const next = value as UpdateSourceId
    if (!UPDATE_SOURCE_IDS.includes(next)) return
    const previous = updateSource
    setUpdateSourceLoading(true)
    setUpdateSourceState(next)
    try {
      await setUpdateSource(next)
    } catch (error) {
      setUpdateSourceState(previous)
      showToast(t('settings.messages.saveFailed'), 'error')
      console.error(error)
    } finally {
      setUpdateSourceLoading(false)
    }
  }

  const checkUpdate = async () => {
    setUpdateLoading(true)
    try {
      const update = await checkAppUpdate({ timeout: 10000, source: updateSource })
      if (update) {
        setUpdateInfo({ available: true, version: update.version, body: update.body || '' })
        showToast(t('settings.update.newVersion', { version: update.version }), 'info')
      } else {
        setUpdateInfo({ available: false })
        showToast(t('settings.messages.noUpdate'))
      }
    } catch (error) {
      showToast(t('settings.messages.checkFailed'), 'error')
      console.error(error)
    } finally {
      setUpdateLoading(false)
    }
  }

  const installUpdate = async () => {
    setUpdateInstalling(true)
    setDownloadProgress(0)
    try {
      const update = await checkAppUpdate({ timeout: 10000, source: updateSource })
      if (!update) {
        showToast(t('settings.messages.noUpdateFound'), 'warning')
        return
      }
      let total = 0
      let received = 0
      await installAppUpdate(update, updateSource, (event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength || 0
            received = 0
            setDownloadProgress(0)
            break
          case 'Progress':
            received += event.data.chunkLength
            if (total > 0) setDownloadProgress(Math.round((received / total) * 100))
            break
          case 'Finished':
            setDownloadProgress(100)
            break
        }
      })
      showToast(t('settings.messages.installSuccess'))
      await relaunch()
    } catch (error) {
      showToast(t('settings.messages.updateFailed'), 'error')
      console.error(error)
    } finally {
      setUpdateInstalling(false)
    }
  }

  const themeOptions = [
    { label: t('settings.theme.system'), value: 'system' },
    { label: t('settings.theme.light'), value: 'light' },
    { label: t('settings.theme.dark'), value: 'dark' },
  ]

  const localeOptions = [
    { label: '简体中文', value: 'zh-CN' },
    { label: 'English', value: 'en-US' },
  ]

  const updateSourceOptions = [
    { label: t('settings.update.sourceAuto'), value: 'auto' },
    { label: t('settings.update.sourceGhfast'), value: 'ghfast' },
    { label: t('settings.update.sourceGhddlc'), value: 'ghddlc' },
    { label: t('settings.update.sourceGhproxy'), value: 'ghproxy' },
    { label: t('settings.update.sourceGithub'), value: 'github' },
  ]

  return (
    <div className="ct-settings-card">
      <div className="ct-settings-card-label">{t('settings.groups.system')}</div>

      <SettingRow title={t('settings.language.title')} desc={t('settings.language.desc')}>
        <Select.Root
          value={locale}
          disabled={localeLoading || !ready}
          onValueChange={(value) => void changeLocale(value)}
        >
          <Select.Trigger
            style={{ width: '10rem' }}
            aria-label={t('settings.language.title')}
          />
          <Select.Content>
            {localeOptions.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingRow>

      <SettingRow title={t('settings.theme.title')} desc={t('settings.theme.desc')}>
        <Select.Root value={themeMode} onValueChange={changeTheme}>
          <Select.Trigger style={{ width: '10rem' }} aria-label={t('settings.theme.title')} />
          <Select.Content>
            {themeOptions.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingRow>

      <div className="ct-settings-divider" />

      <SettingRow
        title={t('settings.startup.autostartTitle')}
        desc={t('settings.startup.autostartDesc')}
      >
        <Switch
          checked={autostart}
          disabled={autostartLoading || !ready}
          aria-label={t('settings.startup.autostartTitle')}
          onCheckedChange={(value) => void toggleAutostart(value)}
        />
      </SettingRow>

      <div className="ct-settings-divider" />

      <SettingRow
        title={t('settings.startup.silentStartTitle')}
        desc={t('settings.startup.silentStartDesc')}
      >
        <Switch
          checked={silentStart}
          disabled={!autostart || silentLoading || !ready}
          aria-label={t('settings.startup.silentStartTitle')}
          onCheckedChange={(value) => void toggleSilentStart(value)}
        />
      </SettingRow>

      <div className="ct-settings-divider" />

      <SettingRow title={t('settings.lightweight.title')} desc={t('settings.lightweight.desc')}>
        <Switch
          checked={lightweightMode}
          disabled={lightweightLoading || !ready}
          aria-label={t('settings.lightweight.title')}
          onCheckedChange={(value) => void toggleLightweight(value)}
        />
      </SettingRow>

      <div className="ct-settings-divider" />

      <SettingRow title={t('settings.update.softwareVersion')} desc={appVersion || '...'}>
        <Button
          size="2"
          variant="soft"
          color="gray"
          disabled={updateLoading || updateInstalling}
          onClick={() => void checkUpdate()}
        >
          {t('settings.update.checkUpdate')}
        </Button>
      </SettingRow>

      {updateInfo?.available && (
        <>
          <div className="ct-settings-divider" />
          <div className="ct-settings-update">
            <div className="ct-settings-update-head">
              <div className="ct-settings-update-title">
                {t('settings.update.newVersion', { version: updateInfo.version ?? '' })}
              </div>
              <Select.Root
                value={updateSource}
                disabled={updateInstalling || updateSourceLoading}
                onValueChange={(value) => void changeUpdateSource(value)}
              >
                <Select.Trigger
                  style={{ width: '8.75rem' }}
                  aria-label={t('settings.update.sourceTitle')}
                />
                <Select.Content>
                  {updateSourceOptions.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>

            {updateInfo.body && <div className="ct-settings-update-body">{updateInfo.body}</div>}

            <Button disabled={updateInstalling} onClick={() => void installUpdate()}>
              {updateInstalling
                ? t('settings.update.downloading')
                : t('settings.update.updateNow')}
            </Button>

            {updateInstalling && (
              <div className="ct-settings-download">
                <Progress value={downloadProgress} size="1" />
                <span className="ct-settings-download-text">{downloadProgress}%</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
