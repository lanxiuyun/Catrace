import { useCallback, useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  installRepositoryPlugin, listPluginCatalog, listRepositoryPlugins, setExternalPluginEnabled,
  uninstallExternalPlugin, type PluginCatalogEntry, type RepositoryPluginCatalog,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'

export function usePluginCatalog() {
  const t = useT()
  const [installed, setInstalled] = useState<PluginCatalogEntry[]>([])
  const [repository, setRepository] = useState<RepositoryPluginCatalog | null>(null)
  const [loadingLocal, setLoadingLocal] = useState(true)
  const [loadingRemote, setLoadingRemote] = useState(true)
  const [localError, setLocalError] = useState('')
  const [remoteError, setRemoteError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const operation = useRef(false)
  const mounted = useRef(true)
  const localRequest = useRef(0)

  const refreshLocal = useCallback(async () => {
    const request = ++localRequest.current
    setLoadingLocal(true)
    setLocalError('')
    try {
      const entries = await listPluginCatalog()
      if (!mounted.current || request !== localRequest.current) return
      setInstalled(entries)
    } catch (error) {
      if (mounted.current && request === localRequest.current) setLocalError(String(error))
    } finally {
      if (mounted.current && request === localRequest.current) setLoadingLocal(false)
    }
  }, [])

  const refreshRemote = useCallback(async () => {
    setLoadingRemote(true)
    setRemoteError('')
    try {
      const result = await listRepositoryPlugins()
      if (mounted.current) setRepository(result)
    } catch (error) {
      if (mounted.current) setRemoteError(String(error))
    } finally {
      if (mounted.current) setLoadingRemote(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refreshLocal()
    void refreshRemote()
    const unlisteners: UnlistenFn[] = []
    let disposed = false
    for (const name of ['plugins-reloaded', 'plugin-enabled-changed']) {
      void listen(name, () => { void refreshLocal() }).then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      }).catch((error) => console.warn('Plugin catalog listener failed', error))
    }
    return () => {
      mounted.current = false
      disposed = true
      for (const unlisten of unlisteners) unlisten()
    }
  }, [refreshLocal, refreshRemote])

  const run = async (id: string, action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusyId(id)
    try {
      await action()
      await refreshLocal()
    } catch (error) {
      showToast(t('pluginMarket.operationFailed', { error: String(error) }), 'error')
      // An enable/stop may have persisted before a runtime error: show disk truth.
      await refreshLocal()
    } finally {
      operation.current = false
      if (mounted.current) setBusyId(null)
    }
  }

  const install = (id: string) => run(id, async () => {
    if (!repository) throw new Error(t('pluginMarket.catalogUnavailable'))
    const result = await installRepositoryPlugin(id, repository.commit)
    showToast(t('pluginMarket.installedMessage', { name: result.name }))
  })

  const toggle = (id: string, value: boolean) => run(id, async () => {
    await setExternalPluginEnabled(id, value)
    showToast(t(value ? 'pluginMarket.enabledMessage' : 'pluginMarket.disabledMessage'))
  })

  const uninstall = (id: string) => run(id, async () => {
    await uninstallExternalPlugin(id)
    showToast(t('pluginMarket.uninstalledMessage'))
  })

  return {
    installed, repository, loadingLocal, loadingRemote, localError, remoteError,
    busyId, refreshLocal, refreshRemote, install, toggle, uninstall,
  }
}
