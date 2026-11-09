import { useCallback, useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  DEFAULT_PLUGIN_REPOSITORY, installRepositoryPlugin, listPluginCatalog,
  listRepositoryPlugins, setExternalPluginEnabled, uninstallExternalPlugin,
  type PluginCatalogEntry, type RepositoryPluginCatalog,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { readGithubMirror, readPluginRepository, savePluginRepository } from './pluginRepositorySource'

export function usePluginCatalog() {
  const t = useT()
  const [installed, setInstalled] = useState<PluginCatalogEntry[]>([])
  const [repository, setRepository] = useState<RepositoryPluginCatalog | null>(null)
  const [source, setSource] = useState(DEFAULT_PLUGIN_REPOSITORY)
  const [mirror, setMirrorState] = useState(false)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [loadingLocal, setLoadingLocal] = useState(true)
  const [loadingRemote, setLoadingRemote] = useState(true)
  const [localError, setLocalError] = useState('')
  const [remoteError, setRemoteError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const sourceRef = useRef<string | null>(null)
  const mirrorRef = useRef(false)
  const operation = useRef(false)
  const mounted = useRef(true)
  const localRequest = useRef(0)
  const remoteRequest = useRef(0)

  // The backend marks an exhausted API quota as `rate_limited|<reset epoch>`.
  const describeError = (error: unknown) => {
    const text = String(error)
    const match = /^rate_limited\|(\d+)$/.exec(text.trim())
    if (!match) return text
    const epoch = Number(match[1])
    const minutes = epoch > 0 ? Math.max(1, Math.ceil((epoch * 1000 - Date.now()) / 60_000)) : 0
    return minutes > 0 ? t('pluginMarket.rateLimited', { minutes }) : t('pluginMarket.rateLimitedUnknown')
  }

  // `silent` keeps the list on screen unchanged while a background reload runs (after an
  // enable/disable or a backend event), so switches do not flash through a loading state.
  const refreshLocal = useCallback(async (silent = false) => {
    const request = ++localRequest.current
    if (!silent) setLoadingLocal(true)
    setLocalError('')
    try {
      const entries = await listPluginCatalog()
      if (!mounted.current || request !== localRequest.current) return
      setInstalled(entries)
    } catch (error) {
      if (mounted.current && request === localRequest.current) setLocalError(String(error))
    } finally {
      if (!silent && mounted.current && request === localRequest.current) setLoadingLocal(false)
    }
  }, [])

  const refreshRemote = useCallback(async () => {
    if (operation.current) return
    const request = ++remoteRequest.current
    setLoadingRemote(true)
    setRemoteError('')
    try {
      const currentSource = sourceRef.current ?? await readPluginRepository()
      if (!mounted.current || request !== remoteRequest.current) return
      sourceRef.current = currentSource
      setSource(currentSource)
      // Legacy custom repositories must not silently retain the third-party mirror route.
      mirrorRef.current = currentSource === DEFAULT_PLUGIN_REPOSITORY && mirrorRef.current
      setMirrorState(mirrorRef.current)
      const result = await listRepositoryPlugins(currentSource, mirrorRef.current)
      if (!mounted.current || request !== remoteRequest.current) return
      sourceRef.current = result.repository
      setSource(result.repository)
      setRepository(result)
    } catch (error) {
      if (mounted.current && request === remoteRequest.current) {
        setRemoteError(describeError(error))
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
    void (async () => {
      const savedMirror = await readGithubMirror().catch(() => false)
      if (!mounted.current) return
      mirrorRef.current = savedMirror
      setMirrorState(savedMirror)
      await refreshRemote()
    })()
    const unlisteners: UnlistenFn[] = []
    let disposed = false
    for (const name of ['plugins-reloaded', 'plugin-enabled-changed']) {
      void listen(name, () => { void refreshLocal(true) }).then((unlisten) => {
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

  const changeSource = async (input: string, nextMirror: boolean) => {
    if (operation.current) throw new Error(t('pluginMarket.sourceWait'))
    operation.current = true
    setSourceBusy(true)
    // Invalidate an older refresh before validation, even if its response arrives late.
    ++remoteRequest.current
    setLoadingRemote(false)
    try {
      const result = await listRepositoryPlugins(input.trim(), nextMirror)
      if (!mounted.current) return
      await savePluginRepository(result.repository, nextMirror)
      sourceRef.current = result.repository
      mirrorRef.current = nextMirror
      if (!mounted.current) return
      setSource(result.repository)
      setMirrorState(nextMirror)
      setRepository(result)
      setRemoteError('')
      showToast(t('pluginMarket.sourceSaved'))
    } catch (error) {
      throw describeError(error)
    } finally {
      operation.current = false
      if (mounted.current) setSourceBusy(false)
    }
  }

  // Resolves to whether the action really applied: the plugin detail leaves the screen after an
  // uninstall, so the caller needs to know the file is actually gone before closing it.
  const run = async (id: string, action: () => Promise<void>): Promise<boolean> => {
    if (operation.current) return false
    operation.current = true
    setBusyId(id)
    try {
      await action()
      await refreshLocal(true)
      return true
    } catch (error) {
      showToast(t('pluginMarket.operationFailed', { error: describeError(error) }), 'error')
      // An enable/stop may have persisted before a runtime error: show disk truth.
      await refreshLocal(true)
      return false
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
    const result = await installRepositoryPlugin(id, snapshot.commit, snapshot.repository, mirrorRef.current)
    showToast(t('pluginMarket.installedMessage', { name: result.name }))
  })

  // The switch is its own confirmation: no toast here, only the state change.
  const toggle = (id: string, value: boolean) => run(id, async () => {
    await setExternalPluginEnabled(id, value)
  })

  const uninstall = (id: string) => run(id, async () => {
    await uninstallExternalPlugin(id)
    showToast(t('pluginMarket.uninstalledMessage'))
  })

  return {
    installed, repository, source, mirror, sourceBusy, changeSource,
    loadingLocal, loadingRemote, localError, remoteError,
    busyId, refreshLocal, refreshRemote, install, toggle, uninstall,
  }
}
