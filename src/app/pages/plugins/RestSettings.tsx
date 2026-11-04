import type { ChangeEvent } from 'react'
import { Button, Select, Slider, TextArea, TextField } from '@radix-ui/themes'
import { ImagePlus, Send } from 'lucide-react'
import type { AppConfig } from '../../../api/tauri'
import { useT } from '../../i18n'
import { PluginSettingRow } from './PluginSettingRow'

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
              <Slider
                size="2"
                min={15}
                max={120}
                step={5}
                value={[config.window_minutes]}
                aria-label={t('plugins.rest.windowTitle')}
                onValueChange={(value) => onUpdateConfig({ window_minutes: value[0] })}
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
              <Slider
                size="2"
                min={1}
                max={20}
                step={1}
                value={[config.break_minutes]}
                aria-label={t('plugins.rest.breakTitle')}
                onValueChange={(value) => onUpdateConfig({ break_minutes: value[0] })}
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
              <Slider
                size="2"
                min={1}
                max={10}
                step={1}
                value={[config.snooze_interval_minutes]}
                aria-label={t('plugins.rest.snoozeTitle')}
                onValueChange={(value) => onUpdateConfig({ snooze_interval_minutes: value[0] })}
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
            <Select.Root value={mode} onValueChange={(value) => onChangeMode(value as ReminderMode)}>
              <Select.Trigger className="ct-plugin-select" aria-label={t('plugins.rest.modeTitle')} />
              <Select.Content>
                <Select.Item value="toast">{t('plugins.rest.modeToast')}</Select.Item>
                <Select.Item value="fullscreen">{t('plugins.rest.modeFullscreen')}</Select.Item>
              </Select.Content>
            </Select.Root>
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
                  <Slider
                    size="2"
                    min={0}
                    max={100}
                    step={5}
                    value={[fullscreen.opacity]}
                    aria-label={t('plugins.rest.fullscreenOpacityTitle')}
                    onValueChange={(value) => onUpdateFullscreen({ opacity: value[0] })}
                  />
                  <span className="ct-plugin-value">{fullscreen.opacity}%</span>
                </>
              }
            />

            <PluginSettingRow
              title={t('plugins.rest.fullscreenFitModeTitle')}
              description={t('plugins.rest.fullscreenFitModeDesc')}
              control={
                <Select.Root
                  value={fullscreen.fitMode}
                  onValueChange={(value) => onUpdateFullscreen({ fitMode: value })}
                >
                  <Select.Trigger
                    className="ct-plugin-select"
                    aria-label={t('plugins.rest.fullscreenFitModeTitle')}
                  />
                  <Select.Content>
                    <Select.Item value="contain">{t('plugins.rest.fitContain')}</Select.Item>
                    <Select.Item value="cover">{t('plugins.rest.fitCover')}</Select.Item>
                    <Select.Item value="fill">{t('plugins.rest.fitFill')}</Select.Item>
                  </Select.Content>
                </Select.Root>
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
            <TextField.Root
              size="2"
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
              size="2"
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
              size="1"
              variant="soft"
              color="gray"
              disabled={!enabled || testing}
              onClick={onTest}
            >
              <Send size={13} aria-hidden="true" />
              {t('settings.reminder.testNotifyBtn')}
            </Button>
          }
        />
      </section>
    </div>
  )
}
