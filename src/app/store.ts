import { create } from 'zustand'
import type { ThemeMode } from '../composables/useTheme'

export type LocaleKey = 'zh-CN' | 'en-US'

type ShellState = {
  /** 当前主题偏好（system / light / dark），来源是 Vue 侧 useTheme 单例。 */
  themeMode: ThemeMode
  /** 解析后的实际主题，驱动 Radix Themes 的 appearance。 */
  resolvedTheme: 'light' | 'dark'
  /** 宿主界面语言，与 vue-i18n 的 locale 保持同步。 */
  locale: LocaleKey
  setThemeState: (themeMode: ThemeMode, resolvedTheme: 'light' | 'dark') => void
  setLocale: (locale: LocaleKey) => void
}

/**
 * React 壳的全局状态（zustand）。
 * 迁移期 theme / locale 的真源仍在 Vue 单例（useTheme、vue-i18n），
 * 这里只是镜像，供 React 渲染与后续 M2 起的页面状态使用。
 */
export const useShellStore = create<ShellState>((set) => ({
  themeMode: 'system',
  resolvedTheme: 'light',
  locale: 'zh-CN',
  setThemeState: (themeMode, resolvedTheme) => set({ themeMode, resolvedTheme }),
  setLocale: (locale) => set({ locale }),
}))
