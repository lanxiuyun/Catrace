import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  Badge,
  Button,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import { Armchair, Bell, Play, Search, ShieldCheck, Timer } from 'lucide-react'
import {
  getConfig,
  getFullscreenSettings,
  getReminderMode,
  getReminderText,
  setConfig,
  setFullscreenSettings,
  setReminderMode,
  setReminderText,
  setRestPluginEnabled,
  testNotification,
  type AppConfig,
} from '../../api/tauri'
import { useT } from '../i18n'
import { PageScroll } from '../components/PageScroll'
import { RadixPage } from '../components/RadixPage'
import './plugins.css'

type ReminderMode = 'toast' | 'fullscreen'

interface FullscreenState {
  bg: string
  opacity: number
  fitMode: string
}

interface PluginEntry {
  id: string
  /** i18n key：插件名 */
  name: string
  /** i18n key：列表里的一行说明 */
  subtitle: string
  icon: typeof Armchair
}

/**
 * 迁移期只放行内置「久坐提醒」（见 config/pluginScope.ts）。
 * 列表按数据渲染，外部插件在 M7 迁回时只需往这里加条目；
 * 条目 ≥3 才显示搜索框——单选列表配搜索是纯噪音。
 */
const PLUGINS: readonly PluginEntry[] = [
  { id: 'rest', name: 'plugins.rest.name', subtitle: 'plugins.rest.listSubtitle', icon: Armchair },
]

const SHOW_SEARCH_MIN_PLUGINS = 3
const SAVE_DEBOUNCE_MS = 500
const FLASH_MS = 1600

const DEFAULT_CONFIG: AppConfig = {
  enabled: true,
  window_minutes: 45,
  break_minutes: 5,
  snooze_interval_minutes: 3,
}
const DEFAULT_FULLSCREEN: FullscreenState = { bg: '', opacity: 80, fitMode: 'contain' }
const DEFAULT_TEXT = { title: '', body: '' }

interface Hint {
  text: string
  error: boolean
}

/**
 * 插件中心（React 版）：左侧插件列表 + 右侧详情。
 * 详情是「久坐提醒」的单页设置：提醒节奏 / 提醒方式与内容，改完即存，
 * 不再有页签、统计、关于页与固定底栏。
 */
export function Plugins() {
  const t = useT()

  const [config, setConfigState] = useState<AppConfig>(DEFAULT_CONFIG)
  const [mode, setModeState] = useState<ReminderMode>('toast')
  const [fullscreen, setFullscreenState] = useState<FullscreenState>(DEFAULT_FULLSCREEN)
  const [text, setTextState] = useState(DEFAULT_TEXT)
  const [testing, setTesting] = useState(false)
  const [hint, setHint] = useState<Hint | null>(null)
  const [query, setQuery] = useState('')

  const timers = useRef<{
    config?: ReturnType<typeof setTimeout>
    fullscreen?: ReturnType<typeof setTimeout>
    text?: ReturnType<typeof setTimeout>
    hint?: ReturnType<typeof setTimeout>
  }>({})

  const enabled = config.enabled ?? true

  const flash = useCallback((message: string, error = false) => {
    setHint({ text: message, error })
    if (timers.current.hint) clearTimeout(timers.current.hint)
    timers.current.hint = setTimeout(() => setHint(null), FLASH_MS)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [nextConfig, nextMode, nextFullscreen, nextText] = await Promise.all([
          getConfig(),
          getReminderMode(),
          getFullscreenSettings(),
          getReminderText(),
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
      } catch (error) {
        console.error('Failed to load rest plugin settings', error)
        flash(t('settings.messages.loadFailed'), true)
      }
    })()
    return () => {
      alive = false
      for (const timer of Object.values(timers.current)) if (timer) clearTimeout(timer)
    }
  }, [t, flash])

  const saveConfig = async (next: AppConfig) => {
    try {
      await setConfig({
        window_minutes: next.window_minutes,
        break_minutes: next.break_minutes,
        snooze_interval_minutes: next.snooze_interval_minutes,
      })
      flash(t('settings.messages.saved'))
    } catch {
      flash(t('settings.messages.saveFailed'), true)
    }
  }

  const saveFullscreen = async (next: FullscreenState) => {
    try {
      await setFullscreenSettings(next.bg, next.opacity, next.fitMode, '')
      flash(t('settings.messages.saved'))
    } catch {
      flash(t('settings.messages.saveFailed'), true)
    }
  }

  const saveText = async (next: { title: string; body: string }) => {
    try {
      await setReminderText(next.title, next.body)
      flash(t('settings.messages.saved'))
    } catch {
      flash(t('settings.messages.saveFailed'), true)
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

  const updateText = (patch: Partial<typeof DEFAULT_TEXT>) => {
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
      flash(t('settings.messages.saved'))
    } catch {
      setConfigState({ ...config, enabled: previous })
      window.dispatchEvent(
        new CustomEvent('catrace:plugin-enabled-changed', {
          detail: { id: 'rest', enabled: previous },
        }),
      )
      flash(t('settings.messages.saveFailed'), true)
    }
  }

  const changeMode = async (value: string) => {
    const next: ReminderMode = value === 'fullscreen' ? 'fullscreen' : 'toast'
    setModeState(next)
    try {
      await setReminderMode(next)
      flash(t('settings.messages.saved'))
    } catch {
      flash(t('settings.messages.saveFailed'), true)
    }
  }

  const sendTest = async () => {
    if (testing) return
    setTesting(true)
    try {
      await testNotification()
      flash(t('pluginsCenter.testSent'))
      await new Promise<void>((resolve) => setTimeout(resolve, 800))
    } catch {
      flash(t('settings.messages.notifyFailed'), true)
    } finally {
      setTesting(false)
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

  const showSearch = PLUGINS.length >= SHOW_SEARCH_MIN_PLUGINS
  const normalizedQuery = query.trim().toLowerCase()
  const visiblePlugins = showSearch
    ? PLUGINS.filter((plugin) =>
        `${t(plugin.name)} ${t(plugin.subtitle)}`.toLowerCase().includes(normalizedQuery),
      )
    : PLUGINS

  return (
    <PageScroll>
      <RadixPage className="ct-plugins-page">
        <div className="ct-plugins">
          <aside className="ct-plugin-list" aria-label={t('plugins.listHeading')}>
            <h1 className="ct-plugin-list-title">{t('plugins.centerTitle')}</h1>

            {showSearch && (
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
            )}

            <span className="ct-plugin-filter">{t('pluginsCenter.all')}</span>

            <div className="ct-plugin-rows">
              {visiblePlugins.map((plugin) => {
                const Icon = plugin.icon
                return (
                  <div key={plugin.id} className="ct-plugin-row is-selected">
                    <span className="ct-plugin-icon">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <div className="ct-plugin-row-copy">
                      <strong>{t(plugin.name)}</strong>
                      <span>{t(plugin.subtitle)}</span>
                    </div>
                    <Switch
                      size="2"
                      checked={enabled}
                      aria-label={t('plugins.rest.switchAria')}
                      onCheckedChange={(value) => void toggleEnabled(value)}
                    />
                  </div>
                )
              })}
              {!visiblePlugins.length && (
                <p className="ct-plugin-empty">{t('plugins.searchEmpty')}</p>
              )}
            </div>

            <div className="ct-plugin-list-foot">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>{t('pluginsCenter.localData')}</span>
            </div>
          </aside>

          <section className="ct-plugin-detail" aria-label={t('plugins.rest.name')}>
            <div className="ct-plugin-content">
              <header className="ct-plugin-identity">
                <span className="ct-plugin-hero">
                  <Armchair size={24} aria-hidden="true" />
                </span>
                <div className="ct-plugin-identity-copy">
                  <div className="ct-plugin-title-line">
                    <h2>{t('plugins.rest.name')}</h2>
                    <Badge color="iris" size="1">
                      {t('pluginsCenter.categoryHealth')}
                    </Badge>
                  </div>
                  <p>{t('plugins.rest.subtitle')}</p>
                </div>
                <div className="ct-plugin-actions">
                  <span
                    className={`ct-plugin-hint${hint ? ' is-visible' : ''}${
                      hint?.error ? ' is-error' : ''
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {hint?.text ?? ''}
                  </span>
                  <Button
                    variant="outline"
                    color="gray"
                    disabled={!enabled || testing}
                    onClick={() => void sendTest()}
                  >
                    <Play size={14} aria-hidden="true" />
                    {t('plugins.rest.testBtn')}
                  </Button>
                  <label className="ct-plugin-enable">
                    <span>{t('pluginsCenter.enableLabel')}</span>
                    <Switch
                      size="2"
                      checked={enabled}
                      aria-label={t('pluginsCenter.enableLabel')}
                      onCheckedChange={(value) => void toggleEnabled(value)}
                    />
                  </label>
                </div>
              </header>

              <section className="ct-plugin-card">
                <div className="ct-plugin-card-head">
                  <Timer size={16} aria-hidden="true" />
                  <h3>{t('plugins.rest.timingSection')}</h3>
                </div>

                <div className="ct-plugin-field">
                  <div className="ct-plugin-field-head">
                    <div className="ct-plugin-field-copy">
                      <strong>{t('plugins.rest.windowTitle')}</strong>
                      <span>{t('plugins.rest.windowDesc')}</span>
                    </div>
                    <span className="ct-plugin-value">
                      {config.window_minutes} {t('common.minutes')}
                    </span>
                  </div>
                  <div className="ct-plugin-field-body">
                    <Slider
                      className="ct-plugin-slider"
                      size="2"
                      min={10}
                      max={120}
                      step={5}
                      value={[config.window_minutes]}
                      onValueChange={(value) => updateConfig({ window_minutes: value[0] })}
                    />
                  </div>
                </div>

                <div className="ct-plugin-field">
                  <div className="ct-plugin-field-head">
                    <div className="ct-plugin-field-copy">
                      <strong>{t('plugins.rest.breakTitle')}</strong>
                      <span>{t('plugins.rest.breakDesc')}</span>
                    </div>
                    <span className="ct-plugin-value">
                      {config.break_minutes} {t('common.minutes')}
                    </span>
                  </div>
                  <div className="ct-plugin-field-body">
                    <Slider
                      className="ct-plugin-slider"
                      size="2"
                      min={1}
                      max={30}
                      step={1}
                      value={[config.break_minutes]}
                      onValueChange={(value) => updateConfig({ break_minutes: value[0] })}
                    />
                  </div>
                </div>

                <div className="ct-plugin-field">
                  <div className="ct-plugin-field-head">
                    <div className="ct-plugin-field-copy">
                      <strong>{t('plugins.rest.snoozeTitle')}</strong>
                      <span>{t('plugins.rest.snoozeDesc')}</span>
                    </div>
                    <span className="ct-plugin-value">
                      {config.snooze_interval_minutes} {t('common.minutes')}
                    </span>
                  </div>
                  <div className="ct-plugin-field-body">
                    <Slider
                      className="ct-plugin-slider"
                      size="2"
                      min={1}
                      max={10}
                      step={1}
                      value={[config.snooze_interval_minutes]}
                      onValueChange={(value) =>
                        updateConfig({ snooze_interval_minutes: value[0] })
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="ct-plugin-card">
                <div className="ct-plugin-card-head">
                  <Bell size={16} aria-hidden="true" />
                  <h3>{t('plugins.rest.methodSection')}</h3>
                </div>

                <div className="ct-plugin-field">
                  <div className="ct-plugin-field-head">
                    <div className="ct-plugin-field-copy">
                      <strong>{t('plugins.rest.modeTitle')}</strong>
                      <span>{t('plugins.rest.modeDesc')}</span>
                    </div>
                    <SegmentedControl.Root
                      className="ct-segmented"
                      value={mode}
                      size="1"
                      onValueChange={(value) => void changeMode(value)}
                    >
                      <SegmentedControl.Item value="toast">
                        {t('plugins.rest.modeToast')}
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="fullscreen">
                        {t('plugins.rest.modeFullscreen')}
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                  </div>
                </div>

                {mode === 'fullscreen' && (
                  <>
                    <div className="ct-plugin-field">
                      <div className="ct-plugin-field-head">
                        <div className="ct-plugin-field-copy">
                          <strong>{t('plugins.rest.fullscreenBgTitle')}</strong>
                          <span>{t('plugins.rest.fullscreenBgDesc')}</span>
                        </div>
                      </div>
                      <div className="ct-plugin-field-body">
                        {fullscreen.bg ? (
                          <div className="ct-fs-bg-preview">
                            <img src={fullscreen.bg} alt="" />
                            <label className="ct-fs-btn">
                              {t('plugins.rest.changeBg')}
                              <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={handleBgFile}
                              />
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
                    </div>

                    <div className="ct-plugin-field">
                      <div className="ct-plugin-field-head">
                        <div className="ct-plugin-field-copy">
                          <strong>{t('plugins.rest.fullscreenOpacityTitle')}</strong>
                          <span>{t('plugins.rest.fullscreenOpacityDesc')}</span>
                        </div>
                        <span className="ct-plugin-value">{fullscreen.opacity}%</span>
                      </div>
                      <div className="ct-plugin-field-body">
                        <Slider
                          className="ct-plugin-slider"
                          size="2"
                          min={0}
                          max={100}
                          step={5}
                          value={[fullscreen.opacity]}
                          onValueChange={(value) => updateFullscreen({ opacity: value[0] })}
                        />
                      </div>
                    </div>

                    <div className="ct-plugin-field">
                      <div className="ct-plugin-field-head">
                        <div className="ct-plugin-field-copy">
                          <strong>{t('plugins.rest.fullscreenFitModeTitle')}</strong>
                          <span>{t('plugins.rest.fullscreenFitModeDesc')}</span>
                        </div>
                        <Select.Root
                          value={fullscreen.fitMode}
                          onValueChange={(value) => updateFullscreen({ fitMode: value })}
                        >
                          <Select.Trigger
                            aria-label={t('plugins.rest.fullscreenFitModeTitle')}
                          />
                          <Select.Content>
                            <Select.Item value="contain">{t('plugins.rest.fitContain')}</Select.Item>
                            <Select.Item value="cover">{t('plugins.rest.fitCover')}</Select.Item>
                            <Select.Item value="fill">{t('plugins.rest.fitFill')}</Select.Item>
                          </Select.Content>
                        </Select.Root>
                      </div>
                    </div>
                  </>
                )}

                <div className="ct-plugin-field">
                  <div className="ct-plugin-field-head">
                    <div className="ct-plugin-field-copy">
                      <strong>{t('plugins.rest.customTitle')}</strong>
                      <span>{t('plugins.rest.customTitleDesc')}</span>
                    </div>
                  </div>
                  <div className="ct-plugin-field-body">
                    <TextField.Root
                      size="2"
                      value={text.title}
                      placeholder={t('plugins.rest.previewDefaultTitle')}
                      aria-label={t('plugins.rest.customTitle')}
                      onChange={(event) => updateText({ title: event.target.value })}
                    />
                  </div>
                </div>

                <div className="ct-plugin-field">
                  <div className="ct-plugin-field-head">
                    <div className="ct-plugin-field-copy">
                      <strong>{t('plugins.rest.customBody')}</strong>
                      <span>{t('plugins.rest.customBodyDesc')}</span>
                    </div>
                  </div>
                  <div className="ct-plugin-field-body">
                    <TextArea
                      size="2"
                      rows={3}
                      value={text.body}
                      placeholder={t('plugins.rest.previewDefaultBody')}
                      aria-label={t('plugins.rest.customBody')}
                      onChange={(event) => updateText({ body: event.target.value })}
                    />
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
      </RadixPage>
    </PageScroll>
  )
}
