import { useMemo, useRef, type ChangeEvent } from 'react'
import { Button, Input, ListBox, NumberField, Select, Slider, TextArea, ToggleButton, ToggleButtonGroup, ToggleButtonGroupSeparator } from '@heroui/react'
import { Send } from 'lucide-react'
import type { AppConfig } from '../../../api/tauri'
import { useT } from '../../i18n'
import { SettingsCard, SettingsCardRow } from '../../../components/SettingsCard'
import { FullscreenReminderPreview } from '../../../components/FullscreenReminderPreview'
import { readFullscreenTransforms } from '../../../components/fullscreenReminderModel'

function SettingMinutes({
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
  const t = useT()
  return (
    <>
      <NumberField
        className="ct-rest-number"
        value={value}
        minValue={min}
        maxValue={max}
        step={step}
        formatOptions={{ useGrouping: false }}
        aria-label={`${label} (${t('common.minutes')})`}
        onChange={(next) => {
          if (Number.isFinite(next) && next >= min && next <= max) onChange(Math.round(next))
        }}
      >
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
      <span className="ct-rest-unit">{t('common.minutes')}</span>
    </>
  )
}

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
      className="ct-rest-slider"
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

/** 久坐提醒详情：沿用 Agent 通知的分组卡片与文字层级，设置行保持自动保存。 */
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
      <SettingsCard title={t('plugins.rest.timingSection')}>
        <SettingsCardRow
          title={t('plugins.rest.windowTitle')}
          description={t('plugins.rest.windowDesc')}
          control={
            <>
              <SettingMinutes
                value={config.window_minutes}
                min={15}
                max={120}
                step={5}
                label={t('plugins.rest.windowTitle')}
                onChange={(value) => onUpdateConfig({ window_minutes: value })}
              />
            </>
          }
        />

        <SettingsCardRow
          title={t('plugins.rest.breakTitle')}
          description={t('plugins.rest.breakDesc')}
          control={
            <>
              <SettingMinutes
                value={config.break_minutes}
                min={1}
                max={20}
                step={1}
                label={t('plugins.rest.breakTitle')}
                onChange={(value) => onUpdateConfig({ break_minutes: value })}
              />
            </>
          }
        />

        <SettingsCardRow
          title={t('plugins.rest.snoozeTitle')}
          description={t('plugins.rest.snoozeDesc')}
          control={
            <>
              <SettingMinutes
                value={config.snooze_interval_minutes}
                min={1}
                max={10}
                step={1}
                label={t('plugins.rest.snoozeTitle')}
                onChange={(value) => onUpdateConfig({ snooze_interval_minutes: value })}
              />
            </>
          }
        />
      </SettingsCard>

      <SettingsCard title={t('plugins.rest.methodSection')}>
        <SettingsCardRow
          title={t('plugins.rest.modeTitle')}
          control={
            <Select
              className="ct-plugin-select"
              aria-label={t('plugins.rest.modeTitle')}
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
            <SettingsCardRow
              title={t('plugins.rest.fullscreenBgTitle')}
              description={t('plugins.rest.fullscreenBgDesc')}
              control={
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
              }
            >
              <FullscreenReminderPreview
                title={text.title || t('reminder.defaultTitle')}
                body={text.body || t('reminder.defaultBody')}
                bgImage={fullscreen.bg}
                opacity={fullscreen.opacity}
                fitMode={fullscreen.fitMode}
                remainingSeconds={config.break_minutes * 60}
                elementTransforms={previewTransforms}
              />
            </SettingsCardRow>

            <SettingsCardRow
              title={t('plugins.rest.fullscreenOpacityTitle')}
              description={t('plugins.rest.fullscreenOpacityDesc')}
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
                  <span className="ct-rest-value">{fullscreen.opacity}%</span>
                </>
              }
            />

            <SettingsCardRow
              title={t('plugins.rest.fullscreenFitModeTitle')}
              description={t('plugins.rest.fullscreenFitModeDesc')}
              control={
                <ToggleButtonGroup
                  size="sm"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[fullscreen.fitMode]}
                  aria-label={t('plugins.rest.fullscreenFitModeTitle')}
                  onSelectionChange={(keys) => {
                    const value = [...keys][0]
                    if (value != null) onUpdateFullscreen({ fitMode: String(value) })
                  }}
                >
                  <ToggleButton id="contain">{t('plugins.rest.fitContain')}</ToggleButton>
                  <ToggleButton id="cover">
                    <ToggleButtonGroupSeparator />
                    {t('plugins.rest.fitCover')}
                  </ToggleButton>
                  <ToggleButton id="fill">
                    <ToggleButtonGroupSeparator />
                    {t('plugins.rest.fitFill')}
                  </ToggleButton>
                </ToggleButtonGroup>
              }
            />
          </>
        )}
      </SettingsCard>

      <SettingsCard title={t('plugins.rest.contentSection')}>
        <SettingsCardRow
          title={t('plugins.rest.customTitle')}
          stack
          control={
            <Input
              fullWidth
              value={text.title}
              placeholder={t('reminder.defaultTitle')}
              aria-label={t('plugins.rest.customTitle')}
              onChange={(event) => onUpdateText({ title: event.target.value })}
            />
          }
        />

        <SettingsCardRow
          title={t('plugins.rest.customBody')}
          stack
          control={
            <TextArea
              fullWidth
              rows={3}
              value={text.body}
              placeholder={t('reminder.defaultBody')}
              aria-label={t('plugins.rest.customBody')}
              onChange={(event) => onUpdateText({ body: event.target.value })}
            />
          }
        />
        <SettingsCardRow
          title={t('settings.reminder.testNotifyTitle')}
          control={
            <Button
              size="sm"
              isDisabled={!enabled || testing}
              onClick={onTest}
            >
              <Send size={14} aria-hidden="true" />
              {t('settings.reminder.testNotifyBtn')}
            </Button>
          }
        />
      </SettingsCard>
    </div>
  )
}
