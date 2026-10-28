import { load, type Store } from '@tauri-apps/plugin-store'

let cached: Store | null = null

/** 与旧 Vue 页面共用同一个 settings.json（插件主题/顺序/信号开关都在这）。 */
export async function getSettingsStore(): Promise<Store> {
  if (!cached) {
    cached = await load('settings.json', { defaults: {}, autoSave: true })
  }
  return cached
}
