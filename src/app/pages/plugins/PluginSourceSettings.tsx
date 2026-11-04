import { useId, useState, type FormEvent } from 'react'
import { Button, Popover, Switch, TextField } from '@radix-ui/themes'
import { GitBranch, LoaderCircle } from 'lucide-react'
import { DEFAULT_PLUGIN_REPOSITORY } from '../../../api/tauri'
import { useT } from '../../i18n'

export function PluginSourceSettings({ source, mirror, saving, disabled, onChange, onMirrorChange }: {
  source: string
  mirror: boolean
  saving: boolean
  disabled: boolean
  onChange: (repository: string) => Promise<void>
  onMirrorChange: (value: boolean) => Promise<void>
}) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(source)
  const [error, setError] = useState('')

  const apply = async (repository: string) => {
    setError('')
    try {
      await onChange(repository)
      setOpen(false)
    } catch (failure) {
      setError(String(failure))
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!saving && draft.trim()) void apply(draft.trim())
  }

  return (
    <Popover.Root open={open} onOpenChange={(value) => {
      if (value) { setDraft(source); setError('') }
      setOpen(value)
    }}>
      <Popover.Trigger>
        <button type="button" className="ct-plugin-icon-btn ct-market-folder-btn" disabled={disabled}
          title={t('pluginMarket.sourceCurrent', { repository: source })}>
          {saving ? <LoaderCircle size={15} className="ct-market-spin" aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}
          <span>{t('pluginMarket.source')}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content width="25rem" align="end" className="ct-market-source-popover" aria-labelledby={`${id}-title`}>
        <form onSubmit={submit} className="ct-market-source-form" aria-busy={saving}>
          <h3 id={`${id}-title`}>{t('pluginMarket.source')}</h3>
          <p>{t('pluginMarket.sourceHint')}</p>
          <label htmlFor={`${id}-input`}>{t('pluginMarket.sourceAddress')}</label>
          <TextField.Root id={`${id}-input`} value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }}
            placeholder="https://github.com/owner/repository" maxLength={256} required
            spellCheck={false} autoCapitalize="none" autoCorrect="off" disabled={saving}
            aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} />
          <p id={`${id}-help`}>{t('pluginMarket.sourceStructure')}</p>
          <div className="ct-market-source-mirror">
            <div>
              <strong>{t('pluginMarket.mirror')}</strong>
              <p>{t('pluginMarket.mirrorHint')}</p>
            </div>
            <Switch checked={mirror} disabled={saving || disabled} aria-label={t('pluginMarket.mirror')}
              onCheckedChange={(value) => { void onMirrorChange(value).catch(() => {}) }} />
          </div>
          {error && <p id={`${id}-error`} className="ct-market-source-error" role="alert">{error}</p>}
          <div className="ct-market-source-actions">
            <Button type="button" variant="ghost" color="gray" disabled={saving || source === DEFAULT_PLUGIN_REPOSITORY}
              onClick={() => void apply(DEFAULT_PLUGIN_REPOSITORY)}>{t('pluginMarket.sourceRestore')}</Button>
            <Button type="submit" disabled={saving || !draft.trim()}>
              {saving && <LoaderCircle size={14} className="ct-market-spin" aria-hidden="true" />}
              {t(saving ? 'pluginMarket.sourceChecking' : 'pluginMarket.sourceApply')}
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover.Root>
  )
}
