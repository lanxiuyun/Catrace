import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Badge,
  Button,
  DropdownMenu,
  Select,
  Slider,
  Switch,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import { Armchair, Plus, RefreshCw, Search, Send } from 'lucide-react'
import {
  getConfig,
  getFullscreenSettings,
  getReminderMode,
  getReminderText,
  installExternalPlugin,
  listPluginCatalog,
  pickPluginFolder,
  pickPluginZip,
  setConfig,
  setFullscreenSettings,
  setReminderMode,
  setReminderText,
  setRestPluginEnabled,
  testNotification,
  type AppConfig,
  type PluginCatalogEntry,
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

interface SidebarPlugin {
  id: string
  name: string
  description: string
  iconDataUrl: string | null
  enabled: boolean
}

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
 * 插件中心（React 版）：左侧插件列表 + 右侧单页设置。
 * 右侧按「提醒偏好 / 提醒方式 / 提醒内容」三组排布：组标题在卡片外，
 * 设置行是「左标签 + 右控件」；改完即存，没有底栏、页签、统计与关于页。
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
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([])
  const [selectedId, setSelectedId] = useState('rest')

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

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await listPluginCatalog())
    } catch (error) {
      console.error('Failed to scan plugin folder', error)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

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

  const installPlugin = async (source: 'folder' | 'zip') => {
    try {
      const path = source === 'folder' ? await pickPluginFolder() : await pickPluginZip()
      if (!path) return
      const result = await installExternalPlugin(path, false)
      flash(t('pluginsCenter.installOk', { name: result.name }))
      await loadCatalog()
    } catch (error) {
      flash(t('pluginsCenter.installFailed', { error: String(error) }), true)
    }
  }

  const sidebarPlugins: SidebarPlugin[] = [
    {
      id: 'rest',
      name: t('plugins.rest.name'),
      description: t('plugins.rest.listSubtitle'),
      iconDataUrl: null,
      enabled,
    },
    ...catalog.map((entry) => ({
      id: entry.info.id,
      name: entry.info.name,
      description: entry.info.description,
      iconDataUrl: entry.iconDataUrl ?? null,
      enabled: entry.info.enabled,
    })),
  ]

  const normalizedQuery = query.trim().toLowerCase()
  const visiblePlugins = normalizedQuery
    ? sidebarPlugins.filter((plugin) =>
        `${plugin.name} ${plugin.description} ${plugin.id}`.toLowerCase().includes(normalizedQuery),
      )
    : sidebarPlugins
  const selectedPlugin = sidebarPlugins.find((plugin) => plugin.id === selectedId)

  return (
    <PageScroll>
      <RadixPage className="ct-plugins-page">
        <div className="ct-plugins">
          <aside className="ct-plugin-list" aria-label={t('plugins.listHeading')}>
            <div className="ct-plugin-search">
              <div className="ct-plugin-search-field">
                <Search size={14} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('pluginsCenter.searchPlaceholder')}
                  aria-label={t('pluginsCenter.searchPlaceholder')}
                />
              </div>
              <button
                type="button"
                className="ct-plugin-icon-btn"
                aria-label={t('pluginsCenter.refresh')}
                title={t('pluginsCenter.refresh')}
                onClick={() => void loadCatalog()}
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <button
                    type="button"
                    className="ct-plugin-icon-btn is-accent"
                    aria-label={t('pluginsCenter.install')}
                    title={t('pluginsCenter.install')}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item onSelect={() => void installPlugin('folder')}>
                    {t('pluginsCenter.installFolder')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void installPlugin('zip')}>
                    {t('pluginsCenter.installZip')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>

            <div className="ct-plugin-rows">
              {visiblePlugins.map((plugin) => (
                <button
                  key={plugin.id}
                  type="button"
                  className={
                    plugin.id === selectedId ? 'ct-plugin-row is-selected' : 'ct-plugin-row'
                  }
                  aria-current={plugin.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(plugin.id)}
                >
                  <span
                    className={plugin.iconDataUrl ? 'ct-plugin-icon has-image' : 'ct-plugin-icon'}
                  >
                    {plugin.iconDataUrl ? (
                      <img src={plugin.iconDataUrl} alt="" />
                    ) : (
                      <Armchair size={16} aria-hidden="true" />
                    )}
                  </span>
                  <span className="ct-plugin-row-copy">
                    <strong>{plugin.name}</strong>
                    <span className="ct-plugin-row-desc">{plugin.description}</span>
                  </span>
                  {plugin.enabled && <span className="ct-plugin-dot" aria-hidden="true" />}
                </button>
              ))}
              {!visiblePlugins.length && (
                <p className="ct-plugin-empty">{t('plugins.searchEmpty')}</p>
              )}
            </div>
          </aside>

          <section className="ct-plugin-detail" aria-label={t('plugins.rest.name')}>
              {selectedId === 'rest' ? (
                <>
              <header className="ct-plugin-identity">
                <span className="ct-plugin-hero">
                  <Armchair size={28} aria-hidden="true" />
                </span>
                <div className="ct-plugin-identity-copy">
                  <div className="ct-plugin-title-line">
                    <h2>{t('plugins.rest.name')}</h2>
                    <Badge color="green" size="1">
                      {t('pluginsCenter.builtinCore')}
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
                  <span className="ct-plugin-state">
                    {enabled ? t('pluginsCenter.statusOn') : t('pluginsCenter.statusOff')}
                  </span>
                  <Switch
                    size="2"
                    checked={enabled}
                    aria-label={t('pluginsCenter.enableLabel')}
                    onCheckedChange={(value) => void toggleEnabled(value)}
                  />
                </div>
              </header>

              <div className="ct-plugin-body">
                <div className="ct-plugin-content">
              <section className="ct-plugin-card">
                <h3 className="ct-plugin-card-title">{t('plugins.rest.timingSection')}</h3>
                  <SettingRow
                    title={t('plugins.rest.windowTitle')}
                    description={t('plugins.rest.windowDesc')}
                    controlClassName="is-slider"
                    control={
                      <>
                        <Slider
                          className="ct-plugin-slider"
                          size="2"
                          min={15}
                          max={120}
                          step={5}
                          value={[config.window_minutes]}
                          onValueChange={(value) => updateConfig({ window_minutes: value[0] })}
                        />
                        <span className="ct-plugin-value">
                          {config.window_minutes} {t('common.minutes')}
                        </span>
                      </>
                    }
                  />
                  <SettingRow
                    title={t('plugins.rest.breakTitle')}
                    description={t('plugins.rest.breakDesc')}
                    controlClassName="is-slider"
                    control={
                      <>
                        <Slider
                          className="ct-plugin-slider"
                          size="2"
                          min={1}
                          max={20}
                          step={1}
                          value={[config.break_minutes]}
                          onValueChange={(value) => updateConfig({ break_minutes: value[0] })}
                        />
                        <span className="ct-plugin-value">
                          {config.break_minutes} {t('common.minutes')}
                        </span>
                      </>
                    }
                  />
                  <SettingRow
                    title={t('plugins.rest.snoozeTitle')}
                    description={t('plugins.rest.snoozeDesc')}
                    controlClassName="is-slider"
                    control={
                      <>
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
                        <span className="ct-plugin-value">
                          {config.snooze_interval_minutes} {t('common.minutes')}
                        </span>
                      </>
                    }
                  />
              </section>

              <section className="ct-plugin-card">
                <h3 className="ct-plugin-card-title">{t('plugins.rest.methodSection')}</h3>
                  <SettingRow
                    title={t('plugins.rest.modeTitle')}
                    description={t('plugins.rest.modeDesc')}
                    controlClassName="is-select"
                    control={
                      <Select.Root value={mode} onValueChange={(value) => void changeMode(value)}>
                        <Select.Trigger aria-label={t('plugins.rest.modeTitle')} />
                        <Select.Content>
                          <Select.Item value="toast">{t('plugins.rest.modeToast')}</Select.Item>
                          <Select.Item value="fullscreen">
                            {t('plugins.rest.modeFullscreen')}
                          </Select.Item>
                        </Select.Content>
                      </Select.Root>
                    }
                  />

                  {mode === 'fullscreen' && (
                    <>
                      <SettingRow
                        title={t('plugins.rest.fullscreenBgTitle')}
                        description={t('plugins.rest.fullscreenBgDesc')}
                        controlClassName="is-media"
                        top
                        control={
                          fullscreen.bg ? (
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
                              <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={handleBgFile}
                              />
                              <span>{t('plugins.rest.fullscreenBgDesc')}</span>
                            </label>
                          )
                        }
                      />
                      <SettingRow
                        title={t('plugins.rest.fullscreenOpacityTitle')}
                        description={t('plugins.rest.fullscreenOpacityDesc')}
                        controlClassName="is-slider"
                        control={
                          <>
                            <Slider
                              className="ct-plugin-slider"
                              size="2"
                              min={0}
                              max={100}
                              step={5}
                              value={[fullscreen.opacity]}
                              onValueChange={(value) => updateFullscreen({ opacity: value[0] })}
                            />
                            <span className="ct-plugin-value">{fullscreen.opacity}%</span>
                          </>
                        }
                      />
                      <SettingRow
                        title={t('plugins.rest.fullscreenFitModeTitle')}
                        description={t('plugins.rest.fullscreenFitModeDesc')}
                        controlClassName="is-select"
                        control={
                          <Select.Root
                            value={fullscreen.fitMode}
                            onValueChange={(value) => updateFullscreen({ fitMode: value })}
                          >
                            <Select.Trigger
                              aria-label={t('plugins.rest.fullscreenFitModeTitle')}
                            />
                            <Select.Content>
                              <Select.Item value="contain">
                                {t('plugins.rest.fitContain')}
                              </Select.Item>
                              <Select.Item value="cover">
                                {t('plugins.rest.fitCover')}
                              </Select.Item>
                              <Select.Item value="fill">{t('plugins.rest.fitFill')}</Select.Item>
                            </Select.Content>
                          </Select.Root>
                        }
                      />
                    </>
                  )}
              </section>

              <section className="ct-plugin-card">
                <h3 className="ct-plugin-card-title">{t('plugins.rest.contentSection')}</h3>
                  <SettingRow
                    title={t('plugins.rest.customTitle')}
                    description={t('plugins.rest.customTitleDesc')}
                    controlClassName="is-field"
                    stack
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
                    controlClassName="is-field"
                    stack
                    control={
                      <TextArea
                        size="2"
                        rows={3}
                        value={text.body}
                        placeholder={t('plugins.rest.previewDefaultBody')}
                        aria-label={t('plugins.rest.customBody')}
                        onChange={(event) => updateText({ body: event.target.value })}
                      />
                    }
                  />
              </section>
                </div>
                <div className="ct-plugin-footer">
                  <Button disabled={!enabled || testing} onClick={() => void sendTest()}>
                    <Send size={14} aria-hidden="true" />
                    {t('plugins.rest.testBtn')}
                  </Button>
                </div>
                </div>
                </>
              ) : (
                <div className="ct-plugin-body">
                  <div className="ct-plugin-content">
                    <div className="ct-plugin-card ct-plugin-unmigrated">
                      <h2>{selectedPlugin?.name ?? ''}</h2>
                      <p>{t('pluginsCenter.notMigratedBody')}</p>
                    </div>
                  </div>
                </div>
              )}
          </section>
        </div>
      </RadixPage>
    </PageScroll>
  )
}

function SettingRow({
  title,
  description,
  control,
  controlClassName,
  top = false,
  stack = false,
}: {
  title: string
  description?: string
  control: ReactNode
  controlClassName?: string
  top?: boolean
  /** 标签在上、控件在下、占满卡片宽度（输入框/文本域用）。 */
  stack?: boolean
}) {
  return (
    <div
      className={
        stack
          ? 'ct-plugin-setting is-stack'
          : top
            ? 'ct-plugin-setting is-top'
            : 'ct-plugin-setting'
      }
    >
      <div className="ct-plugin-setting-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <div
        className={
          controlClassName
            ? `ct-plugin-setting-control ${controlClassName}`
            : 'ct-plugin-setting-control'
        }
      >
        {control}
      </div>
    </div>
  )
}
