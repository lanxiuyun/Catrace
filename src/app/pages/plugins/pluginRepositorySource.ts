import { DEFAULT_PLUGIN_REPOSITORY } from '../../../api/tauri'
import { getSettingsStore } from '../../lib/settingsStore'

const SOURCE_KEY = 'plugin_repository'

export async function readPluginRepository(): Promise<string> {
  const store = await getSettingsStore()
  const value = await store.get<unknown>(SOURCE_KEY)
  return typeof value === 'string' && value.trim() ? value : DEFAULT_PLUGIN_REPOSITORY
}

/** Call only after the backend has validated the repository and returned its canonical name. */
export async function savePluginRepository(repository: string): Promise<void> {
  const store = await getSettingsStore()
  const previous = await store.get<unknown>(SOURCE_KEY)
  try {
    await store.set(SOURCE_KEY, repository)
    await store.save()
  } catch (error) {
    // autoSave shares the same in-memory Store: restore it too if saving failed.
    try {
      if (previous === undefined) await store.delete(SOURCE_KEY)
      else await store.set(SOURCE_KEY, previous)
      await store.save()
    } catch (restoreError) {
      console.error('Failed to restore plugin repository setting', restoreError)
    }
    throw error
  }
}
