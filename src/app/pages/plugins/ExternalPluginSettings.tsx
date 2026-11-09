import { Component, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@radix-ui/themes'
import { LoaderCircle } from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { usePluginRegistry } from '../../../stores/pluginRegistry'
import { loadExternalPlugins } from '../../../plugins/loadExternalPlugins'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'

class SettingsBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.warn('[plugins] settings render failed', error) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** Plugin settings are ordinary React components under the host's theme. */
export function ExternalPluginSettings({ id, hasSettings, contentMtimeMs }: {
  id: string
  hasSettings: boolean
  contentMtimeMs?: number
}) {
  const t = useT()
  const handle = usePluginRegistry((state) => state.pluginMap.get(id))
  const [loading, setLoading] = useState(hasSettings)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(false)
    if (!hasSettings) { setLoading(false); return }
    setLoading(true)
    void loadExternalPlugins({ force: attempt > 0 }).then(() => {
      if (!alive) return
      const current = usePluginRegistry.getState().getPlugin(id)
      if (!current?.enabled || !current.SettingsComponent) setError(true)
    }).catch(() => { if (alive) setError(true) }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [id, hasSettings, contentMtimeMs, attempt])

  // Config can change in a Toast or sidecar while this panel is open. Keep the
  // plugin's per-id DOM notification contract independent of the rendering framework.
  useEffect(() => {
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    const add = (pending: Promise<UnlistenFn>) => void pending.then((unlisten) => {
      if (disposed) unlisten()
      else unlisteners.push(unlisten)
    }).catch((reason) => console.warn('[plugins] config listener failed', reason))
    add(listen<{ pluginId: string }>('catrace:plugin-config-changed', ({ payload }) => {
      if (!disposed && payload.pluginId === id) {
        window.dispatchEvent(new CustomEvent('catrace:plugin-config-changed', { detail: payload }))
      }
    }))
    add(listen<{ pluginId: string }>('catrace:plugin-config-save-failed', ({ payload }) => {
      if (!disposed && payload.pluginId === id) showToast(t('settings.messages.saveFailed'), 'error')
    }))
    return () => { disposed = true; for (const unlisten of unlisteners) unlisten() }
  }, [id, t])

  const failure = <div className="ct-market-settings-status" role="alert"><p>{t('pluginMarket.settingsFailed')}</p><Button size="1" variant="soft" onClick={() => setAttempt((value) => value + 1)}>{t('pluginMarket.retry')}</Button></div>
  if (!hasSettings) return <p className="ct-plugin-note">{t('pluginMarket.noSettings')}</p>
  if (loading) return <div className="ct-market-settings-status" role="status"><LoaderCircle size={16} className="ct-market-spin" aria-hidden="true" />{t('pluginMarket.loadingSettings')}</div>
  if (error || !handle?.enabled || !handle.SettingsComponent) return failure
  const Settings = handle.SettingsComponent
  return <SettingsBoundary key={`${id}:${contentMtimeMs ?? 0}:${attempt}`} fallback={failure}><div className="ct-market-external-settings"><Settings /></div></SettingsBoundary>
}
