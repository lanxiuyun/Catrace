import { useMemo, useRef, type ChangeEvent } from 'react'
import { Button, Input, ListBox, Select, Slider, TextArea } from '@heroui/react'
import { Send } from 'lucide-react'
import type { AppConfig } from '../../../api/tauri'
import { useT } from '../../i18n'
import { PluginSettingRow } from './PluginSettingRow'
import { FullscreenReminderPreview } from '../../../components/FullscreenReminderPreview'
import { readFullscreenTransforms } from '../../../components/fullscreenReminderModel'

function SettingSlider({
  value,
  min,
  max,
  step,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  label: string
  onChange: (value: number) => void
}) {
  return (
    <Slider
      className="w-full"
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      aria-label={label}
      onChange={(next) => {
        if (typeof next === 'number') onChange(next)
      }}
    >
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  )
}

export type ReminderMode = 'toast' | 'fullscreen'

export interface FullscreenState {
  bg: string
  opacity: number
  fitMode: string
  elementTransforms: string
}

export interface ReminderText {
  title: string
  body: string
}

/** 久坐提醒详情：浅色章节标题与白色设置卡，设置行保持自动保存。 */
export function RestSettings({
  enabled,
  config,
  mode,
  fullscreen,
  text,
  testing,
  onUpdateConfig,
  onUpdateFullscreen,
  onUpdateText,
  onChangeMode,
  onBgFile,
  onTest,
}: {
  enabled: boolean
  config: AppConfig
  mode: ReminderMode
  fullscreen: FullscreenState
  text: ReminderText
  testing: boolean
  onUpdateConfig: (patch: Partial<AppConfig>) => void
  onUpdateFullscreen: (patch: Partial<FullscreenState>) => void
  onUpdateText: (patch: Partial<ReminderText>) => void
  onChangeMode: (mode: ReminderMode) => void
  onBgFile: (event: ChangeEvent<HTMLInputElement>) => void
  onTest: () => void
}) {
  const t = useT()
  const backgroundInput = useRef<HTMLInputElement>(null)
  const previewTransforms = useMemo(
    () => readFullscreenTransforms(fullscreen.elementTransforms),
    [fullscreen.elementTransforms],
  )

  return (
    <div className="ct-rest-settings">
      <section className="ct-rest-section">
        <header className="ct-rest-section-head">
          <h3>{t('plugins.rest.timingSection')}</h3>
        </header>

        <div className="ct-rest-section-body">
          <PluginSettingRow
            title={t('plugins.rest.windowTitle')}
            description={t('plugins.rest.windowDesc')}
            controlClassName="is-slider"
            control={
              <>
                <SettingSlider
                  value={config.window_minutes}
                  min={15}
                  max={120}
                  step={5}
                  label={t('plugins.rest.windowTitle')}
                  onChange={(value) => onUpdateConfig({ window_minutes: value })}
                />
                <span className="ct-plugin-value">
                  {config.window_minutes} {t('common.minutes')}
                </span>
              </>
            }
          />

          <PluginSettingRow
            title={t('plugins.rest.breakTitle')}
            description={t('plugins.rest.breakDesc')}
            controlClassName="is-slider"
            control={
              <>
                <SettingSlider
                  value={config.break_minutes}
                  min={1}
                  max={20}
                  step={1}
                  label={t('plugins.rest.breakTitle')}
                  onChange={(value) => onUpdateConfig({ break_minutes: value })}
                />
                <span className="ct-plugin-value">
                  {config.break_minutes} {t('common.minutes')}
                </span>
              </>
            }
          />

          <PluginSettingRow
            title={t('plugins.rest.snoozeTitle')}
            description={t('plugins.rest.snoozeDesc')}
            controlClassName="is-slider"
            control={
              <>
                <SettingSlider
                  value={config.snooze_interval_minutes}
                  min={1}
                  max={10}
                  step={1}
                  label={t('plugins.rest.snoozeTitle')}
                  onChange={(value) => onUpdateConfig({ snooze_interval_minutes: value })}
                />
                <span className="ct-plugin-value">
                  {config.snooze_interval_minutes} {t('common.minutes')}
                </span>
              </>
            }
          />
        </div>
      </section>

      <section className="ct-rest-section">
        <header className="ct-rest-section-head">
          <h3>{t('plugins.rest.methodSection')}</h3>
        </header>

        <div className="ct-rest-section-body">
          <PluginSettingRow
            title={t('plugins.rest.modeTitle')}
            control={
              <Select
                className="ct-plugin-select"
                variant="secondary"
                value={mode}
                onChange={(value) => { if (value != null) onChangeMode(String(value) as ReminderMode) }}
              >
                <Select.Trigger aria-label={t('plugins.rest.modeTitle')}>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="toast" textValue={t('plugins.rest.modeToast')}>
                      {t('plugins.rest.modeToast')}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="fullscreen" textValue={t('plugins.rest.modeFullscreen')}>
                      {t('plugins.rest.modeFullscreen')}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            }
          />

          {mode === 'fullscreen' && (
            <>
              <div className="ct-plugin-row is-stack">
                <div className="ct-rest-background-head">
                  <div className="ct-plugin-row-copy">
                    <span className="ct-plugin-row-title">{t('plugins.rest.fullscreenBgTitle')}</span>
                    <span className="ct-plugin-row-desc">{t('plugins.rest.fullscreenBgDesc')}</span>
                  </div>
                  <div className="ct-rest-background-actions">
                    <input ref={backgroundInput} type="file" accept="image/*" hidden onChange={onBgFile} />
                    <Button size="sm" variant="secondary" onPress={() => backgroundInput.current?.click()}>
                      {t('plugins.rest.changeBg')}
                    </Button>
                    {fullscreen.bg && (
                      <Button size="sm" variant="danger-soft" onPress={() => onUpdateFullscreen({ bg: '' })}>
                        {t('plugins.rest.clearBg')}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="ct-plugin-row-control">
                  <FullscreenReminderPreview
                    title={text.title || t('reminder.defaultTitle')}
                    body={text.body || t('reminder.defaultBody')}
                    bgImage={fullscreen.bg}
                    opacity={fullscreen.opacity}
                    fitMode={fullscreen.fitMode}
                    remainingSeconds={config.break_minutes * 60}
                    elementTransforms={previewTransforms}
                  />
                </div>
              </div>

              <PluginSettingRow
                title={t('plugins.rest.fullscreenOpacityTitle')}
                description={t('plugins.rest.fullscreenOpacityDesc')}
                controlClassName="is-slider"
                control={
                  <>
                    <SettingSlider
                      value={fullscreen.opacity}
                      min={0}
                      max={100}
                      step={5}
                      label={t('plugins.rest.fullscreenOpacityTitle')}
                      onChange={(value) => onUpdateFullscreen({ opacity: value })}
                    />
                    <span className="ct-plugin-value">{fullscreen.opacity}%</span>
                  </>
                }
              />

              <PluginSettingRow
                title={t('plugins.rest.fullscreenFitModeTitle')}
                description={t('plugins.rest.fullscreenFitModeDesc')}
                control={
                  <Select
                    className="ct-plugin-select"
                    variant="secondary"
                    value={fullscreen.fitMode}
                    onChange={(value) => { if (value != null) onUpdateFullscreen({ fitMode: String(value) }) }}
                  >
                    <Select.Trigger aria-label={t('plugins.rest.fullscreenFitModeTitle')}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="contain" textValue={t('plugins.rest.fitContain')}>
                          {t('plugins.rest.fitContain')}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="cover" textValue={t('plugins.rest.fitCover')}>
                          {t('plugins.rest.fitCover')}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="fill" textValue={t('plugins.rest.fitFill')}>
                          {t('plugins.rest.fitFill')}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                }
              />
            </>
          )}
        </div>
      </section>

      <section className="ct-rest-section">
        <header className="ct-rest-section-head">
          <h3>{t('plugins.rest.contentSection')}</h3>
        </header>
        <div className="ct-rest-section-body">
          <PluginSettingRow
            title={t('plugins.rest.customTitle')}
            stack
            control={
              <Input
                fullWidth
                variant="secondary"
                value={text.title}
                placeholder={t('reminder.defaultTitle')}
                aria-label={t('plugins.rest.customTitle')}
                onChange={(event) => onUpdateText({ title: event.target.value })}
              />
            }
          />

          <PluginSettingRow
            title={t('plugins.rest.customBody')}
            stack
            control={
              <TextArea
                fullWidth
                variant="secondary"
                rows={3}
                value={text.body}
                placeholder={t('reminder.defaultBody')}
                aria-label={t('plugins.rest.customBody')}
                onChange={(event) => onUpdateText({ body: event.target.value })}
              />
            }
          />
          <PluginSettingRow
            title={t('settings.reminder.testNotifyTitle')}
            control={
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={!enabled || testing}
                onClick={onTest}
              >
                <Send size={14} aria-hidden="true" />
                {t('settings.reminder.testNotifyBtn')}
              </Button>
            }
          />
        </div>
      </section>
    </div>
  )
}
