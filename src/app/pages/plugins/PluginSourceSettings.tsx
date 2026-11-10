import { useId, useRef, useState, type FormEvent } from 'react'
import { Input, Popover, Button } from '@heroui/react'
import { ChevronDown, GitBranch, LoaderCircle } from 'lucide-react'
import { DEFAULT_PLUGIN_REPOSITORY } from '../../../api/tauri'
import { useT } from '../../i18n'

type SourceOption = 'official' | 'mirror' | 'custom'
const sourceOption = (repository: string, mirror: boolean): SourceOption => repository === DEFAULT_PLUGIN_REPOSITORY
  ? mirror ? 'mirror' : 'official' : 'custom'

export function PluginSourceSettings({ source, mirror, saving, disabled, onChange }: {
  source: string
  mirror: boolean
  saving: boolean
  disabled: boolean
  onChange: (repository: string, mirror: boolean) => Promise<void>
}) {
  const t = useT()
  const id = useId()
  const currentOption = sourceOption(source, mirror)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(source)
  const [selection, setSelection] = useState<SourceOption>(currentOption)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const labels = { official: 'pluginMarket.sourceOfficial', mirror: 'pluginMarket.mirror', custom: 'pluginMarket.sourceCustom' } as const

  const apply = async (repository: string, routeMirror: boolean) => {
    if (saving || disabled || !repository) return
    setError('')
    try {
      await onChange(repository, routeMirror)
      setOpen(false)
    } catch (failure) {
      setError(String(failure))
    }
  }
  const choose = (option: SourceOption) => {
    setSelection(option)
    setError('')
    if (option === 'custom') {
      requestAnimationFrame(() => input.current?.focus())
      return
    }
    if (option !== currentOption) void apply(DEFAULT_PLUGIN_REPOSITORY, option === 'mirror')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (selection !== 'custom') return
    const repository = draft.trim()
    if (!repository) return
    if (repository !== source) void apply(repository, false)
  }

  return (
    <Popover isOpen={open} onOpenChange={(value) => {
      if (value) { setDraft(currentOption === 'custom' ? source : ''); setSelection(currentOption); setError('') }
      setOpen(value)
    }}>
      <Popover.Trigger>
        <Button variant="outline" size="sm" className="ct-market-toolbar-btn" isDisabled={disabled}>
          {saving ? <LoaderCircle size={15} className="ct-market-spin" aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}
          <span>{t('pluginMarket.source')} · {t(labels[currentOption])}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Content className="ct-market-source-popover" placement="bottom end">
        <Popover.Dialog aria-labelledby={`${id}-title`}>
          <form onSubmit={submit} className="ct-market-source-form" aria-busy={saving}>
            <Popover.Heading id={`${id}-title`}>{t('pluginMarket.source')}</Popover.Heading>
            <p>{t('pluginMarket.sourceCurrent', { repository: source })}</p>
            {saving && <p className="ct-market-source-busy" role="status">
              <LoaderCircle size={13} className="ct-market-spin" aria-hidden="true" />{t('pluginMarket.sourceChecking')}
            </p>}
            <fieldset className="ct-market-source-options" disabled={saving || disabled} aria-labelledby={`${id}-title`}>
              {(['official', 'mirror', 'custom'] as const).map((option) => (
                <div className="ct-market-source-block" key={option}>
                  <label className="ct-market-source-option">
                    <input type="radio" name={`${id}-source`} value={option} checked={selection === option}
                      onChange={() => choose(option)} />
                    <span>{t(labels[option])}</span>
                    {option !== 'custom' && <small>{option === 'official' ? 'GitHub' : 'ghfast.top'}</small>}
                  </label>
                  {option === 'mirror' && selection === 'mirror' && <p className="ct-market-source-note">{t('pluginMarket.mirrorHint')}</p>}
                  {option === 'custom' && selection === 'custom' && <div className="ct-market-source-custom">
                    <Input ref={input} id={`${id}-input`} variant="secondary" fullWidth value={draft}
                      onChange={(event) => { setDraft(event.target.value); setError('') }}
                      placeholder="https://github.com/owner/repository" maxLength={256} required
                      spellCheck={false} autoCapitalize="none" autoCorrect="off" aria-label={t('pluginMarket.sourceAddress')}
                      aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} />
                    <p id={`${id}-help`}>{t('pluginMarket.sourceStructure')}</p>
                  </div>}
                </div>
              ))}
            </fieldset>
            {error && <p id={`${id}-error`} className="ct-market-source-error" role="alert">{error}</p>}
          </form>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
