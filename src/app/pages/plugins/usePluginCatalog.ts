import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  DEFAULT_PLUGIN_REPOSITORY, installRepositoryPlugin, listExternalPlugins, listPluginCatalog,
  listRepositoryPlugins, setExternalPluginEnabled, uninstallExternalPlugin, updateRepositoryPlugin,
  type PluginCatalogEntry, type RepositoryPluginCatalog,
} from '../../../api/tauri'
import { loadExternalPlugins } from '../../../plugins/loadExternalPlugins'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { readPluginCatalogCache, readGithubMirror, readPluginRepository, savePluginCatalogCache, savePluginRepository } from './pluginRepositorySource'

/** 自动刷新目录的最小间隔；手动刷新和切换插件源不受限制。 */
const CATALOG_REFRESH_INTERVAL_MS = 5 * 60_000

export function usePluginCatalog() {
  const t = useT()
  const [installed, setInstalled] = useState<PluginCatalogEntry[]>([])
  const [repository, setRepository] = useState<RepositoryPluginCatalog | null>(null)
  const [source, setSource] = useState(DEFAULT_PLUGIN_REPOSITORY)
  const [mirror, setMirrorState] = useState(false)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [loadingLocal, setLoadingLocal] = useState(true)
  const [loadingRemote, setLoadingRemote] = useState(true)
  // A reload bounces running sidecars, so the UI distinguishes it from a read-only rescan.
  const [reloadingLocal, setReloadingLocal] = useState(false)
  const reloadingLocalRef = useRef(false)
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
    const raw = String(error)
    const text = raw.startsWith('Error: ') ? raw.slice(7) : raw
    if (text.trim() === 'source_rate_limited') return t('pluginMarket.sourceRateLimited')
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

  // The explicit "reload" the installed tab asks for (the old reload button): restart every
  // enabled sidecar so changed runtime scripts / replaced packages really run, rebuild the
  // frontend Blob modules from disk, and ask the Toast window to rebuild its own cards. The
  // catalog read afterwards also reflects plugins dropped or edited by hand.
  const reloadLocal = useCallback(async () => {
    if (operation.current || reloadingLocalRef.current) return
    reloadingLocalRef.current = true
    const request = ++localRequest.current
    setReloadingLocal(true)
    setLoadingLocal(true)
    setLocalError('')
    try {
      await listExternalPlugins({ restartSidecars: true })
      await loadExternalPlugins({ force: true })
      // The Toast window has its own plugin registry, so it needs its own reload.
      await emit('catrace:reload-external-plugins').catch(() => {})
      const entries = await listPluginCatalog()
      if (!mounted.current || request !== localRequest.current) return
      setInstalled(entries)
    } catch (error) {
      if (mounted.current && request === localRequest.current) setLocalError(String(error))
    } finally {
      reloadingLocalRef.current = false
      if (mounted.current) {
        setReloadingLocal(false)
        // A newer request owns the loading flag from here on.
        if (request === localRequest.current) setLoadingLocal(false)
      }
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
      void savePluginCatalogCache(result)
    } catch (error) {
      if (mounted.current && request === remoteRequest.current) {
        setRemoteError(describeError(error))
        // 同一插件源的上一次目录（含缓存）继续可用于版本比较，不因一次刷新失败清空；
        // 只有目录不属于当前源时才丢弃，避免把旧来源的卡片留在发现页。
        setRepository((current) => current && current.repository === sourceRef.current ? current : null)
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
      // 先用上次成功的目录让「已安装」卡片的版本和更新提示立刻出现，再照常后台刷新。
      const savedSource = await readPluginRepository().catch(() => DEFAULT_PLUGIN_REPOSITORY)
      if (!mounted.current) return
      const cached = await readPluginCatalogCache(savedSource).catch(() => null)
      if (!mounted.current) return
      if (cached) {
        sourceRef.current = savedSource
        setSource(savedSource)
        setRepository(cached)
        // 目录刚从仓库拉到不久：先用缓存，别让每次打开页面/刷新都重发几十个 manifest 请求
        // （镜像线路会以 429 回应）。手动刷新走发现页的刷新按钮，不受这个间隔限制。
        if (Date.now() - cached.fetchedAt < CATALOG_REFRESH_INTERVAL_MS) {
          setLoadingRemote(false)
          return
        }
      }
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
      void savePluginCatalogCache(result)
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

  // Files are replaced by the backend; the frontend modules must be rebuilt from the new package
  // (same path as the installed tab's "reload local plugins"), including the Toast window.
  const update = (id: string) => run(id, async () => {
    const snapshot = repository
    if (!snapshot || snapshot.repository !== sourceRef.current) {
      throw new Error(t('pluginMarket.catalogUnavailable'))
    }
    const result = await updateRepositoryPlugin(id, snapshot.commit, snapshot.repository, mirrorRef.current)
    // 更新已经落盘：模块重建失败不能伪装成「更新失败」，只记日志，让用户还能正常打开插件。
    try { await loadExternalPlugins({ force: true }) }
    catch (error) { console.warn('[plugins] reload after update failed', error) }
    await emit('catrace:reload-external-plugins').catch(() => {})
    showToast(t('pluginMarket.updatedMessage', { name: result.name, version: result.version }))
  })

  const uninstall = (id: string) => run(id, async () => {
    await uninstallExternalPlugin(id)
    showToast(t('pluginMarket.uninstalledMessage'))
  })

  return {
    installed, repository, source, mirror, sourceBusy, changeSource,
    loadingLocal, loadingRemote, reloadingLocal, localError, remoteError,
    busyId, refreshLocal, reloadLocal, refreshRemote, install, update, toggle, uninstall,
  }
}
