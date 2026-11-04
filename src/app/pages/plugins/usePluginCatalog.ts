import { useCallback, useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  DEFAULT_PLUGIN_REPOSITORY, installRepositoryPlugin, listPluginCatalog,
  listRepositoryPlugins, setExternalPluginEnabled, uninstallExternalPlugin,
  type PluginCatalogEntry, type RepositoryPluginCatalog,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { readPluginRepository, savePluginRepository } from './pluginRepositorySource'

export function usePluginCatalog() {
  const t = useT()
  const [installed, setInstalled] = useState<PluginCatalogEntry[]>([])
  const [repository, setRepository] = useState<RepositoryPluginCatalog | null>(null)
  const [source, setSource] = useState(DEFAULT_PLUGIN_REPOSITORY)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [loadingLocal, setLoadingLocal] = useState(true)
  const [loadingRemote, setLoadingRemote] = useState(true)
  const [localError, setLocalError] = useState('')
  const [remoteError, setRemoteError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const sourceRef = useRef<string | null>(null)
  const operation = useRef(false)
  const mounted = useRef(true)
  const localRequest = useRef(0)
  const remoteRequest = useRef(0)

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
    const request = ++remoteRequest.current
    setLoadingRemote(true)
    setRemoteError('')
    try {
      const currentSource = sourceRef.current ?? await readPluginRepository()
      if (!mounted.current || request !== remoteRequest.current) return
      sourceRef.current = currentSource
      setSource(currentSource)
      const result = await listRepositoryPlugins(currentSource)
      if (!mounted.current || request !== remoteRequest.current) return
      sourceRef.current = result.repository
      setSource(result.repository)
      setRepository(result)
    } catch (error) {
      if (mounted.current && request === remoteRequest.current) {
        setRemoteError(String(error))
        // Never leave an old source's cards installable after a failed source read.
        setRepository(null)
      }
    } finally {
      if (mounted.current && request === remoteRequest.current) setLoadingRemote(false)
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
      ++localRequest.current
      ++remoteRequest.current
      disposed = true
      for (const unlisten of unlisteners) unlisten()
    }
  }, [refreshLocal, refreshRemote])

  const changeSource = async (input: string) => {
    if (operation.current) throw new Error(t('pluginMarket.sourceWait'))
    operation.current = true
    setSourceBusy(true)
    // Invalidate an older refresh before validation, even if its response arrives late.
    ++remoteRequest.current
    setLoadingRemote(false)
    try {
      const result = await listRepositoryPlugins(input.trim())
      if (!mounted.current) return
      await savePluginRepository(result.repository)
      sourceRef.current = result.repository
      if (!mounted.current) return
      setSource(result.repository)
      setRepository(result)
      setRemoteError('')
      showToast(t('pluginMarket.sourceSaved'))
    } finally {
      operation.current = false
      if (mounted.current) setSourceBusy(false)
    }
  }

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
    const snapshot = repository
    if (!snapshot || snapshot.repository !== sourceRef.current) {
      throw new Error(t('pluginMarket.catalogUnavailable'))
    }
    const result = await installRepositoryPlugin(id, snapshot.commit, snapshot.repository)
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
    installed, repository, source, sourceBusy, changeSource,
    loadingLocal, loadingRemote, localError, remoteError,
    busyId, refreshLocal, refreshRemote, install, toggle, uninstall,
  }
}
