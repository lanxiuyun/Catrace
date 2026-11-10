import type { ChangeEvent } from 'react'
import { Button, Input, ListBox, Select, Slider, TextArea } from '@heroui/react'
import { ImagePlus, Send } from 'lucide-react'
import type { AppConfig } from '../../../api/tauri'
import { useT } from '../../i18n'
import { PluginSettingRow } from './PluginSettingRow'

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
}

export interface ReminderText {
  title: string
  body: string
}

/**
 * 久坐提醒详情：三组设置卡 + 一张通知测试卡。
 *
 * 组 = 白底圆角卡，组名 12px 灰色；组内是设置行（左文案 + 右控件，相邻行 hairline），
 * 和系统设置页同一套语言。全屏背景图用 stack 行：标签在上，预览占满一行。
 */
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

  return (
    <div className="ct-plugin-groups">
      <section className="ct-plugin-group">
        <h3 className="ct-plugin-group-title">{t('plugins.rest.timingSection')}</h3>

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
      </section>

      <section className="ct-plugin-group">
        <h3 className="ct-plugin-group-title">{t('plugins.rest.methodSection')}</h3>

        <PluginSettingRow
          title={t('plugins.rest.modeTitle')}
          description={t('plugins.rest.modeDesc')}
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
            <PluginSettingRow
              title={t('plugins.rest.fullscreenBgTitle')}
              description={t('plugins.rest.fullscreenBgDesc')}
              stack
              control={
                fullscreen.bg ? (
                  <div className="ct-plugin-bg-preview">
                    <img src={fullscreen.bg} alt="" />
                    <div className="ct-plugin-bg-actions">
                      <label className="ct-plugin-bg-btn">
                        {t('plugins.rest.changeBg')}
                        <input type="file" accept="image/*" hidden onChange={onBgFile} />
                      </label>
                      <button
                        type="button"
                        className="ct-plugin-bg-btn is-danger"
                        onClick={() => onUpdateFullscreen({ bg: '' })}
                      >
                        {t('plugins.rest.clearBg')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="ct-plugin-bg-empty">
                    <input type="file" accept="image/*" hidden onChange={onBgFile} />
                    <ImagePlus size={18} aria-hidden="true" />
                    <span>{t('plugins.rest.fullscreenBgDesc')}</span>
                  </label>
                )
              }
            />

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
      </section>

      <section className="ct-plugin-group">
        <h3 className="ct-plugin-group-title">{t('plugins.rest.contentSection')}</h3>

        <PluginSettingRow
          title={t('plugins.rest.customTitle')}
          description={t('plugins.rest.customTitleDesc')}
          stack
          control={
            <Input
              fullWidth
              variant="secondary"
              value={text.title}
              placeholder={t('plugins.rest.previewDefaultTitle')}
              aria-label={t('plugins.rest.customTitle')}
              onChange={(event) => onUpdateText({ title: event.target.value })}
            />
          }
        />

        <PluginSettingRow
          title={t('plugins.rest.customBody')}
          description={t('plugins.rest.customBodyDesc')}
          stack
          control={
            <TextArea
              fullWidth
              variant="secondary"
              rows={3}
              value={text.body}
              placeholder={t('plugins.rest.previewDefaultBody')}
              aria-label={t('plugins.rest.customBody')}
              onChange={(event) => onUpdateText({ body: event.target.value })}
            />
          }
        />
      </section>

      <section className="ct-plugin-group">
        <PluginSettingRow
          title={t('settings.reminder.testNotifyTitle')}
          description={t('settings.reminder.testNotifyDesc')}
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
      </section>
    </div>
  )
}
