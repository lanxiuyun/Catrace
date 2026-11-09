import { useEffect, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { LoaderCircle } from 'lucide-react'
import type { Component } from 'vue'
import { usePluginRegistry } from '../../../stores/pluginRegistry'
import { loadExternalPlugins } from '../../../plugins/loadExternalPlugins'
import { VueIsland } from '../../legacy/VueIsland'
import { useT } from '../../i18n'

/** Compatibility island: existing repository settings remain usable in the React shell. */
export function ExternalPluginSettings({ id, hasSettings, contentMtimeMs }: {
  id: string
  hasSettings: boolean
  contentMtimeMs?: number
}) {
  const t = useT()
  const [component, setComponent] = useState<Component | null>(null)
  const [loading, setLoading] = useState(hasSettings)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setComponent(null)
    setError(false)
    if (!hasSettings) { setLoading(false); return }
    setLoading(true)
    void loadExternalPlugins({ force: attempt > 0 }).then(() => {
      if (!alive) return
      const handle = usePluginRegistry().getPlugin(id)
      if (!handle?.enabled || !handle.SettingsComponent) { setError(true); return }
      setComponent(() => handle.SettingsComponent ?? null)
    }).catch(() => { if (alive) setError(true) }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [id, hasSettings, contentMtimeMs, attempt])

  if (!hasSettings) return <p className="ct-plugin-note">{t('pluginMarket.noSettings')}</p>
  if (loading) return <div className="ct-market-settings-status" role="status"><LoaderCircle size={16} className="ct-market-spin" aria-hidden="true" />{t('pluginMarket.loadingSettings')}</div>
  if (error) return <div className="ct-market-settings-status" role="alert"><p>{t('pluginMarket.settingsFailed')}</p><Button size="1" variant="soft" onClick={() => setAttempt((value) => value + 1)}>{t('pluginMarket.retry')}</Button></div>
  return component ? <VueIsland component={component} className="ct-market-external-settings" /> : null
}
