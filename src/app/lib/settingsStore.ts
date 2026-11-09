import { load, type Store } from '@tauri-apps/plugin-store'

let cached: Store | null = null

/** 共享 settings.json Store（插件主题、排序与信号开关）。 */
export async function getSettingsStore(): Promise<Store> {
  if (!cached) {
    cached = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return cached
}
