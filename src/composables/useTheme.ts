import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { load, type Store } from '@tauri-apps/plugin-store'
import { emit, listen } from '@tauri-apps/api/event'
import { darkTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import { lightThemeOverrides, darkThemeOverrides } from '../theme'

export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_CHANGED_EVENT = 'catrace-theme-changed'

const STORE_FILE = 'settings.json'
const STORE_KEY = 'theme.mode'

// —— 应用级单例状态（模块内 ref，多次 useTheme() 共享） ——
const mode = ref<ThemeMode>('system')
const systemDark = ref(false)
let store: Store | null = null
let initialized = false

async function getStore(): Promise<Store> {
  if (!store) store = await load(STORE_FILE, { defaults: {}, autoSave: true })
  return store
}

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

const resolved: ComputedRef<'light' | 'dark'> = computed(() => {
  if (mode.value === 'system') return systemDark.value ? 'dark' : 'light'
  return mode.value
})

function applyDom(): void {
  document.documentElement.setAttribute('data-theme', resolved.value)
}

const naiveTheme: ComputedRef<GlobalTheme | null> = computed(() =>
  resolved.value === 'dark' ? darkTheme : null,
)

const naiveOverrides: ComputedRef<GlobalThemeOverrides> = computed(() =>
  resolved.value === 'dark' ? darkThemeOverrides : lightThemeOverrides,
)

async function setMode(m: ThemeMode): Promise<void> {
  mode.value = m
  applyDom()
  try {
    const s = await getStore()
    await s.set(STORE_KEY, m)
  } catch (e) {
    console.error('保存主题偏好失败', e)
  }
  // 广播给所有窗口（含自身，listener 里幂等）
  try {
    await emit(THEME_CHANGED_EVENT, { mode: m })
  } catch (e) {
    console.error('广播主题变更失败', e)
  }
}

/** 挂载前调用一次：读初值 + 落地 DOM + 装监听。防 FOUC 关键。 */
async function init(): Promise<void> {
  if (initialized) return
  initialized = true

  // 系统偏好初值 + 监听系统深色变化
  systemDark.value = prefersDark()
  try {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        systemDark.value = e.matches
        applyDom()
      })
  } catch {
    /* 老 webview 无 matchMedia，忽略 */
  }

  // 读持久化偏好
  try {
    const s = await getStore()
    const saved = await s.get<ThemeMode>(STORE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      mode.value = saved
    }
  } catch (e) {
    console.error('读取主题偏好失败，回退 system', e)
  }

  applyDom()

  // 跨窗口同步：其它窗口改了偏好，本窗口跟随
  try {
    await listen<{ mode: ThemeMode }>(THEME_CHANGED_EVENT, (ev) => {
      const m = ev.payload?.mode
      if (m === 'light' || m === 'dark' || m === 'system') {
        if (m !== mode.value) mode.value = m
        applyDom()
      }
    })
  } catch (e) {
    console.error('监听主题变更失败', e)
  }
}

export function useTheme(): {
  mode: Ref<ThemeMode>
  resolved: ComputedRef<'light' | 'dark'>
  naiveTheme: ComputedRef<GlobalTheme | null>
  naiveOverrides: ComputedRef<GlobalThemeOverrides>
  setMode: (m: ThemeMode) => Promise<void>
  init: () => Promise<void>
} {
  return { mode, resolved, naiveTheme, naiveOverrides, setMode, init }
}
