import { create } from 'zustand'

export type LocaleKey = 'zh-CN' | 'en-US'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

interface ShellState {
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  locale: LocaleKey
  setThemeState: (themeMode: ThemeMode, resolvedTheme: ResolvedTheme) => void
  setLocale: (locale: LocaleKey) => void
}

/** One source of truth per WebView; persisted changes are synchronized through Tauri events. */
export const useShellStore = create<ShellState>((set) => ({
  themeMode: 'system',
  resolvedTheme: 'light',
  locale: 'zh-CN',
  setThemeState: (themeMode, resolvedTheme) => set({ themeMode, resolvedTheme }),
  setLocale: (locale) => set({ locale }),
}))
