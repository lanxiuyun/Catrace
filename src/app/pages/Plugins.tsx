import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Card,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Tabs,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import {
  Armchair,
  ChartColumn,
  CircleHelp,
  Info,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import {
  getConfig,
  getFullscreenSettings,
  getReminderMode,
  getReminderText,
  getTodayRecords,
  setConfig,
  setFullscreenSettings,
  setReminderMode,
  setReminderText,
  setRestPluginEnabled,
  testNotification,
  type AppConfig,
} from '../../api/tauri'
import { useT } from '../i18n'
import { useShellStore } from '../store'
import { RadixPage } from '../components/RadixPage'
import './plugins.css'

type TabValue = 'settings' | 'activity' | 'about'
type ReminderMode = 'toast' | 'fullscreen'

interface FullscreenState {
  bg: string
  opacity: number
  fitMode: string
}

interface LogEntry {
  id: number
  time: string
  text: string
}

const DEFAULT_CONFIG: AppConfig = {
  enabled: true,
  window_minutes: 45,
  break_minutes: 5,
  snooze_interval_minutes: 3,
}
const DEFAULT_FULLSCREEN: FullscreenState = { bg: '', opacity: 80, fitMode: 'contain' }
const DEFAULTS_TEXT = { title: '', body: '' }
const SAVE_DEBOUNCE_MS = 500

/**
 * 插件中心（React 版，替代 views/mainWindow/Plugins.vue + components/plugins/RestPluginPanel.vue）。
 * 设计对齐 catrace-ui-concept.html；迁移期只展示内置「久坐提醒」。
 */
export function Plugins() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)

  const [tab, setTab] = useState<TabValue>('settings')
  const [config, setConfigState] = useState<AppConfig>(DEFAULT_CONFIG)
  const [mode, setModeState] = useState<ReminderMode>('toast')
  const [fullscreen, setFullscreenState] = useState<FullscreenState>(DEFAULT_FULLSCREEN)
  const [text, setTextState] = useState(DEFAULTS_TEXT)
  const [records, setRecords] = useState<Map<number, boolean>>(() => new Map())
  const [status, setStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [query, setQuery] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])

  const timers = useRef<{
    config?: ReturnType<typeof setTimeout>
    fullscreen?: ReturnType<typeof setTimeout>
    text?: ReturnType<typeof setTimeout>
  }>({})

  const enabled = config.enabled ?? true

  const pushLog = useCallback(
    (message: string) => {
      setLog((previous) =>
        [{ id: Date.now(), time: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }), text: message }, ...previous].slice(0, 30),
      )
    },
    [locale],
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [nextConfig, nextMode, nextFullscreen, nextText, rawRecords] = await Promise.all([
          getConfig(),
          getReminderMode(),
          getFullscreenSettings(),
          getReminderText(),
          getTodayRecords(),
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
        const map = new Map<number, boolean>()
        for (const [ts, active] of rawRecords) map.set(ts, active)
        setRecords(map)
      } catch (error) {
        console.error('Failed to load rest plugin settings', error)
        setStatus(t('settings.messages.loadFailed'))
      }
    })()
    return () => {
      alive = false
      for (const timer of Object.values(timers.current)) if (timer) clearTimeout(timer)
    }
  }, [t])

  const saveConfig = async (next: AppConfig) => {
    try {
      await setConfig({
        window_minutes: next.window_minutes,
        break_minutes: next.break_minutes,
        snooze_interval_minutes: next.snooze_interval_minutes,
      })
      setStatus(t('settings.messages.saved'))
      pushLog(t('settings.messages.saved'))
    } catch {
      setStatus(t('settings.messages.saveFailed'))
    }
  }

  const saveFullscreen = async (next: FullscreenState) => {
    try {
      await setFullscreenSettings(next.bg, next.opacity, next.fitMode, '')
      setStatus(t('settings.messages.saved'))
    } catch {
      setStatus(t('settings.messages.saveFailed'))
    }
  }

  const saveText = async (next: { title: string; body: string }) => {
    try {
      await setReminderText(next.title, next.body)
      setStatus(t('settings.messages.saved'))
    } catch {
      setStatus(t('settings.messages.saveFailed'))
    }
  }

  const updateConfig = (patch: Partial<AppConfig>) => {
    const next = { ...config, ...patch }
    setConfigState(next)
    if (timers.current.config) clearTimeout(timers.current.config)
    timers.current.config = setTimeout(() => void saveConfig(next), SAVE_DEBOUNCE_MS)
  }

  const updateFullscreen = (patch: Partial<FullscreenState>) => {
    const next = { ...fullscreen, ...patch }
    setFullscreenState(next)
    if (timers.current.fullscreen) clearTimeout(timers.current.fullscreen)
    timers.current.fullscreen = setTimeout(() => void saveFullscreen(next), SAVE_DEBOUNCE_MS)
  }

  const updateText = (patch: Partial<typeof DEFAULTS_TEXT>) => {
    const next = { ...text, ...patch }
    setTextState(next)
    if (timers.current.text) clearTimeout(timers.current.text)
    timers.current.text = setTimeout(() => void saveText(next), SAVE_DEBOUNCE_MS)
  }

  const toggleEnabled = async (value: boolean) => {
    const previous = enabled
    setConfigState({ ...config, enabled: value })
    window.dispatchEvent(
      new CustomEvent('catrace:plugin-enabled-changed', { detail: { id: 'rest', enabled: value } }),
    )
    try {
      await setRestPluginEnabled(value)
      setStatus(t('settings.messages.saved'))
      pushLog(`${t('plugins.rest.name')} · ${value ? t('pluginsCenter.enabled') : t('pluginsCenter.disabled')}`)
    } catch {
      setConfigState({ ...config, enabled: previous })
      window.dispatchEvent(
        new CustomEvent('catrace:plugin-enabled-changed', {
          detail: { id: 'rest', enabled: previous },
        }),
      )
      setStatus(t('settings.messages.saveFailed'))
    }
  }

  const changeMode = async (value: string) => {
    const next: ReminderMode = value === 'fullscreen' ? 'fullscreen' : 'toast'
    setModeState(next)
    try {
      await setReminderMode(next)
      setStatus(t('settings.messages.saved'))
      pushLog(next === 'fullscreen' ? t('plugins.rest.modeFullscreen') : t('plugins.rest.modeToast'))
    } catch {
      setStatus(t('settings.messages.saveFailed'))
    }
  }

  const sendTest = async () => {
    if (testing) return
    setTesting(true)
    try {
      await testNotification()
      setStatus(t('settings.messages.notifySent'))
      pushLog(t('settings.messages.notifySent'))
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    } catch {
      setStatus(t('settings.messages.notifyFailed'))
    } finally {
      setTesting(false)
    }
  }

  const saveNow = async () => {
    for (const timer of Object.values(timers.current)) if (timer) clearTimeout(timer)
    await Promise.all([saveConfig(config), saveFullscreen(fullscreen), saveText(text)])
  }

  const resetDefaults = async () => {
    for (const timer of Object.values(timers.current)) if (timer) clearTimeout(timer)
    setConfigState(DEFAULT_CONFIG)
    setModeState('toast')
    setFullscreenState(DEFAULT_FULLSCREEN)
    setTextState(DEFAULTS_TEXT)
    try {
      await Promise.all([
        setConfig({
          window_minutes: DEFAULT_CONFIG.window_minutes,
          break_minutes: DEFAULT_CONFIG.break_minutes,
          snooze_interval_minutes: DEFAULT_CONFIG.snooze_interval_minutes,
        }),
        setReminderMode('toast'),
        setFullscreenSettings('', DEFAULT_FULLSCREEN.opacity, DEFAULT_FULLSCREEN.fitMode, ''),
        setReminderText('', ''),
      ])
      setStatus(t('settings.messages.saved'))
      pushLog(t('pluginsCenter.reset'))
    } catch {
      setStatus(t('settings.messages.saveFailed'))
    }
  }

  const handleBgFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => updateFullscreen({ bg: String(reader.result ?? '') })
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const todayActive = [...records.values()].filter(Boolean).length
  const todayTotal = records.size
  const todayRest = todayTotal - todayActive
  const activeRatio = todayTotal ? Math.round((todayActive / todayTotal) * 100) : 0

  const previewTitle = text.title || t('plugins.rest.previewDefaultTitle')
  const previewBody = text.body || t('plugins.rest.previewDefaultBody')
  const matchesQuery =
    query.trim() === '' ||
    `${t('plugins.rest.name')} ${t('plugins.rest.listSubtitle')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())

  return (
    <RadixPage className="ct-plugins-page">
      <div className="ct-plugins">
        <aside className="ct-plugin-list" aria-label={t('plugins.listHeading')}>
          <div className="ct-plugin-list-head">
            <h1>{t('plugins.centerTitle')}</h1>
            <span>{t('pluginsCenter.installed', { n: 1 })}</span>
          </div>

          <TextField.Root
            size="2"
            placeholder={t('pluginsCenter.searchPlaceholder')}
            aria-label={t('pluginsCenter.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          >
            <TextField.Slot>
              <Search size={15} aria-hidden="true" />
            </TextField.Slot>
          </TextField.Root>

          <div className="ct-plugin-categories" role="group" aria-label={t('plugins.listHeading')}>
            <button type="button" aria-pressed="true">
              {t('pluginsCenter.all')}
            </button>
            <button type="button" aria-pressed="false">
              {t('pluginsCenter.categoryHealth')}
            </button>
          </div>

          <div className="ct-plugin-list-meta">
            <span>
              {t('pluginsCenter.installed', { n: matchesQuery ? 1 : 0 })} · {matchesQuery ? 1 : 0} / 1
            </span>
            <span>{enabled ? t('pluginsCenter.enabled') : t('pluginsCenter.disabled')}</span>
          </div>

          <div className="ct-plugin-rows">
            {matchesQuery ? (
              <div className="ct-plugin-row is-selected">
                <span className="ct-plugin-icon">
                  <Armchair size={20} aria-hidden="true" />
                </span>
                <div className="ct-plugin-row-copy">
                  <strong>{t('plugins.rest.name')}</strong>
                  <span>{t('plugins.rest.listSubtitle')}</span>
                  <span className="ct-plugin-row-meta">
                    {t('pluginsCenter.categoryHealth')} ·{' '}
                    {enabled ? t('pluginsCenter.enabled') : t('pluginsCenter.disabled')}
                  </span>
                </div>
                <Switch
                  size="1"
                  checked={enabled}
                  aria-label={t('plugins.rest.switchAria')}
                  onCheckedChange={(value) => void toggleEnabled(value)}
                />
              </div>
            ) : (
              <div className="ct-plugin-empty">
                <Search size={20} aria-hidden="true" />
                <p>{t('pluginsCenter.searchPlaceholder')}</p>
              </div>
            )}
          </div>

          <div className="ct-plugin-list-foot">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{t('pluginsCenter.localData')}</span>
          </div>
        </aside>

        <section className="ct-plugin-detail" aria-label={t('plugins.rest.name')}>
          <div className="ct-plugin-detail-scroll">
            <div className="ct-detail-content">
            <header className="ct-plugin-identity">
              <span className="ct-plugin-hero">
                <Armchair size={26} aria-hidden="true" />
              </span>
              <div className="ct-plugin-identity-copy">
                <div className="ct-plugin-title-line">
                  <h2>{t('plugins.rest.name')}</h2>
                  <Badge color="iris" size="1">
                    {t('pluginsCenter.categoryHealth')}
                  </Badge>
                </div>
                <p>{t('plugins.rest.subtitle')}</p>
                <div className="ct-plugin-meta">
                  <span>{t('pluginsCenter.builtin')}</span>
                  <span>·</span>
                  <span>{enabled ? t('pluginsCenter.enabled') : t('pluginsCenter.disabled')}</span>
                </div>
              </div>
              <label className="ct-plugin-enable">
                <span>{t('pluginsCenter.enableLabel')}</span>
                <Switch
                  checked={enabled}
                  aria-label={t('pluginsCenter.enableLabel')}
                  onCheckedChange={(value) => void toggleEnabled(value)}
                />
              </label>
            </header>

            <Tabs.Root value={tab} onValueChange={(value) => setTab(value as TabValue)}>
              <Tabs.List className="ct-plugin-tabs" aria-label={t('plugins.rest.name')}>
                <Tabs.Trigger value="settings">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  {t('pluginsCenter.tabsSettings')}
                </Tabs.Trigger>
                <Tabs.Trigger value="activity">
                  <ChartColumn size={14} aria-hidden="true" />
                  {t('pluginsCenter.tabsActivity')}
                </Tabs.Trigger>
                <Tabs.Trigger value="about">
                  <CircleHelp size={14} aria-hidden="true" />
                  {t('pluginsCenter.tabsAbout')}
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="settings">
                <Card className="ct-panel" variant="surface">
                  <div className="ct-panel-head">
                    <h3>{t('plugins.rest.timingSection')}</h3>
                    <span>{t('plugins.rest.timingSectionDesc')}</span>
                  </div>
                  <SettingRow
                    title={t('plugins.rest.windowTitle')}
                    description={t('plugins.rest.windowDesc')}
                    control={
                      <div className="ct-slider-row">
                        <Slider
                          size="2"
                          min={10}
                          max={120}
                          step={5}
                          value={[config.window_minutes]}
                          onValueChange={(value) => updateConfig({ window_minutes: value[0] })}
                        />
                        <span>
                          {config.window_minutes} {t('common.minutes')}
                        </span>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('plugins.rest.breakTitle')}
                    description={t('plugins.rest.breakDesc')}
                    control={
                      <div className="ct-slider-row">
                        <Slider
                          size="2"
                          min={1}
                          max={30}
                          step={1}
                          value={[config.break_minutes]}
                          onValueChange={(value) => updateConfig({ break_minutes: value[0] })}
                        />
                        <span>
                          {config.break_minutes} {t('common.minutes')}
                        </span>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('plugins.rest.snoozeTitle')}
                    description={t('plugins.rest.snoozeDesc')}
                    control={
                      <div className="ct-slider-row">
                        <Slider
                          size="2"
                          min={1}
                          max={10}
                          step={1}
                          value={[config.snooze_interval_minutes]}
                          onValueChange={(value) =>
                            updateConfig({ snooze_interval_minutes: value[0] })
                          }
                        />
                        <span>
                          {config.snooze_interval_minutes} {t('common.minutes')}
                        </span>
                      </div>
                    }
                  />
                </Card>

                <Card className="ct-panel" variant="surface">
                  <div className="ct-panel-head">
                    <h3>{t('plugins.rest.methodSection')}</h3>
                  </div>
                  <SettingRow
                    title={t('plugins.rest.modeTitle')}
                    description={t('plugins.rest.modeDesc')}
                    control={
                      <SegmentedControl.Root
                        value={mode}
                        size="1"
                        variant="classic"
                        onValueChange={(value) => void changeMode(value)}
                      >
                        <SegmentedControl.Item value="toast">
                          {t('plugins.rest.modeToast')}
                        </SegmentedControl.Item>
                        <SegmentedControl.Item value="fullscreen">
                          {t('plugins.rest.modeFullscreen')}
                        </SegmentedControl.Item>
                      </SegmentedControl.Root>
                    }
                  />
                  {mode === 'fullscreen' && (
                    <>
                      <SettingRow
                        title={t('plugins.rest.fullscreenBgTitle')}
                        description={t('plugins.rest.fullscreenBgDesc')}
                        control={
                          <div className="ct-fs-bg">
                            {fullscreen.bg ? (
                              <div className="ct-fs-bg-preview">
                                <img src={fullscreen.bg} alt="" />
                                <label className="ct-fs-btn">
                                  {t('plugins.rest.changeBg')}
                                  <input type="file" accept="image/*" hidden onChange={handleBgFile} />
                                </label>
                                <button
                                  type="button"
                                  className="ct-fs-btn is-danger"
                                  onClick={() => updateFullscreen({ bg: '' })}
                                >
                                  {t('plugins.rest.clearBg')}
                                </button>
                              </div>
                            ) : (
                              <label className="ct-fs-bg-empty">
                                <input type="file" accept="image/*" hidden onChange={handleBgFile} />
                                <span>{t('plugins.rest.fullscreenBgDesc')}</span>
                              </label>
                            )}
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('plugins.rest.fullscreenOpacityTitle')}
                        description={t('plugins.rest.fullscreenOpacityDesc')}
                        control={
                          <div className="ct-slider-row">
                            <Slider
                              size="2"
                              min={0}
                              max={100}
                              step={5}
                              value={[fullscreen.opacity]}
                              onValueChange={(value) =>
                                updateFullscreen({ opacity: value[0] })
                              }
                            />
                            <span>{fullscreen.opacity}%</span>
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('plugins.rest.fullscreenFitModeTitle')}
                        description={t('plugins.rest.fullscreenFitModeDesc')}
                        control={
                          <Select.Root
                            value={fullscreen.fitMode}
                            onValueChange={(value) => updateFullscreen({ fitMode: value })}
                          >
                            <Select.Trigger aria-label={t('plugins.rest.fullscreenFitModeTitle')} />
                            <Select.Content>
                              <Select.Item value="contain">
                                {t('plugins.rest.fitContain')}
                              </Select.Item>
                              <Select.Item value="cover">{t('plugins.rest.fitCover')}</Select.Item>
                              <Select.Item value="fill">{t('plugins.rest.fitFill')}</Select.Item>
                            </Select.Content>
                          </Select.Root>
                        }
                      />
                    </>
                  )}
                </Card>

                <Card className="ct-panel" variant="surface">
                  <div className="ct-panel-head">
                    <h3>{t('plugins.rest.contentSection')}</h3>
                    <span>{t('plugins.rest.contentSectionDesc')}</span>
                  </div>
                  <SettingRow
                    title={t('plugins.rest.customTitle')}
                    description={t('plugins.rest.customTitleDesc')}
                    control={
                      <TextField.Root
                        size="2"
                        value={text.title}
                        placeholder={t('plugins.rest.previewDefaultTitle')}
                        aria-label={t('plugins.rest.customTitle')}
                        onChange={(event) => updateText({ title: event.target.value })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('plugins.rest.customBody')}
                    description={t('plugins.rest.customBodyDesc')}
                    control={
                      <TextArea
                        size="2"
                        rows={2}
                        value={text.body}
                        placeholder={t('plugins.rest.previewDefaultBody')}
                        aria-label={t('plugins.rest.customBody')}
                        onChange={(event) => updateText({ body: event.target.value })}
                      />
                    }
                  />
                </Card>

                <div className="ct-preview-banner">
                  <div className="ct-preview-copy">
                    <Info size={17} aria-hidden="true" />
                    <div>
                      <p>{t('plugins.rest.disabledHint')}</p>
                      <small>{t('plugins.rest.badge')}</small>
                    </div>
                  </div>
                  <Button disabled={!enabled || testing} onClick={() => void sendTest()}>
                    <Play size={14} aria-hidden="true" />
                    {t('plugins.rest.testBtn')}
                  </Button>
                </div>

                <div className="ct-notification-sample">
                  <div className="ct-notification-sample-label">
                    <span>{t('plugins.rest.testBtn')}</span>
                    <span>{enabled ? t('pluginsCenter.enabled') : t('pluginsCenter.disabled')}</span>
                  </div>
                  <div className="ct-notification-card">
                    <span className="ct-plugin-icon">
                      <Armchair size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <div className="ct-notification-title">
                        <strong>{previewTitle}</strong>
                        <small>Catrace</small>
                      </div>
                      <p>{previewBody}</p>
                    </div>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="activity">
                <div className="ct-stats">
                  <div className="ct-stat">
                    <span>{t('pluginsCenter.todayActive')}</span>
                    <strong>{todayActive}</strong>
                    <small>{t('common.minutes')}</small>
                  </div>
                  <div className="ct-stat">
                    <span>{t('pluginsCenter.todayRest')}</span>
                    <strong>{todayRest}</strong>
                    <small>{t('common.minutes')}</small>
                  </div>
                  <div className="ct-stat">
                    <span>{t('pluginsCenter.activeRatio')}</span>
                    <strong>{activeRatio}</strong>
                    <small>%</small>
                  </div>
                </div>

                <Card className="ct-panel" variant="surface">
                  <div className="ct-panel-head">
                    <h3>{t('pluginsCenter.actionLog')}</h3>
                    <span>{log.length}</span>
                  </div>
                  {log.length ? (
                    <ol className="ct-log-list">
                      {log.map((entry) => (
                        <li key={entry.id}>
                          <time>{entry.time}</time>
                          <span>{entry.text}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="ct-empty">{t('pluginsCenter.emptyLog')}</p>
                  )}
                </Card>
              </Tabs.Content>

              <Tabs.Content value="about">
                <Card className="ct-panel" variant="surface">
                  <div className="ct-panel-head">
                    <h3>{t('pluginsCenter.tabsAbout')}</h3>
                  </div>
                  <dl className="ct-about-grid">
                    <div>
                      <dt>{t('plugins.rest.name')}</dt>
                      <dd>rest</dd>
                    </div>
                    <div>
                      <dt>{t('pluginsCenter.builtin')}</dt>
                      <dd>{t('pluginsCenter.categoryHealth')}</dd>
                    </div>
                    <div>
                      <dt>{t('pluginsCenter.tabsSettings')}</dt>
                      <dd>React · Radix · Lucide</dd>
                    </div>
                  </dl>
                  <div className="ct-permission">
                    <ShieldAlert size={20} aria-hidden="true" />
                    <div>
                      <h4>{t('pluginsCenter.permissionTitle')}</h4>
                      <p>{t('pluginsCenter.permissionDesc')}</p>
                    </div>
                  </div>
                  <div className="ct-boundary">
                    <h4>{t('pluginsCenter.boundaryTitle')}</h4>
                    <p>{t('pluginsCenter.boundaryDesc')}</p>
                  </div>
                </Card>
              </Tabs.Content>
            </Tabs.Root>
            </div>
          </div>

          <footer className="ct-plugin-footer">
            <div className="ct-plugin-status" role="status">
              <span className={status === t('settings.messages.saveFailed') ? 'is-error' : ''} />
              {status ?? t('pluginsCenter.localData')}
            </div>
            <div className="ct-plugin-footer-actions">
              <Button variant="soft" color="gray" onClick={() => void resetDefaults()}>
                <RotateCcw size={14} aria-hidden="true" />
                {t('pluginsCenter.reset')}
              </Button>
              <Button onClick={() => void saveNow()}>{t('pluginsCenter.save')}</Button>
            </div>
          </footer>
        </section>
      </div>
    </RadixPage>
  )
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string
  description?: string
  control: ReactNode
}) {
  return (
    <div className="ct-setting-row">
      <div className="ct-setting-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="ct-setting-control">{control}</div>
    </div>
  )
}
