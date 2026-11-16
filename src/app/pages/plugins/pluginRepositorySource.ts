import { DEFAULT_PLUGIN_REPOSITORY, type RepositoryPluginCatalog } from '../../../api/tauri'
import { getSettingsStore } from '../../lib/settingsStore'

const SOURCE_KEY = 'plugin_repository'
const MIRROR_KEY = 'plugin_github_mirror'
const CATALOG_CACHE_KEY = 'plugin_catalog_cache'

export async function readPluginRepository(): Promise<string> {
  const store = await getSettingsStore()
  const value = await store.get<unknown>(SOURCE_KEY)
  return typeof value === 'string' && value.trim() ? value : DEFAULT_PLUGIN_REPOSITORY
}

/** True when GitHub file downloads should be routed through the built-in file mirror. */
export async function readGithubMirror(): Promise<boolean> {
  const store = await getSettingsStore()
  return (await store.get<unknown>(MIRROR_KEY)) === true
}

/** Validate first, then persist the repository and its download route together. */
export async function savePluginRepository(repository: string, mirror: boolean): Promise<void> {
  const store = await getSettingsStore()
  const previousSource = await store.get<unknown>(SOURCE_KEY)
  const previousMirror = await store.get<unknown>(MIRROR_KEY)
  try {
    await store.set(SOURCE_KEY, repository)
    await store.set(MIRROR_KEY, mirror)
    await store.save()
  } catch (error) {
    // autoSave shares the same in-memory Store: restore both settings if saving failed.
    try {
      if (previousSource === undefined) await store.delete(SOURCE_KEY)
      else await store.set(SOURCE_KEY, previousSource)
      if (previousMirror === undefined) await store.delete(MIRROR_KEY)
      else await store.set(MIRROR_KEY, previousMirror)
      await store.save()
    } catch (restoreError) {
      console.error('Failed to restore plugin source settings', restoreError)
    }
    throw error
  }
}

/** 上一次成功拉到的仓库目录，附带写入时间，用来决定是否需要自动刷新。 */
export interface CachedPluginCatalog extends RepositoryPluginCatalog {
  fetchedAt: number
}

const isCachedPluginEntry = (value: unknown): value is RepositoryPluginCatalog['plugins'][number] => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && typeof entry.name === 'string'
    && typeof entry.version === 'string' && typeof entry.description === 'string'
    && [entry.hasUi, entry.hasBackground, entry.hasSettings, entry.hasSidecar]
      .every((flag) => typeof flag === 'boolean')
}

/**
 * 上一次成功拉到的仓库目录。插件中心打开时先用它显示版本和更新提示，随后按新鲜度决定是否后台刷新：
 * 只接受同一插件源，结构不对或读失败都返回 null，绝不阻塞刷新。
 */
export async function readPluginCatalogCache(repository: string): Promise<CachedPluginCatalog | null> {
  try {
    const store = await getSettingsStore()
    const value = await store.get<unknown>(CATALOG_CACHE_KEY)
    if (!value || typeof value !== 'object') return null
    const cache = value as { repository?: unknown; commit?: unknown; plugins?: unknown; fetchedAt?: unknown }
    if (cache.repository !== repository || typeof cache.commit !== 'string' || !Array.isArray(cache.plugins)) return null
    const plugins = cache.plugins.filter(isCachedPluginEntry)
    if (plugins.length !== cache.plugins.length) return null
    return {
      repository,
      commit: cache.commit,
      plugins,
      fetchedAt: typeof cache.fetchedAt === 'number' && Number.isFinite(cache.fetchedAt) ? cache.fetchedAt : 0,
    }
  } catch {
    return null
  }
}

/** 目录缓存只是让下次打开更快（settings Store 已开 autoSave），写失败只记日志，不影响本次刷新。 */
export async function savePluginCatalogCache(catalog: RepositoryPluginCatalog): Promise<void> {
  try {
    const store = await getSettingsStore()
    // Store 是 autoSave：这里只写内存并落盘在后台，不再触发 source 那套「保存失败回滚」。
    await store.set(CATALOG_CACHE_KEY, { ...catalog, fetchedAt: Date.now() })
  } catch (error) {
    console.warn('Failed to cache plugin catalog', error)
  }
}
