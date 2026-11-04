import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@radix-ui/themes'
import {
  getConfig, getFullscreenSettings, getReminderMode, getReminderText, setConfig,
  setFullscreenSettings, setReminderMode, setReminderText, setRestPluginEnabled,
  testNotification, type AppConfig,
} from '../../api/tauri'
import { useT } from '../i18n'
import { showToast } from '../ui/toast'
import { PluginCenter } from './plugins/PluginCenter'
import {
  RestSettings, type FullscreenState, type ReminderMode, type ReminderText,
} from './plugins/RestSettings'
import './plugins.css'

const SAVE_DEBOUNCE_MS = 500
const DEFAULT_CONFIG: AppConfig = {
  enabled: true, window_minutes: 45, break_minutes: 5, snooze_interval_minutes: 3,
}
const DEFAULT_FULLSCREEN: FullscreenState = { bg: '', opacity: 80, fitMode: 'contain' }
const DEFAULT_TEXT: ReminderText = { title: '', body: '' }

/** The built-in reminder keeps its native React settings inside the plugin center. */
export function Plugins() {
  const t = useT()
  const [config, setConfigState] = useState<AppConfig>(DEFAULT_CONFIG)
  const [mode, setModeState] = useState<ReminderMode>('toast')
  const [fullscreen, setFullscreenState] = useState<FullscreenState>(DEFAULT_FULLSCREEN)
  const [text, setTextState] = useState<ReminderText>(DEFAULT_TEXT)
  const [testing, setTesting] = useState(false)
  const [restBusy, setRestBusy] = useState(true)
  const [restReady, setRestReady] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const restOperation = useRef(false)
  const timers = useRef<{
    config?: ReturnType<typeof setTimeout>
    fullscreen?: ReturnType<typeof setTimeout>
    text?: ReturnType<typeof setTimeout>
  }>({})
  const enabled = config.enabled ?? true

  useEffect(() => {
    let alive = true
    setRestBusy(true)
    setRestReady(false)
    setLoadError(false)
    void (async () => {
      try {
        const [nextConfig, nextMode, nextFullscreen, nextText] = await Promise.all([
          getConfig(), getReminderMode(), getFullscreenSettings(), getReminderText(),
        ])
        if (!alive) return
        setConfigState({
          enabled: nextConfig.enabled ?? true,
          window_minutes: Number(nextConfig.window_minutes) || 45,
          break_minutes: Number(nextConfig.break_minutes) || 5,
          snooze_interval_minutes: Number(nextConfig.snooze_interval_minutes) || 3,
        })
        setModeState(nextMode === 'fullscreen' ? 'fullscreen' : 'toast')
        setFullscreenState({
          bg: nextFullscreen.bg_image || '',
          opacity: Number(nextFullscreen.opacity) || 80,
          fitMode: nextFullscreen.fit_mode || 'contain',
        })
        setTextState({ title: nextText.title || '', body: nextText.body || '' })
        setRestReady(true)
      } catch (error) {
        if (!alive) return
        setLoadError(true)
        console.error('Failed to load rest plugin settings', error)
        showToast(t('settings.messages.loadFailed'), 'error')
      } finally {
        if (alive) setRestBusy(false)
      }
    })()
    return () => {
      alive = false
      // Flush the latest debounced changes rather than losing them on navigation.
      for (const timer of Object.values(timers.current)) if (timer) clearTimeout(timer)
      for (const save of Object.values(pendingSaves.current)) if (save) void save()
      pendingSaves.current = {}
    }
  }, [t, loadAttempt])

  const pendingSaves = useRef<Record<string, (() => Promise<void>) | undefined>>({})
  const debounceSave = (key: 'config' | 'fullscreen' | 'text', save: () => Promise<void>) => {
    if (timers.current[key]) clearTimeout(timers.current[key])
    pendingSaves.current[key] = save
    timers.current[key] = setTimeout(() => {
      delete pendingSaves.current[key]
      void save()
    }, SAVE_DEBOUNCE_MS)
  }

  const updateConfig = (patch: Partial<AppConfig>) => {
    const next = { ...config, ...patch }
    setConfigState(next)
    debounceSave('config', async () => {
      try {
        await setConfig({ window_minutes: next.window_minutes, break_minutes: next.break_minutes, snooze_interval_minutes: next.snooze_interval_minutes })
        showToast(t('settings.messages.saved'))
      } catch { showToast(t('settings.messages.saveFailed'), 'error') }
    })
  }
  const updateFullscreen = (patch: Partial<FullscreenState>) => {
    const next = { ...fullscreen, ...patch }
    setFullscreenState(next)
    debounceSave('fullscreen', async () => {
      try {
        await setFullscreenSettings(next.bg, next.opacity, next.fitMode, '')
        showToast(t('settings.messages.saved'))
      } catch { showToast(t('settings.messages.saveFailed'), 'error') }
    })
  }
  const updateText = (patch: Partial<ReminderText>) => {
    const next = { ...text, ...patch }
    setTextState(next)
    debounceSave('text', async () => {
      try {
        await setReminderText(next.title, next.body)
        showToast(t('settings.messages.saved'))
      } catch { showToast(t('settings.messages.saveFailed'), 'error') }
    })
  }
  const toggleRest = async (value: boolean) => {
    if (restOperation.current) return
    restOperation.current = true
    setRestBusy(true)
    try {
      await setRestPluginEnabled(value)
      setConfigState((previous) => ({ ...previous, enabled: value }))
      window.dispatchEvent(new CustomEvent('catrace:plugin-enabled-changed', { detail: { id: 'rest', enabled: value } }))
      showToast(t('settings.messages.saved'))
    } catch { showToast(t('settings.messages.saveFailed'), 'error') }
    finally { restOperation.current = false; setRestBusy(false) }
  }
  const changeMode = async (next: ReminderMode) => {
    const previous = mode
    setModeState(next)
    try { await setReminderMode(next); showToast(t('settings.messages.saved')) }
    catch { setModeState(previous); showToast(t('settings.messages.saveFailed'), 'error') }
  }
  const sendTest = async () => {
    if (testing) return
    setTesting(true)
    try { await testNotification(); showToast(t('pluginsCenter.testSent')) }
    catch { showToast(t('settings.messages.notifyFailed'), 'error') }
    finally { setTesting(false) }
  }
  const handleBgFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => updateFullscreen({ bg: String(reader.result ?? '') })
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  return (
    <PluginCenter restEnabled={enabled} restBusy={restBusy} restReady={restReady} onToggleRest={(value) => void toggleRest(value)}>
      {!restReady ? <div className="ct-market-settings-status" role={loadError ? 'alert' : 'status'}>
        <p>{t(loadError ? 'settings.messages.loadFailed' : 'pluginMarket.loadingSettings')}</p>
        {loadError && <Button variant="soft" onClick={() => setLoadAttempt((value) => value + 1)}>{t('pluginMarket.retry')}</Button>}
      </div> : <RestSettings
        enabled={enabled} config={config} mode={mode} fullscreen={fullscreen} text={text}
        testing={testing} onUpdateConfig={updateConfig} onUpdateFullscreen={updateFullscreen}
        onUpdateText={updateText} onChangeMode={(next) => void changeMode(next)}
        onBgFile={handleBgFile} onTest={() => void sendTest()}
      />}
    </PluginCenter>
  )
}
