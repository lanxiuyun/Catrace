import { DEFAULT_PLUGIN_REPOSITORY } from '../../../api/tauri'
import { getSettingsStore } from '../../lib/settingsStore'

const SOURCE_KEY = 'plugin_repository'
const MIRROR_KEY = 'plugin_github_mirror'

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
