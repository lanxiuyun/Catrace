import { load, type Store } from '@tauri-apps/plugin-store'
import { emit, listen } from '@tauri-apps/api/event'
import { useShellStore, type ThemeMode, type ResolvedTheme } from '../app/store'

export type { ThemeMode } from '../app/store'
export const THEME_CHANGED_EVENT = 'catrace-theme-changed'

const STORE_KEY = 'theme.mode'
let storePromise: Promise<Store> | null = null
let initPromise: Promise<void> | null = null
let systemDark = false
let modeRevision = 0

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system'

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load('settings.json', { defaults: {}, autoSave: true }).catch((error) => {
      storePromise = null
      throw error
    })
  }
  return storePromise
}

function applyMode(mode: ThemeMode): void {
  const resolved: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  useShellStore.getState().setThemeState(mode, resolved)
  document.documentElement.setAttribute('data-theme', resolved)
}

/** Read the preference and attach per-window OS/Tauri listeners before rendering. */
export function initTheme(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      systemDark = media.matches
      const changed = (event: MediaQueryListEvent) => {
        systemDark = event.matches
        applyMode(useShellStore.getState().themeMode)
      }
      if (typeof media.addEventListener === 'function') media.addEventListener('change', changed)
      else media.addListener(changed)
    } catch {
      // Older WebViews without matchMedia keep the light system fallback.
    }
    applyMode(useShellStore.getState().themeMode)
    try {
      await listen<{ mode: ThemeMode }>(THEME_CHANGED_EVENT, (event) => {
        if (!isThemeMode(event.payload?.mode)) return
        modeRevision++
        applyMode(event.payload.mode)
      })
    } catch (error) {
      console.error('监听主题变更失败', error)
    }
    const revision = modeRevision
    try {
      const saved = await (await getStore()).get<unknown>(STORE_KEY)
      if (revision === modeRevision && isThemeMode(saved)) applyMode(saved)
    } catch (error) {
      console.error('读取主题偏好失败，回退 system', error)
    }
  })()
  return initPromise
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  if (!isThemeMode(mode)) return
  modeRevision++
  applyMode(mode)
  try {
    const store = await getStore()
    await store.set(STORE_KEY, mode)
    await store.save()
  } catch (error) {
    console.error('保存主题偏好失败', error)
  }
  try {
    await emit(THEME_CHANGED_EVENT, { mode })
  } catch (error) {
    console.error('广播主题变更失败', error)
  }
}

/** React hook over the shared theme state. */
export function useTheme() {
  const mode = useShellStore((state) => state.themeMode)
  const resolved = useShellStore((state) => state.resolvedTheme)
  return { mode, resolved, setMode: setThemeMode }
}
