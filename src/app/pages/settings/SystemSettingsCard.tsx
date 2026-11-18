import { useEffect, useState } from 'react'
import { Button, ListBox, ProgressBar, Select, Switch } from '@heroui/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  checkAppUpdate,
  getLightweightMode,
  getSilentStart,
  installAppUpdate,
  setLightweightMode,
  setSilentStart,
} from '../../../api/tauri'
import { isLocaleKey, setAppLocale, useT } from '../../i18n'
import { useShellStore } from '../../store'
import { useAppUpdateStore } from '../../../stores/appUpdate'
import { showToast } from '../../ui/toast'
import { useTheme } from '../../../composables/useTheme'
import { SettingRow } from './SettingRow'
import { SettingsCard } from './SettingsCard'

interface UpdateInfo {
  available: boolean
  version?: string
  body?: string
}

const RELEASE_NOTES_URL = 'https://lanxiuyun.github.io/Catrace/latest/'

/**
 * 「系统」设置卡：
 * 语言 / 外观主题 / 开机自启 / 静默启动 / 轻量模式 / 软件更新。
 */
export function SystemSettingsCard() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)
  const { mode: themeMode, setMode: setThemeMode } = useTheme()

  const [autostart, setAutostart] = useState(false)
  const [silentStart, setSilentStartEnabled] = useState(false)
  const [lightweightMode, setLightweightModeEnabled] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const updateNotice = useAppUpdateStore((state) => state.notice)
  const setUpdateNotice = useAppUpdateStore((state) => state.setNotice)

  const [autostartLoading, setAutostartLoading] = useState(false)
  const [silentLoading, setSilentLoading] = useState(false)
  const [lightweightLoading, setLightweightLoading] = useState(false)
  const [localeLoading, setLocaleLoading] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [nextAutostart, nextSilent, version, lightweight] =
          await Promise.all([
            isEnabled(),
            getSilentStart(),
            getVersion(),
            getLightweightMode(),
          ])
        if (!alive) return
        setAutostart(nextAutostart)
        setSilentStartEnabled(nextSilent)
        setLightweightModeEnabled(lightweight)
        setAppVersion(version)
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

  // 自动检查（主窗外壳）可能先于设置页加载：把 store 里的新版本同步进来，
  // 版本行和更新面板不用点「检查更新」就能显示新版本信息。
  useEffect(() => {
    if (!updateNotice) return
    setUpdateInfo({ available: true, version: updateNotice.version, body: updateNotice.body })
  }, [updateNotice])

  const changeLocale = async (value: string) => {
    if (!ready || value === locale || !isLocaleKey(value)) return
    setLocaleLoading(true)
    try {
      await setAppLocale(value)
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
    } catch {
      showToast(t('settings.messages.setFailed'), 'error')
    } finally {
      setLightweightLoading(false)
    }
  }

  const checkUpdate = async () => {
    setUpdateLoading(true)
    try {
      const update = await checkAppUpdate({ timeout: 10000 })
      if (update) {
        const body = update.body || ''
        setUpdateInfo({ available: true, version: update.version, body })
        setUpdateNotice({ version: update.version, body })
        showToast(t('settings.update.newVersion', { version: update.version }), 'info')
      } else {
        setUpdateInfo({ available: false })
        setUpdateNotice(null)
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
      const update = await checkAppUpdate({ timeout: 10000 })
      if (!update) {
        showToast(t('settings.messages.noUpdateFound'), 'warning')
        return
      }
      let total = 0
      let received = 0
      await installAppUpdate(update, undefined, (event) => {
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


  return (
    <SettingsCard label={t('settings.groups.system')}>
      <SettingRow title={t('settings.language.title')} desc={t('settings.language.desc')}>
        <Select
          className="w-40"
          variant="secondary"
          value={locale}
          isDisabled={localeLoading || !ready}
          onChange={(value) => { if (value != null) void changeLocale(String(value)) }}
        >
          <Select.Trigger aria-label={t('settings.language.title')}>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {localeOptions.map((option) => (
                <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </SettingRow>

      <SettingRow title={t('settings.theme.title')} desc={t('settings.theme.desc')}>
        <Select
          className="w-40"
          variant="secondary"
          value={themeMode}
          onChange={(value) => { if (value != null) changeTheme(String(value)) }}
        >
          <Select.Trigger aria-label={t('settings.theme.title')}>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {themeOptions.map((option) => (
                <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </SettingRow>

      <SettingRow
        title={t('settings.startup.autostartTitle')}
        desc={t('settings.startup.autostartDesc')}
      >
        <Switch
          isSelected={autostart}
          isDisabled={autostartLoading || !ready}
          aria-label={t('settings.startup.autostartTitle')}
          onChange={(value) => void toggleAutostart(value)}
        >
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch.Content>
        </Switch>
      </SettingRow>

      <SettingRow
        title={t('settings.startup.silentStartTitle')}
        desc={t('settings.startup.silentStartDesc')}
      >
        <Switch
          isSelected={silentStart}
          isDisabled={!autostart || silentLoading || !ready}
          aria-label={t('settings.startup.silentStartTitle')}
          onChange={(value) => void toggleSilentStart(value)}
        >
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch.Content>
        </Switch>
      </SettingRow>

      <SettingRow title={t('settings.lightweight.title')} desc={t('settings.lightweight.desc')}>
        <Switch
          isSelected={lightweightMode}
          isDisabled={lightweightLoading || !ready}
          aria-label={t('settings.lightweight.title')}
          onChange={(value) => void toggleLightweight(value)}
        >
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch.Content>
        </Switch>
      </SettingRow>

      <div className="ct-settings-update-row">
        <SettingRow
          title={t('settings.update.softwareVersion')}
          desc={updateInfo?.available && updateInfo.version
            ? `${appVersion || '...'} → ${updateInfo.version}`
            : appVersion || '...'}
        >
          <Button
            size="sm"
            variant={updateInfo?.available ? 'primary' : 'tertiary'}
            isDisabled={updateLoading || updateInstalling}
            onClick={() => void (updateInfo?.available ? installUpdate() : checkUpdate())}
          >
            {updateInstalling
              ? t('settings.update.downloading')
              : updateInfo?.available
                ? t('settings.update.updateNow')
                : t('settings.update.checkUpdate')}
          </Button>
        </SettingRow>
        {updateInfo?.available && (
          <div className="ct-settings-release-notes">
            <iframe
              className="ct-settings-release-notes-frame"
              src={RELEASE_NOTES_URL}
              title="Catrace 官网版本更新说明"
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-same-origin allow-scripts"
            />
            <button
              className="ct-settings-release-notes-link"
              type="button"
              onClick={() => void openUrl(RELEASE_NOTES_URL).catch((error) => console.warn('[update] open release notes failed', error))}
            >
              {t('settings.update.openReleaseNotes')}
            </button>
          </div>
        )}
        {updateInstalling && (
          <div className="ct-settings-download">
            <ProgressBar value={downloadProgress}>
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
            <span className="ct-settings-download-text">{downloadProgress}%</span>
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
